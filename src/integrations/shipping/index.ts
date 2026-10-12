import { createHash, randomUUID } from "node:crypto";

export type ShippingMode = "DEMO_SANDBOX" | "SHIPBUBBLE_TEST";
export type ShippingErrorClassification =
  | "TRANSIENT_READ"
  | "PERMANENT"
  | "AMBIGUOUS_WRITE";

export interface QuoteRequest {
  caseId: string;
  orderId: string;
  route: "PREFERRED" | "ALTERNATIVE";
  currency: "NGN";
  origin: {
    area: string;
    state: string;
    countryCode: "NG";
  };
  destination: {
    area: string;
    state: string;
    countryCode: "NG";
  };
  parcel: {
    description: string;
    weightGrams: number;
  };
}

export interface PersistedShippingFault {
  id: string;
  code: "PROVIDER_503";
  providerCode: string;
}

export interface ShippingQuote {
  id: string;
  mode: "DEMO_SANDBOX";
  caseId: string;
  orderId: string;
  route: QuoteRequest["route"];
  providerCode: string;
  serviceCode: string;
  currency: "NGN";
  amountNgn: number;
  eligible: true;
  requiresApproval: boolean;
  expiresAt: string;
}

export interface BookingRequest {
  caseId: string;
  orderId: string;
  quoteId: string;
}

export interface BookingIntent extends BookingRequest {
  idempotencyKey: string;
  mode: "DEMO_SANDBOX";
  providerReference: string;
}

export interface SandboxBooking extends BookingIntent {
  providerBookingId: string;
  status: "BOOKED";
  amountNgn: number;
  currency: "NGN";
  providerCode: string;
  serviceCode: string;
  createdAt: string;
}

export interface ShippingAdapter {
  readonly mode: ShippingMode;
  getQuotes(input: QuoteRequest): Promise<ShippingQuote>;
  bookShipment(
    input: BookingRequest & { idempotencyKey: string },
  ): Promise<SandboxBooking>;
  getBooking(providerBookingId: string): Promise<SandboxBooking | null>;
}

/**
 * The implementation must use durable storage with unique constraints for
 * quote IDs, idempotency keys, provider references, and provider booking IDs.
 * `persistBookingIntent` must atomically insert-or-return the existing intent
 * for an idempotency key. `createSandboxBooking` must be an atomic
 * insert-or-return operation keyed by idempotency key.
 */
export interface ShippingStore {
  /** Atomically consumes one persisted failure for the matching case/tool. */
  consumeFault(input: {
    caseId: string;
    tool: "quote_primary";
  }): Promise<PersistedShippingFault | null>;
  /** Persists provider quotes; callers read back by ID before returning them. */
  saveQuotes(quotes: readonly ShippingQuote[]): Promise<void>;
  getQuote(quoteId: string): Promise<ShippingQuote | null>;
  persistBookingIntent(intent: BookingIntent): Promise<BookingIntent>;
  getBookingByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<SandboxBooking | null>;
  createSandboxBooking(booking: SandboxBooking): Promise<SandboxBooking>;
  getBookingByProviderReference(
    providerReference: string,
  ): Promise<SandboxBooking | null>;
  getBookingByProviderBookingId(
    providerBookingId: string,
  ): Promise<SandboxBooking | null>;
}

export interface ShippingProviderErrorOptions {
  code: string;
  message: string;
  classification: ShippingErrorClassification;
  statusCode?: number;
  providerCode?: string;
  faultId?: string;
}

export class ShippingProviderError extends Error {
  readonly code: string;
  readonly classification: ShippingErrorClassification;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly providerCode?: string;
  readonly faultId?: string;

  constructor(options: ShippingProviderErrorOptions) {
    super(options.message);
    this.name = "ShippingProviderError";
    this.code = options.code;
    this.classification = options.classification;
    this.retryable = options.classification === "TRANSIENT_READ";
    this.statusCode = options.statusCode;
    this.providerCode = options.providerCode;
    this.faultId = options.faultId;
  }
}

export interface SandboxShippingAdapterOptions {
  maxShippingNgn?: number;
  preferredQuoteAmountNgn?: number;
  alternativeQuoteAmountNgn?: number;
  quoteLifetimeMs?: number;
}

const DEFAULT_OPTIONS = {
  maxShippingNgn: 6_500,
  preferredQuoteAmountNgn: 6_000,
  alternativeQuoteAmountNgn: 7_200,
  quoteLifetimeMs: 15 * 60 * 1_000,
} as const;

