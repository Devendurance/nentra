import { describe, expect, it } from "vitest";

import {
  getOrderShippingBlockers,
  orderSchema,
} from "@/domain/orders/order";

const baseOrder = {
  id: "order-1",
  amountNgn: 65_000,
  currency: "NGN",
  paymentStatus: "PAID",
  paymentMethod: "PREPAID",
  address: {
    recipientName: "Demo Recipient",
    phone: "+2348012345678",
    addressLine1: "12 Demo Street",
    city: "Lagos",
    state: "Lagos",
    landmark: "Near Demo Market",
    countryCode: "NG",
  },
} as const;

describe("order and address validation", () => {
  it("rejects fractional or non-positive NGN order amounts", () => {
    expect(() => orderSchema.parse({ ...baseOrder, amountNgn: 12.5 })).toThrow();
    expect(() => orderSchema.parse({ ...baseOrder, amountNgn: 0 })).toThrow();
  });

  it("accepts an incomplete saved address and reports the missing fields", () => {
    const order = orderSchema.parse({
      ...baseOrder,
      address: { ...baseOrder.address, landmark: undefined },
    });

    expect(getOrderShippingBlockers(order)).toEqual([
      { code: "ADDRESS_INCOMPLETE", missingFields: ["landmark"] },
    ]);
  });

  it("blocks an unconfirmed prepaid order and unsupported cash on delivery", () => {
    const unpaid = orderSchema.parse({ ...baseOrder, paymentStatus: "UNPAID" });
    expect(getOrderShippingBlockers(unpaid)).toContainEqual({
      code: "PAYMENT_NOT_CONFIRMED",
    });

    const cod = orderSchema.parse({
      ...baseOrder,
      paymentStatus: "UNPAID",
      paymentMethod: "COD",
    });
    expect(getOrderShippingBlockers(cod)).toContainEqual({
      code: "COD_UNSUPPORTED",
    });
    expect(
      getOrderShippingBlockers(cod, { supportsCashOnDelivery: true }),
    ).toEqual([]);
  });

  it("blocks unsupported destination countries and invalid phone values", () => {
    expect(() =>
      orderSchema.parse({
        ...baseOrder,
        address: { ...baseOrder.address, countryCode: "US" },
      }),
    ).toThrow();
    expect(() =>
      orderSchema.parse({
        ...baseOrder,
        address: { ...baseOrder.address, phone: "call me" },
      }),
    ).toThrow();
  });
});
