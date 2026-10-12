import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError } from "@/server/api/errors";

export type OperatorAuthResult =
  | { authenticated: true }
  | {
      authenticated: false;
      code:
        | "OPERATOR_CREDENTIAL_REQUIRED"
        | "OPERATOR_CREDENTIAL_INVALID"
        | "OPERATOR_AUTH_NOT_CONFIGURED";
      status: 401 | 403 | 503;
    };

function suppliedCredential(headers: Headers): string | null {
  const operatorHeader = headers.get("x-nentra-operator-secret");
  if (operatorHeader !== null) return operatorHeader;

  const authorization = headers.get("authorization");
  if (authorization === null || authorization.trim() === "") return null;

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? "";
}

function secretsMatch(candidate: string, configuredSecret: string): boolean {
  // Hashing gives timingSafeEqual fixed-size inputs even when candidate lengths differ.
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const configuredDigest = createHash("sha256")
    .update(configuredSecret, "utf8")
    .digest();

  return timingSafeEqual(candidateDigest, configuredDigest);
}

export function authenticateOperator(
  headers: Headers,
  configuredSecret = process.env.NENTRA_DEMO_OPERATOR_SECRET,
): OperatorAuthResult {
  if (!configuredSecret || configuredSecret.trim() === "") {
    return {
      authenticated: false,
      code: "OPERATOR_AUTH_NOT_CONFIGURED",
      status: 503,
    };
  }

  const candidate = suppliedCredential(headers);
  if (candidate === null || candidate === "") {
    return {
      authenticated: false,
      code: "OPERATOR_CREDENTIAL_REQUIRED",
      status: 401,
    };
  }

  if (!secretsMatch(candidate, configuredSecret)) {
    return {
      authenticated: false,
      code: "OPERATOR_CREDENTIAL_INVALID",
      status: 403,
    };
  }

  return { authenticated: true };
}

export function requireOperator(
  headers: Headers,
  configuredSecret = process.env.NENTRA_DEMO_OPERATOR_SECRET,
): void {
  const result = authenticateOperator(headers, configuredSecret);
  if (result.authenticated) return;

  const messages = {
    OPERATOR_CREDENTIAL_REQUIRED: "Operator credentials are required.",
    OPERATOR_CREDENTIAL_INVALID: "Operator credentials are invalid.",
    OPERATOR_AUTH_NOT_CONFIGURED: "Operator authentication is not configured.",
  } as const;

  throw new HttpError(result.status, result.code, messages[result.code]);
}
