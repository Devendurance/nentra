import { z } from "zod";

const nonEmptyAddressField = z.string().trim().min(1).max(160);

export const orderAddressSchema = z
  .object({
    recipientName: nonEmptyAddressField.optional(),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+234|0)[789][01]\d{8}$/, "Expected a Nigerian mobile number")
      .optional(),
    addressLine1: nonEmptyAddressField.optional(),
    city: nonEmptyAddressField.optional(),
    state: nonEmptyAddressField.optional(),
    landmark: nonEmptyAddressField.optional(),
    countryCode: z.literal("NG").optional(),
  })
  .strict();

export const orderSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    amountNgn: z.number().int().positive().safe(),
    currency: z.literal("NGN"),
    paymentStatus: z.enum(["PAID", "UNPAID", "UNKNOWN"]),
    paymentMethod: z.enum(["PREPAID", "COD"]),
    address: orderAddressSchema,
  })
  .strict();

export type OrderAddress = z.infer<typeof orderAddressSchema>;
export type Order = z.infer<typeof orderSchema>;

export type OrderShippingBlocker =
  | { code: "ADDRESS_INCOMPLETE"; missingFields: string[] }
  | { code: "PAYMENT_NOT_CONFIRMED" }
  | { code: "COD_UNSUPPORTED" };

export type OrderShippingPolicy = {
  supportsCashOnDelivery?: boolean;
};

const requiredShippingAddressFields = [
  "recipientName",
  "phone",
  "addressLine1",
  "city",
  "state",
  "landmark",
  "countryCode",
] as const satisfies readonly (keyof OrderAddress)[];

export function getOrderShippingBlockers(
  order: Order,
  policy: OrderShippingPolicy = {},
): OrderShippingBlocker[] {
  const blockers: OrderShippingBlocker[] = [];
  const missingFields = requiredShippingAddressFields.filter(
    (field) => !order.address[field],
  );

  if (missingFields.length > 0) {
    blockers.push({ code: "ADDRESS_INCOMPLETE", missingFields: [...missingFields] });
  }

  if (order.paymentMethod === "COD") {
    if (!policy.supportsCashOnDelivery) {
      blockers.push({ code: "COD_UNSUPPORTED" });
    }
  } else if (order.paymentStatus !== "PAID") {
    blockers.push({ code: "PAYMENT_NOT_CONFIRMED" });
  }

  return blockers;
}
