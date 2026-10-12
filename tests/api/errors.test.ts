import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  errorResponse,
  HttpError,
  toHttpError,
} from "@/server/api/errors";

describe("HTTP error mapping", () => {
  it("preserves a typed error's public status, code, and message", async () => {
    const response = errorResponse(
      new HttpError(409, "CASE_CONFLICT", "The case has changed."),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CASE_CONFLICT",
        message: "The case has changed.",
      },
    });
  });

  it("maps unknown failures to a safe generic response", async () => {
    const response = errorResponse(
      new Error("DATABASE_URL=postgres://private.example/secret"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private.example");
  });

  it("does not expose a typed server error's internal message", async () => {
    const response = errorResponse(
      new HttpError(500, "INTERNAL_SERVER_ERROR", "private database detail"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });

  it("maps Zod parse failures to a sanitized 422 error", () => {
    const parsed = z.string().safeParse({ privateValue: "do-not-return" });

    expect(parsed.success).toBe(false);
    const mapped = toHttpError(parsed.success ? undefined : parsed.error);

    expect(mapped).toMatchObject({
      status: 422,
      code: "INVALID_REQUEST",
      message: "Request validation failed.",
    });
    expect(mapped.message).not.toContain("do-not-return");
  });
});
