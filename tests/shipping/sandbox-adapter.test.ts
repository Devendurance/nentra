import { describe, expect, it } from "vitest";

import {
  SandboxShippingAdapter,
  ShippingProviderError,
  type BookingRequest,
  type SandboxBooking,
  type ShippingQuote,
  type ShippingStore,
} from "@/integrations/shipping";

class MemoryShippingStore implements ShippingStore {
  readonly operations: string[] = [];
  readonly quotes = new Map<string, ShippingQuote>();
  readonly intents = new Map<string, Awaited<ReturnType<ShippingStore["persistBookingIntent"]>>>();
  readonly bookingsByIdempotencyKey = new Map<string, SandboxBooking>();
  readonly bookingsByProviderReference = new Map<string, SandboxBooking>();
  readonly bookingsByProviderBookingId = new Map<string, SandboxBooking>();

  remainingFaults = 1;
  ambiguousAfterWrite = false;
  ambiguousWithoutWrite = false;

  async consumeFault() {
    this.operations.push("consumeFault");
    if (this.remainingFaults === 0) return null;
    this.remainingFaults -= 1;
    return {
      id: "fault-1",
      code: "PROVIDER_503" as const,
      providerCode: "GIG_LOGISTICS",
    };
  }

  async saveQuotes(quotes: Parameters<ShippingStore["saveQuotes"]>[0]) {
    this.operations.push("saveQuotes");
    for (const quote of quotes) this.quotes.set(quote.id, quote);
  }

  async getQuote(quoteId: string) {
    this.operations.push("getQuote");
    return this.quotes.get(quoteId) ?? null;
  }

  async persistBookingIntent(
    intent: Parameters<ShippingStore["persistBookingIntent"]>[0],
  ) {
    this.operations.push("persistBookingIntent");
    const existing = this.intents.get(intent.idempotencyKey);
    if (existing) return existing;
    this.intents.set(intent.idempotencyKey, intent);
    return intent;
  }

  async getBookingByIdempotencyKey(idempotencyKey: string) {
    this.operations.push("getBookingByIdempotencyKey");
    return this.bookingsByIdempotencyKey.get(idempotencyKey) ?? null;
  }

  async createSandboxBooking(booking: SandboxBooking) {
    this.operations.push("createSandboxBooking");
    if (this.ambiguousWithoutWrite) {
      throw new ShippingProviderError({
        code: "BOOKING_OUTCOME_UNKNOWN",
        message: "Sandbox write outcome is unknown",
        classification: "AMBIGUOUS_WRITE",
        providerCode: booking.providerCode,
      });
    }

    const existing = this.bookingsByIdempotencyKey.get(booking.idempotencyKey);
    if (existing) return existing;
    this.bookingsByIdempotencyKey.set(booking.idempotencyKey, booking);
    this.bookingsByProviderReference.set(booking.providerReference, booking);
    this.bookingsByProviderBookingId.set(booking.providerBookingId, booking);

    if (this.ambiguousAfterWrite) {
      throw new ShippingProviderError({
        code: "BOOKING_OUTCOME_UNKNOWN",
        message: "Sandbox write outcome is unknown",
        classification: "AMBIGUOUS_WRITE",
        providerCode: booking.providerCode,
      });
    }

    return booking;
  }

  async getBookingByProviderReference(providerReference: string) {
    this.operations.push("getBookingByProviderReference");
    return this.bookingsByProviderReference.get(providerReference) ?? null;
  }

  async getBookingByProviderBookingId(providerBookingId: string) {
    this.operations.push("getBookingByProviderBookingId");
    return this.bookingsByProviderBookingId.get(providerBookingId) ?? null;
  }
}

const quoteRequest = {
  caseId: "case-ng-2048",
  orderId: "NG-2048",
  route: "PREFERRED" as const,
  currency: "NGN" as const,
  origin: { area: "Ikeja", state: "Lagos", countryCode: "NG" as const },
  destination: { area: "Lekki", state: "Lagos", countryCode: "NG" as const },
  parcel: { description: "Fashion order", weightGrams: 1_500 },
};

