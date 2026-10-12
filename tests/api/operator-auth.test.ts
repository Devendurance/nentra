import { describe, expect, it } from "vitest";

import {
  authenticateOperator,
  requireOperator,
} from "@/server/auth/operator";
import { HttpError } from "@/server/api/errors";

const operatorSecret = "a-long-demo-operator-secret";

describe("operator authentication", () => {
  it("accepts the configured secret from the dedicated server header", () => {
    const result = authenticateOperator(
      new Headers({ "x-nentra-operator-secret": operatorSecret }),
      operatorSecret,
    );

    expect(result).toEqual({ authenticated: true });
  });

  it("accepts the configured secret as a bearer credential", () => {
    const result = authenticateOperator(
      new Headers({ authorization: `Bearer ${operatorSecret}` }),
      operatorSecret,
    );

    expect(result).toEqual({ authenticated: true });
  });

  it("uses the server environment secret when no explicit secret is passed", () => {
    const originalSecret = process.env.NENTRA_DEMO_OPERATOR_SECRET;
    process.env.NENTRA_DEMO_OPERATOR_SECRET = operatorSecret;

    try {
      expect(
        authenticateOperator(
          new Headers({ "x-nentra-operator-secret": operatorSecret }),
        ),
      ).toEqual({ authenticated: true });
    } finally {
      if (originalSecret === undefined) {
        delete process.env.NENTRA_DEMO_OPERATOR_SECRET;
      } else {
        process.env.NENTRA_DEMO_OPERATOR_SECRET = originalSecret;
      }
    }
  });

  it("returns an unauthenticated result when no credential is supplied", () => {
    const result = authenticateOperator(new Headers(), operatorSecret);

    expect(result).toEqual({
      authenticated: false,
      code: "OPERATOR_CREDENTIAL_REQUIRED",
      status: 401,
    });
  });

  it("rejects wrong credentials even when their byte length differs", () => {
    const result = authenticateOperator(
      new Headers({ "x-nentra-operator-secret": "wrong" }),
      operatorSecret,
    );

    expect(result).toEqual({
      authenticated: false,
      code: "OPERATOR_CREDENTIAL_INVALID",
      status: 403,
    });
  });

  it("fails closed when the operator secret is not configured", () => {
    const result = authenticateOperator(
      new Headers({ "x-nentra-operator-secret": operatorSecret }),
      undefined,
    );

    expect(result).toEqual({
      authenticated: false,
      code: "OPERATOR_AUTH_NOT_CONFIGURED",
      status: 503,
    });
  });

  it("turns failed authentication into a typed HTTP error", () => {
    expect(() => requireOperator(new Headers(), operatorSecret)).toThrowError(
      expect.objectContaining<Partial<HttpError>>({
        code: "OPERATOR_CREDENTIAL_REQUIRED",
        status: 401,
      }),
    );
  });
});
