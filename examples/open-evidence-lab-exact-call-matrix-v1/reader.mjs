// Generated from reader.mts by npm run core:build. Do not edit directly.
import { hashTypedData, recoverTypedDataAddress } from "viem";
const EXACT_CALL_PROFILE = "priorseal.execution-profile.exact-call.v1";
const AUTHORIZATION_TYPES = {
  PriorSealAuthorization: [
    { name: "intentHash", type: "bytes32" },
    { name: "principalType", type: "string" },
    { name: "principalId", type: "string" },
    { name: "principalAccount", type: "address" },
    { name: "authorizerType", type: "string" },
    { name: "authorizer", type: "address" },
    { name: "agentId", type: "string" },
    { name: "executor", type: "address" },
    { name: "issuedAt", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "authorizationNonce", type: "bytes32" },
    { name: "maxUses", type: "uint256" },
    { name: "audience", type: "string" },
    { name: "policyHash", type: "bytes32" }
  ]
};
const same = (left, right) => String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
async function recoverAuthorizer(authorization) {
  const typedData = {
    domain: { name: "PriorSeal", version: "2", chainId: authorization.intent.chainId },
    types: AUTHORIZATION_TYPES,
    primaryType: "PriorSealAuthorization",
    message: {
      // `intent.intentHash` is stored as bare lowercase hex; the EIP-712 struct
      // uses the 0x-prefixed 32-byte form. The other three bytes32 fields are
      // already 0x-prefixed in the signed authorization.
      intentHash: `0x${authorization.intentHash.replace(/^0x/, "")}`,
      principalType: authorization.principal.type,
      principalId: authorization.principal.id,
      principalAccount: authorization.principal.account,
      authorizerType: authorization.authorizer.type,
      authorizer: authorization.authorizer.address,
      agentId: authorization.delegate.agentId,
      executor: authorization.delegate.executor,
      issuedAt: BigInt(authorization.issuedAt),
      notBefore: BigInt(authorization.notBefore),
      expiresAt: BigInt(authorization.expiresAt),
      authorizationNonce: authorization.authorizationNonce,
      maxUses: BigInt(authorization.maxUses),
      audience: authorization.audience,
      policyHash: authorization.policyHash
    }
  };
  const digest = hashTypedData(typedData);
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    signature: authorization.signature
  });
  return {
    digest,
    recovered,
    declaredAuthorizer: authorization.authorizer.address,
    matchesDeclaredAuthorizer: same(recovered, authorization.authorizer.address)
  };
}
function bindEnvelope(authorization, observed) {
  const intent = authorization.intent;
  const mismatch = [];
  if (observed.chainId !== intent.chainId) mismatch.push("CHAIN_MISMATCH");
  if (!same(observed.action, intent.action)) mismatch.push("ACTION_MISMATCH");
  if (!same(observed.sender, intent.sender)) mismatch.push("SENDER_MISMATCH");
  if (String(observed.nonce ?? "") !== String(intent.nonce ?? "0")) mismatch.push("NONCE_MISMATCH");
  if (intent.callTarget != null && !same(observed.target, intent.callTarget)) mismatch.push("CALL_TARGET_MISMATCH");
  if (intent.calldataHash != null && !same(observed.calldataHash, intent.calldataHash)) mismatch.push("CALLDATA_MISMATCH");
  if (intent.transactionValue != null && String(observed.nativeValue ?? "") !== String(intent.transactionValue)) mismatch.push("TRANSACTION_VALUE_MISMATCH");
  const executedAt = observed.executedAt ?? observed.observedAt;
  if (executedAt != null && executedAt > intent.validUntil) mismatch.push("OUTSIDE_TIME_WINDOW");
  if (executedAt != null && (executedAt < authorization.notBefore || executedAt > authorization.expiresAt)) mismatch.push("OUTSIDE_AUTHORIZATION_WINDOW");
  const availability = [];
  if (observed.executionDataAvailable === false) availability.push("EXECUTION_UNAVAILABLE");
  const mismatchCodes = [...new Set(mismatch)].sort();
  const availabilityCodes = [...new Set(availability)].sort();
  return { bound: mismatchCodes.length === 0, mismatchCodes, availabilityCodes };
}
export {
  EXACT_CALL_PROFILE,
  bindEnvelope,
  recoverAuthorizer
};
