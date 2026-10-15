import { z } from "zod";

import { HttpError } from "@/server/api/errors";

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const idSchema = z
  .string()
  .regex(safeIdPattern, "Expected a route-safe identifier.");
export const caseIdSchema = idSchema;
export const approvalIdSchema = idSchema;
export const orderIdSchema = idSchema;

export const caseRouteParamsSchema = z
  .object({ caseId: caseIdSchema })
  .strict();
export const approvalRouteParamsSchema = z
  .object({ caseId: caseIdSchema, approvalId: approvalIdSchema })
  .strict();

export const correctionTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected a URL-safe correction token.");

const cursorNumberSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

export const cursorSchema = z.union([
  cursorNumberSchema,
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, "Expected a nonnegative integer cursor.")
    .transform(Number)
    .pipe(cursorNumberSchema),
]);

const addressFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001F\u007F]+$/, "Address fields cannot contain control characters.");

export const correctionInputSchema = z
  .object({
    houseNumber: addressFieldSchema.optional(),
    street: addressFieldSchema.optional(),
    area: addressFieldSchema.optional(),
    landmark: addressFieldSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.houseNumber !== undefined ||
      input.street !== undefined ||
      input.area !== undefined ||
      input.landmark !== undefined,
    "At least one allowed address field is required.",
  );

const expectedVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reasonSchema = z.string().trim().min(1).max(400);

export const approvalInputSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: reasonSchema.optional(),
    expectedVersion: expectedVersionSchema.optional(),
  })
  .strict();

export const refreshApprovalInputSchema = z
  .object({ expectedVersion: expectedVersionSchema.optional() })
  .strict();

export const startInputSchema = z
  .object({ expectedVersion: expectedVersionSchema.optional() })
  .strict();

export const cancelInputSchema = z
  .object({
    reason: reasonSchema.optional(),
    expectedVersion: expectedVersionSchema.optional(),
  })
  .strict();

export const resetInputSchema = z.object({}).strict();

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(422, "INVALID_REQUEST", "Request validation failed.");
  }

  return result.data;
}