function permanentError(code: string, message: string): ShippingProviderError {
  return new ShippingProviderError({
    code,
    message,
    classification: "PERMANENT",
  });
}

function sandboxReference(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").toUpperCase();
  return `NENTRA-SBX-${digest}`;
}

function sameIntent(left: BookingIntent, right: BookingIntent): boolean {
  return (
    left.caseId === right.caseId &&
    left.orderId === right.orderId &&
    left.quoteId === right.quoteId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.mode === right.mode &&
    left.providerReference === right.providerReference
  );
}

function bookingMatchesIntent(
  booking: SandboxBooking,
  intent: BookingIntent,
): boolean {
  return (
    sameIntent(booking, intent) &&
    booking.status === "BOOKED" &&
    booking.currency === "NGN" &&
    Number.isSafeInteger(booking.amountNgn) &&
    booking.amountNgn > 0
  );
}

export class SandboxShippingAdapter implements ShippingAdapter {
  readonly mode = "DEMO_SANDBOX" as const;
  private readonly options: Required<SandboxShippingAdapterOptions>;

  constructor(
    private readonly store: ShippingStore,
    options: SandboxShippingAdapterOptions = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const { maxShippingNgn, preferredQuoteAmountNgn, alternativeQuoteAmountNgn, quoteLifetimeMs } =
      this.options;
    if (
      !Number.isSafeInteger(maxShippingNgn) ||
      maxShippingNgn < 0 ||
      !Number.isSafeInteger(preferredQuoteAmountNgn) ||
      preferredQuoteAmountNgn <= 0 ||
      !Number.isSafeInteger(alternativeQuoteAmountNgn) ||
      alternativeQuoteAmountNgn <= maxShippingNgn ||
      !Number.isSafeInteger(quoteLifetimeMs) ||
      quoteLifetimeMs <= 0
    ) {
      throw new RangeError(
        "Sandbox quote amounts must be positive whole NGN, the alternative must exceed the ceiling, and quote lifetime must be positive",
      );
    }
  }

  async getQuotes(input: QuoteRequest): Promise<ShippingQuote> {
    this.validateQuoteRequest(input);

    if (input.route === "PREFERRED") {
      const fault = await this.store.consumeFault({
        caseId: input.caseId,
        tool: "quote_primary",
      });
      if (fault) {
        throw new ShippingProviderError({
          code: fault.code,
          message: "The preferred shipping route is temporarily unavailable",
          classification: "TRANSIENT_READ",
          statusCode: 503,
          providerCode: fault.providerCode,
          faultId: fault.id,
        });
      }
    }

    const amountNgn =
      input.route === "PREFERRED"
        ? this.options.preferredQuoteAmountNgn
        : this.options.alternativeQuoteAmountNgn;
    const quote: ShippingQuote = {
      id: randomUUID(),
      mode: this.mode,
      caseId: input.caseId,
      orderId: input.orderId,
      route: input.route,
      providerCode:
        input.route === "PREFERRED" ? "GIG_LOGISTICS" : "REDSTAR_EXPRESS",
      serviceCode: input.route === "PREFERRED" ? "STANDARD" : "ALTERNATIVE_STANDARD",
      currency: "NGN",
      amountNgn,
      eligible: true,
      requiresApproval: amountNgn > this.options.maxShippingNgn,
      expiresAt: new Date(Date.now() + this.options.quoteLifetimeMs).toISOString(),
    };

    await this.store.saveQuotes([quote]);
    const persistedQuote = await this.store.getQuote(quote.id);
    if (!persistedQuote) {
      throw permanentError(
        "QUOTE_NOT_PERSISTED",
        "The sandbox quote was not available after persistence",
      );
    }
    return persistedQuote;
  }

