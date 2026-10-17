/**
 * Offline validation for the non-secret scope record used by the restricted
 * automation pilot run pack. This module deliberately does not read files,
 * contact a network, authorize an operation, or disclose submitted fields.
 */

export const RESTRICTED_PILOT_SCOPE_SCHEMA = "priorseal.restricted-automation-pilot-scope.v1";

export type RestrictedPilotScopeValidation = {
  valid: boolean;
  codes: string[];
};

const REQUIRED_CHECKS = [
  "exactAuthorizedOperation",
  "changedRecipientRejected",
  "replayRejected",
  "crossRouteNonceRejected",
  "routerMutationRejected",
  "uncertainAttemptRecovered",
  "externalVerificationCompleted",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isNonPlaceholderLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 160 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/(<|>|replace|example|todo|tbd)/i.test(value)
  );
}

function isNormalizedEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
}

function isCodeHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function addCode(codes: string[], condition: boolean, code: string): void {
  if (!condition) {
    codes.push(code);
  }
}

function validateOperation(value: unknown, codes: string[]): void {
  if (!isRecord(value)) {
    codes.push("OPERATION_INVALID");
    return;
  }

  const expected = [
    "chainId",
    "executionProfile",
    "action",
    "executor",
    "callTarget",
    "calldataHash",
    "routerCodeHash",
    "maxNativeValue",
    "validityMaxSeconds",
  ];
  addCode(codes, hasExactlyKeys(value, expected), "OPERATION_FIELDS_INVALID");
  addCode(codes, isBoundedInteger(value.chainId, 1, 4_294_967_295), "CHAIN_ID_INVALID");
  addCode(
    codes,
    value.executionProfile === "priorseal.execution-profile.exact-call.v1",
    "EXECUTION_PROFILE_INVALID",
  );
  addCode(codes, value.action === "CONTRACT_CALL", "ACTION_INVALID");
  addCode(codes, isNormalizedEvmAddress(value.executor), "EXECUTOR_INVALID");
  addCode(codes, isNormalizedEvmAddress(value.callTarget), "CALL_TARGET_INVALID");
  addCode(codes, isCodeHash(value.calldataHash), "CALLDATA_HASH_INVALID");
  addCode(codes, isCodeHash(value.routerCodeHash), "ROUTER_CODE_HASH_INVALID");
  addCode(codes, isDecimal(value.maxNativeValue), "MAX_NATIVE_VALUE_INVALID");
  addCode(codes, isBoundedInteger(value.validityMaxSeconds, 60, 3_600), "VALIDITY_WINDOW_INVALID");
}

function validateRoles(value: unknown, codes: string[]): void {
  if (!isRecord(value)) {
    codes.push("ROLES_INVALID");
    return;
  }

  const expected = ["authorizer", "executorOwner", "evidenceOwner", "independentReviewer", "recoveryOwner"];
  addCode(codes, hasExactlyKeys(value, expected), "ROLE_FIELDS_INVALID");
  for (const key of expected) {
    addCode(codes, isNonPlaceholderLabel(value[key]), `ROLE_${key.toUpperCase()}_INVALID`);
  }
  addCode(
    codes,
    value.independentReviewer !== value.evidenceOwner && value.independentReviewer !== value.executorOwner,
    "INDEPENDENT_REVIEWER_NOT_DISTINCT",
  );
  addCode(codes, value.authorizer !== value.executorOwner, "AUTHORIZER_NOT_DISTINCT_FROM_EXECUTOR");
}

function validateDurability(value: unknown, codes: string[]): void {
  if (!isRecord(value)) {
    codes.push("DURABILITY_INVALID");
    return;
  }

  const expected = ["store", "sharedSignerScope", "recoveryProcedure"];
  addCode(codes, hasExactlyKeys(value, expected), "DURABILITY_FIELDS_INVALID");
  addCode(codes, value.store === "POSTGRES", "DURABLE_STORE_INVALID");
  addCode(codes, isNonPlaceholderLabel(value.sharedSignerScope), "SIGNER_SCOPE_INVALID");
  addCode(codes, isNonPlaceholderLabel(value.recoveryProcedure), "RECOVERY_PROCEDURE_INVALID");
}

function validateEvidence(value: unknown, codes: string[]): void {
  if (!isRecord(value)) {
    codes.push("EVIDENCE_INVALID");
    return;
  }

  const expected = ["audience", "issuerKeyId", "retentionDays", "deliveryReference"];
  addCode(codes, hasExactlyKeys(value, expected), "EVIDENCE_FIELDS_INVALID");
  addCode(codes, isNonPlaceholderLabel(value.audience), "EVIDENCE_AUDIENCE_INVALID");
  addCode(codes, isNonPlaceholderLabel(value.issuerKeyId), "EVIDENCE_ISSUER_KEY_ID_INVALID");
  addCode(codes, isBoundedInteger(value.retentionDays, 30, 2_555), "RETENTION_DAYS_INVALID");
  addCode(codes, isNonPlaceholderLabel(value.deliveryReference), "DELIVERY_REFERENCE_INVALID");
}

function validateRequiredChecks(value: unknown, codes: string[]): void {
  if (!isRecord(value)) {
    codes.push("REQUIRED_CHECKS_INVALID");
    return;
  }

  addCode(codes, hasExactlyKeys(value, REQUIRED_CHECKS), "REQUIRED_CHECK_FIELDS_INVALID");
  for (const check of REQUIRED_CHECKS) {
    addCode(codes, value[check] === true, `REQUIRED_CHECK_${check.toUpperCase()}_MISSING`);
  }
}

/**
 * Validate a completed scope record before the staging pilot starts. Passing
 * this validator is a readiness check only; it never proves authorization,
 * execution, policy compliance, or commercial approval.
 */
export function validateRestrictedPilotScope(input: unknown): RestrictedPilotScopeValidation {
  const codes: string[] = [];
  if (!isRecord(input)) {
    return { valid: false, codes: ["SCOPE_NOT_OBJECT"] };
  }

  const expected = ["schema", "pilotId", "testOnly", "operation", "roles", "durability", "evidence", "requiredChecks"];
  addCode(codes, hasExactlyKeys(input, expected), "SCOPE_FIELDS_INVALID");
  addCode(codes, input.schema === RESTRICTED_PILOT_SCOPE_SCHEMA, "SCOPE_SCHEMA_INVALID");
  addCode(
    codes,
    typeof input.pilotId === "string" &&
      isNonPlaceholderLabel(input.pilotId) &&
      /^[a-z0-9][a-z0-9-]{2,63}$/.test(input.pilotId),
    "PILOT_ID_INVALID",
  );
  addCode(codes, input.testOnly === true, "PILOT_MUST_BE_TEST_ONLY");
  validateOperation(input.operation, codes);
  validateRoles(input.roles, codes);
  validateDurability(input.durability, codes);
  validateEvidence(input.evidence, codes);
  validateRequiredChecks(input.requiredChecks, codes);

  return { valid: codes.length === 0, codes };
}