describe("SandboxShippingAdapter quotes", () => {
  it("raises one typed transient 503 when the persisted preferred-route fault is consumed", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store);

    await expect(adapter.getQuotes(quoteRequest)).rejects.toMatchObject({
      name: "ShippingProviderError",
      code: "PROVIDER_503",
      classification: "TRANSIENT_READ",
      retryable: true,
      statusCode: 503,
      providerCode: "GIG_LOGISTICS",
      faultId: "fault-1",
    } satisfies Partial<ShippingProviderError>);
    expect(store.remainingFaults).toBe(0);

    const quote = await adapter.getQuotes(quoteRequest);
    expect(quote.route).toBe("PREFERRED");
  });

  it("returns the persisted eligible NGN alternative above the configured ceiling", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store, {
      maxShippingNgn: 6_500,
      alternativeQuoteAmountNgn: 7_200,
      quoteLifetimeMs: 60_000,
    });

    const quote = await adapter.getQuotes({ ...quoteRequest, route: "ALTERNATIVE" });

    expect(quote).toMatchObject({
      mode: "DEMO_SANDBOX",
      caseId: quoteRequest.caseId,
      orderId: quoteRequest.orderId,
      route: "ALTERNATIVE",
      currency: "NGN",
      amountNgn: 7_200,
      eligible: true,
      requiresApproval: true,
    });
    expect(await store.getQuote(quote.id)).toEqual(quote);
    expect(store.operations.indexOf("saveQuotes")).toBeLessThan(
      store.operations.indexOf("getQuote"),
    );
  });

  it("does not consume the primary-route fault for an alternative quote", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store);

    const quote = await adapter.getQuotes({ ...quoteRequest, route: "ALTERNATIVE" });

    expect(quote.eligible).toBe(true);
    expect(store.remainingFaults).toBe(1);
    expect(store.operations).not.toContain("consumeFault");
  });
});

describe("SandboxShippingAdapter bookings", () => {
  async function getAlternativeQuote(
    adapter: SandboxShippingAdapter,
  ) {
    return adapter.getQuotes({ ...quoteRequest, route: "ALTERNATIVE" });
  }

  function bookingRequest(quoteId: string, idempotencyKey: string): BookingRequest & {
    idempotencyKey: string;
  } {
    return {
      caseId: quoteRequest.caseId,
      orderId: quoteRequest.orderId,
      quoteId,
      idempotencyKey,
    };
  }

  it("persists intent before the idempotent sandbox write and reuses the booking", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store);
    const quote = await getAlternativeQuote(adapter);
    const request = bookingRequest(quote.id, "book-ng-2048-1");

    const first = await adapter.bookShipment(request);
    const second = await adapter.bookShipment(request);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ mode: "DEMO_SANDBOX", status: "BOOKED" });
    expect(first.providerReference).toMatch(/^NENTRA-SBX-[0-9A-F]{64}$/);
    expect(store.operations.indexOf("persistBookingIntent")).toBeLessThan(
      store.operations.indexOf("createSandboxBooking"),
    );
    expect(store.operations.filter((operation) => operation === "createSandboxBooking"))
      .toHaveLength(1);
  });

  it("uses a distinct sandbox reference for each idempotency key", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store);
    const firstQuote = await getAlternativeQuote(adapter);
    const secondQuote = await getAlternativeQuote(adapter);

    const first = await adapter.bookShipment(
      bookingRequest(firstQuote.id, "book-ng-2048-a"),
    );
    const second = await adapter.bookShipment(
      bookingRequest(secondQuote.id, "book-ng-2048-b"),
    );

    expect(first.providerReference).not.toBe(second.providerReference);
  });

  it("reconciles an ambiguous write by its persisted provider reference", async () => {
    const store = new MemoryShippingStore();
    store.ambiguousAfterWrite = true;
    const adapter = new SandboxShippingAdapter(store);
    const quote = await getAlternativeQuote(adapter);

    const booking = await adapter.bookShipment(
      bookingRequest(quote.id, "book-ambiguous-1"),
    );

    expect(booking.status).toBe("BOOKED");
    expect(store.operations.filter((operation) => operation === "createSandboxBooking"))
      .toHaveLength(1);
    expect(store.operations).toContain("getBookingByProviderReference");
  });

  it("surfaces an unresolved ambiguous write without retrying the booking", async () => {
    const store = new MemoryShippingStore();
    store.ambiguousWithoutWrite = true;
    const adapter = new SandboxShippingAdapter(store);
    const quote = await getAlternativeQuote(adapter);

    await expect(
      adapter.bookShipment(bookingRequest(quote.id, "book-ambiguous-2")),
    ).rejects.toMatchObject({
      classification: "AMBIGUOUS_WRITE",
      retryable: false,
    });
    expect(store.operations.filter((operation) => operation === "createSandboxBooking"))
      .toHaveLength(1);
  });

  it("uses a fresh store read for independent booking readback", async () => {
    const store = new MemoryShippingStore();
    const adapter = new SandboxShippingAdapter(store);
    const quote = await getAlternativeQuote(adapter);
    const booking = await adapter.bookShipment(
      bookingRequest(quote.id, "book-readback-1"),
    );

    expect(await adapter.getBooking(booking.providerBookingId)).toEqual(booking);
    expect(store.operations).toContain("getBookingByProviderBookingId");
  });

  it("classifies a missing persisted quote as a permanent provider error", async () => {
    const adapter = new SandboxShippingAdapter(new MemoryShippingStore());

    await expect(
      adapter.bookShipment(bookingRequest("missing-quote", "book-missing-1")),
    ).rejects.toMatchObject({
      name: "ShippingProviderError",
      classification: "PERMANENT",
      retryable: false,
    });
  });
});