  async bookShipment(
    input: BookingRequest & { idempotencyKey: string },
  ): Promise<SandboxBooking> {
    if (!input.idempotencyKey.trim()) {
      throw permanentError("IDEMPOTENCY_KEY_REQUIRED", "A booking idempotency key is required");
    }

    const existingBooking = await this.store.getBookingByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existingBooking) {
      if (
        existingBooking.caseId !== input.caseId ||
        existingBooking.orderId !== input.orderId ||
        existingBooking.quoteId !== input.quoteId
      ) {
        throw permanentError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to a different booking",
        );
      }
      return existingBooking;
    }

    const quote = await this.store.getQuote(input.quoteId);
    if (!quote) {
      throw permanentError("QUOTE_NOT_FOUND", "The persisted shipping quote was not found");
    }
    if (
      quote.mode !== this.mode ||
      quote.caseId !== input.caseId ||
      quote.orderId !== input.orderId ||
      !quote.eligible ||
      quote.currency !== "NGN" ||
      !Number.isSafeInteger(quote.amountNgn) ||
      quote.amountNgn <= 0
    ) {
      throw permanentError(
        "QUOTE_NOT_ELIGIBLE",
        "The persisted quote does not match this eligible NGN booking",
      );
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      throw permanentError("QUOTE_EXPIRED", "The persisted shipping quote has expired");
    }

    const intent: BookingIntent = {
      caseId: input.caseId,
      orderId: input.orderId,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      mode: this.mode,
      providerReference: sandboxReference(input.idempotencyKey),
    };

    const persistedIntent = await this.store.persistBookingIntent(intent);
    if (!sameIntent(persistedIntent, intent)) {
      throw permanentError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to a different booking intent",
      );
    }

    const booking: SandboxBooking = {
      ...persistedIntent,
      providerBookingId: `sbx-booking-${sandboxReference(input.idempotencyKey).slice("NENTRA-SBX-".length).toLowerCase()}`,
      status: "BOOKED",
      amountNgn: quote.amountNgn,
      currency: "NGN",
      providerCode: quote.providerCode,
      serviceCode: quote.serviceCode,
      createdAt: new Date().toISOString(),
    };

    try {
      const savedBooking = await this.store.createSandboxBooking(booking);
      this.assertBookingMatchesQuote(savedBooking, quote, persistedIntent);
      return savedBooking;
    } catch (error) {
      if (
        error instanceof ShippingProviderError &&
        error.classification === "PERMANENT"
      ) {
        throw error;
      }

      let reconciledBooking: SandboxBooking | null;
      try {
        reconciledBooking = await this.store.getBookingByProviderReference(
          persistedIntent.providerReference,
        );
      } catch {
        throw new ShippingProviderError({
          code: "BOOKING_OUTCOME_UNKNOWN",
          message: "The sandbox booking outcome could not be reconciled",
          classification: "AMBIGUOUS_WRITE",
          providerCode: quote.providerCode,
        });
      }

      if (reconciledBooking) {
        this.assertBookingMatchesQuote(reconciledBooking, quote, persistedIntent);
        return reconciledBooking;
      }

      if (
        error instanceof ShippingProviderError &&
        error.classification === "AMBIGUOUS_WRITE"
      ) {
        throw error;
      }
      throw new ShippingProviderError({
        code: "BOOKING_OUTCOME_UNKNOWN",
        message: "The sandbox booking outcome could not be confirmed",
        classification: "AMBIGUOUS_WRITE",
        providerCode: quote.providerCode,
      });
    }
  }

  async getBooking(providerBookingId: string): Promise<SandboxBooking | null> {
    if (!providerBookingId.trim()) {
      throw permanentError("PROVIDER_BOOKING_ID_REQUIRED", "A provider booking ID is required");
    }
    return this.store.getBookingByProviderBookingId(providerBookingId);
  }

  private validateQuoteRequest(input: QuoteRequest): void {
    if (
      !input.caseId.trim() ||
      !input.orderId.trim() ||
      !input.origin.area.trim() ||
      !input.origin.state.trim() ||
      !input.destination.area.trim() ||
      !input.destination.state.trim() ||
      !input.parcel.description.trim() ||
      !Number.isSafeInteger(input.parcel.weightGrams) ||
      input.parcel.weightGrams <= 0
    ) {
      throw permanentError("INVALID_QUOTE_REQUEST", "The shipping quote request is invalid");
    }
  }

  private assertBookingMatchesQuote(
    booking: SandboxBooking,
    quote: ShippingQuote,
    intent: BookingIntent,
  ): void {
    if (
      !bookingMatchesIntent(booking, intent) ||
      booking.amountNgn !== quote.amountNgn ||
      booking.providerCode !== quote.providerCode ||
      booking.serviceCode !== quote.serviceCode
    ) {
      throw permanentError(
        "BOOKING_RECONCILIATION_MISMATCH",
        "The stored sandbox booking does not match the persisted quote and intent",
      );
    }
  }
}
