import { ZodError } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";

    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError("HttpError status must be an integer from 400 to 599.");
    }

    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      throw new TypeError("HttpError code must use uppercase letters and underscores.");
    }

    this.status = status;
    this.code = code;
  }
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;

  if (error instanceof ZodError) {
    return new HttpError(422, "INVALID_REQUEST", "Request validation failed.");
  }

  return new HttpError(
    500,
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred.",
  );
}

export function errorResponse(error: unknown): Response {
  const mapped = toHttpError(error);

  return Response.json(
    {
      error: {
        code: mapped.code,
        message:
          mapped.status >= 500
            ? "An unexpected error occurred."
            : mapped.message,
      },
    },
    {
      status: mapped.status,
      headers: { "cache-control": "no-store" },
    },
  );
}
