import { z } from "zod";

export const bookingIntentSchema = z
  .object({
    caseId: z.string().trim().min(1).max(128),
    idempotencyKey: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(100),
    quoteId: z.string().trim().min(1).max(128),
    serviceCode: z.string().trim().min(1).max(100),
    amountNgn: z.number().int().positive().safe(),
    currency: z.literal("NGN"),
    destinationHash: z.string().trim().min(1).max(128),
  })
  .strict();

export const bookingReadbackSchema = z
  .object({
    source: z.literal("PROVIDER_READBACK"),
    providerBookingId: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(100),
    quoteId: z.string().trim().min(1).max(128),
    serviceCode: z.string().trim().min(1).max(100),
    amountNgn: z.number().int().positive().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    destinationHash: z.string().trim().min(1).max(128),
    state: z.enum(["CREATED", "CONFIRMED", "CANCELLED", "UNKNOWN"]),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const bookingVerificationSchema = z.object({
  result: z.enum(["PASS", "FAIL"]),
  checks: z.object({
    providerBookingId: z.boolean(),
    confirmedState: z.boolean(),
    idempotencyKey: z.boolean(),
    provider: z.boolean(),
    quoteId: z.boolean(),
    serviceCode: z.boolean(),
    amount: z.boolean(),
    currency: z.boolean(),
    destination: z.boolean(),
  }),
});

export type BookingIntent = z.infer<typeof bookingIntentSchema>;
export type BookingReadback = z.infer<typeof bookingReadbackSchema>;
export type BookingVerification = z.infer<typeof bookingVerificationSchema>;

export function verifyBookingReadback(
  intent: BookingIntent,
  readback: BookingReadback,
): BookingVerification {
  const checks = {
    providerBookingId: readback.providerBookingId.length > 0,
    confirmedState: readback.state === "CONFIRMED",
    idempotencyKey: readback.idempotencyKey === intent.idempotencyKey,
    provider: readback.provider === intent.provider,
    quoteId: readback.quoteId === intent.quoteId,
    serviceCode: readback.serviceCode === intent.serviceCode,
    amount: readback.amountNgn === intent.amountNgn,
    currency: readback.currency === intent.currency,
    destination: readback.destinationHash === intent.destinationHash,
  };

  return bookingVerificationSchema.parse({
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    checks,
  });
}
