import { errorResponse, HttpError } from "@/server/api/errors";
import { parseInput } from "@/server/api/schemas";
import { DemoRepository } from "@/server/db/repository";
import { getDb } from "@/server/db/client";

export async function handleApiRoute(operation: () => Promise<Response>): Promise<Response> {
  try {
    const response = await operation();
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function parseRequestBody<TSchema extends import("zod").ZodType>(
  request: Request,
  schema: TSchema,
): Promise<import("zod").output<TSchema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(422, "INVALID_REQUEST", "Request validation failed.");
  }
  return parseInput(schema, value);
}

export async function getFictionalCase(caseId: string) {
  const snapshot = await new DemoRepository(getDb()).getCaseSnapshot(caseId);
  if (!snapshot) throw new HttpError(404, "CASE_NOT_FOUND", "Case was not found.");
  return snapshot;
}
