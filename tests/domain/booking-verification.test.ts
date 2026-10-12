import { describe, expect, it } from "vitest";

import {
  bookingReadbackSchema,
  verifyBookingReadback,
} from "@/domain/bookings/verification";

const intent = {
  caseId: "case-1",
  idempotencyKey: "case-1-booking-1",
  provider: "demo-carrier",
  quoteId: "quote-1",
  serviceCode: "same-day",
  amountNgn: 8_000,
  currency: "NGN",
  destinationHash: "sha256:destination-1",
} as const;

const readback = {
  source: "PROVIDER_READBACK",
  providerBookingId: "booking-1",
  idempotencyKey: "case-1-booking-1",
  provider: "demo-carrier",
  quoteId: "quote-1",
  serviceCode: "same-day",
  amountNgn: 8_000,
  currency: "NGN",
  destinationHash: "sha256:destination-1",
  state: "CONFIRMED",
  observedAt: "2026-10-12T00:00:00.000Z",
};

describe("independent booking verification", () => {
  it("passes only when provider readback matches the persisted booking intent", () => {
    expect(
      verifyBookingReadback(intent, bookingReadbackSchema.parse(readback)),
    ).toMatchObject({ result: "PASS" });
  });

  it("fails when the provider reports a booking with a different amount or destination", () => {
    expect(
      verifyBookingReadback(
        intent,
        bookingReadbackSchema.parse({ ...readback, amountNgn: 9_000 }),
      ),
    ).toMatchObject({ result: "FAIL" });
    expect(
      verifyBookingReadback(
        intent,
        bookingReadbackSchema.parse({ ...readback, destinationHash: "other" }),
      ),
    ).toMatchObject({ result: "FAIL" });
  });

  it("requires an independent provider readback source and a confirmed state", () => {
    expect(() =>
      bookingReadbackSchema.parse({ ...readback, source: "BOOKING_RESPONSE" }),
    ).toThrow();
    expect(
      verifyBookingReadback(
        intent,
        bookingReadbackSchema.parse({ ...readback, state: "UNKNOWN" }),
      ),
    ).toMatchObject({ result: "FAIL" });
  });
});
