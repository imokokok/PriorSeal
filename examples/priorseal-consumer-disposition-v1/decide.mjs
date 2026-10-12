// Generated from decide.mts by npm run core:build. Do not edit directly.
const asObject = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};
const asString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
};
const asStringArray = (value, label) => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
};
const asBoolean = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
};
function parseVerifiedCase(value, index) {
  const label = `cases[${index}]`;
  const entry = asObject(value, label);
  const profile = asObject(entry.profile, `${label}.profile`);
  const partitionedBinding = asObject(profile.partitionedBinding, `${label}.profile.partitionedBinding`);
  const complianceStatus = asString(profile.complianceStatus, `${label}.profile.complianceStatus`);
  const outcome = asString(profile.outcome, `${label}.profile.outcome`);
  if (!["COMPLIANT", "NON_COMPLIANT", "NOT_ASSESSABLE"].includes(complianceStatus)) {
    throw new Error(`${label}.profile.complianceStatus is unsupported`);
  }
  if (!["COMPLETED", "UNDETERMINED"].includes(outcome)) {
    throw new Error(`${label}.profile.outcome is unsupported`);
  }
  if (entry.pass !== true) throw new Error(`${label} is not a passing verifier result`);
  const bound = asBoolean(partitionedBinding.bound, `${label}.profile.partitionedBinding.bound`);
  const mismatchCodes = asStringArray(partitionedBinding.mismatchCodes, `${label}.profile.partitionedBinding.mismatchCodes`);
  const availabilityCodes = asStringArray(partitionedBinding.availabilityCodes, `${label}.profile.partitionedBinding.availabilityCodes`);
  if (bound !== (mismatchCodes.length === 0)) {
    throw new Error(`${label} violates contract v1.0.1: bound must reflect the mismatch-code set`);
  }
  asStringArray(profile.complianceReasonCodes, `${label}.profile.complianceReasonCodes`);
  return {
    caseId: asString(entry.id, `${label}.id`),
    receiptClaimsValid: asBoolean(profile.receiptClaimsValid, `${label}.profile.receiptClaimsValid`),
    bound,
    mismatchCodes,
    availabilityCodes,
    complianceStatus,
    outcome
  };
}
function decideConsumerDisposition(result) {
  if (!result.receiptClaimsValid) {
    return { caseId: result.caseId, disposition: "REJECT_RECORD", reasonCode: "RECEIPT_CLAIMS_INVALID" };
  }
  if (!result.bound || result.mismatchCodes.length > 0 || result.complianceStatus === "NON_COMPLIANT") {
    return { caseId: result.caseId, disposition: "REJECT_RECORD", reasonCode: "AUTHORIZED_ENVELOPE_MISMATCH" };
  }
  if (result.availabilityCodes.length > 0 || result.complianceStatus === "NOT_ASSESSABLE" || result.outcome === "UNDETERMINED") {
    return { caseId: result.caseId, disposition: "HOLD_FOR_REVIEW", reasonCode: "EVIDENCE_INCOMPLETE" };
  }
  if (result.bound && result.mismatchCodes.length === 0 && result.availabilityCodes.length === 0 && result.complianceStatus === "COMPLIANT" && result.outcome === "COMPLETED") {
    return { caseId: result.caseId, disposition: "ACCEPT_RECORD", reasonCode: "EXACT_CALL_CONFIRMED" };
  }
  return { caseId: result.caseId, disposition: "HOLD_FOR_REVIEW", reasonCode: "PROFILE_NOT_ACCEPTABLE" };
}
export {
  decideConsumerDisposition,
  parseVerifiedCase
};
