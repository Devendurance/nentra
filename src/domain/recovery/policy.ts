export type ShippingOperation = "READ" | "WRITE" | "VERIFICATION";

export type ShippingFailureInput = {
  code: string;
  operation: ShippingOperation;
  statusCode?: number;
  outcome?: "UNKNOWN" | "NOT_APPLIED" | "REJECTED" | "CONFIRMED";
};

export type ShippingFailureClass =
  | "TRANSIENT_READ"
  | "PERMANENT"
  | "AMBIGUOUS_WRITE"
  | "VERIFICATION_MISMATCH"
  | "UNKNOWN";

const permanentBusinessCodes = new Set([
  "INVALID_ADDRESS",
  "INVALID_DIMENSIONS",
  "UNSUPPORTED_COD",
  "COURIER_INELIGIBLE",
  "QUOTE_INELIGIBLE",
]);

const transientFailureCodes = new Set([
  "TIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "PROVIDER_TIMEOUT",
  "TOO_MANY_REQUESTS",
]);

export function classifyShippingFailure(
  failure: ShippingFailureInput,
): ShippingFailureClass {
  const code = failure.code.toUpperCase();
  const embeddedStatus = code.match(/(?:HTTP|PROVIDER)_([0-9]{3})/)?.[1];
  const statusCode = failure.statusCode ?? Number(embeddedStatus);

  if (failure.operation === "VERIFICATION" || code.includes("MISMATCH")) {
    return "VERIFICATION_MISMATCH";
  }

  if (failure.operation === "WRITE" && failure.outcome === "UNKNOWN") {
    return "AMBIGUOUS_WRITE";
  }

  if (
    permanentBusinessCodes.has(code) ||
    [400, 401, 403, 404, 422].includes(statusCode)
  ) {
    return "PERMANENT";
  }

  if (
    failure.operation === "READ" &&
    (transientFailureCodes.has(code) ||
      [408, 429, 502, 503].includes(statusCode))
  ) {
    return "TRANSIENT_READ";
  }

  return "UNKNOWN";
}

export const MAX_ADDITIONAL_READ_ATTEMPTS = 2;

export type RecoveryActionInput = {
  classification: ShippingFailureClass;
  additionalAttemptsUsed: number;
  /** True only when a policy-eligible fallback quote is already available. */
  eligibleFallbackAvailable: boolean;
};

export type RecoveryAction =
  | { action: "RETRY"; additionalAttempt: number }
  | { action: "FALLBACK" }
  | { action: "RECONCILE" }
  | { action: "ESCALATE" };

export function decideRecoveryAction(input: RecoveryActionInput): RecoveryAction {
  if (!Number.isInteger(input.additionalAttemptsUsed) || input.additionalAttemptsUsed < 0) {
    throw new RangeError("Additional attempt count must be a non-negative integer");
  }

  if (input.classification === "AMBIGUOUS_WRITE") {
    return { action: "RECONCILE" };
  }

  if (input.classification !== "TRANSIENT_READ") {
    return { action: "ESCALATE" };
  }

  if (input.additionalAttemptsUsed < MAX_ADDITIONAL_READ_ATTEMPTS) {
    return {
      action: "RETRY",
      additionalAttempt: input.additionalAttemptsUsed + 1,
    };
  }

  return input.eligibleFallbackAvailable
    ? { action: "FALLBACK" }
    : { action: "ESCALATE" };
}
