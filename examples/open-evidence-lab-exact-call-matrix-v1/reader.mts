// Open Evidence Lab reader for the PriorSeal exact-call envelope matrix.
//
// This file is an INDEPENDENT implementation of the documented comparison. It
// deliberately imports nothing from PriorSeal: it rebuilds the EIP-712 typed
// data from the field list published in INPUT-CONTRACT.md and applies the
// published field map by hand. Only `viem` (a general Ethereum library) and the
// Node standard library are used.
//
// It answers one narrow question per case: does the observed execution envelope
// match the envelope bound by the signed authorization? It does not interpret
// calldata, does not assess economic outcome and does not speak for PriorSeal.
import { hashTypedData, recoverTypedDataAddress } from 'viem';

export const EXACT_CALL_PROFILE = 'priorseal.execution-profile.exact-call.v1';

// Transcribed from the published contract (INPUT-CONTRACT.md), not imported.
const AUTHORIZATION_TYPES = {
  PriorSealAuthorization: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'principalType', type: 'string' },
    { name: 'principalId', type: 'string' },
    { name: 'principalAccount', type: 'address' },
    { name: 'authorizerType', type: 'string' },
    { name: 'authorizer', type: 'address' },
    { name: 'agentId', type: 'string' },
    { name: 'executor', type: 'address' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'notBefore', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'authorizationNonce', type: 'bytes32' },
    { name: 'maxUses', type: 'uint256' },
    { name: 'audience', type: 'string' },
    { name: 'policyHash', type: 'bytes32' },
  ],
} as const;

export type SignedIntent = {
  chainId: number;
  action: string;
  sender: string;
  nonce?: string | null;
  validUntil: number;
  executionProfile?: string | null;
  callTarget?: string | null;
  calldataHash?: string | null;
  transactionValue?: string | null;
};

export type SignedAuthorization = {
  schema: string;
  domain: string;
  intent: SignedIntent & { intentHash: string };
  intentHash: string;
  authorizer: { type: string; address: string };
  delegate: { agentId: string; executor: string };
  principal: { type: string; id: string; account: string };
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
  authorizationNonce: string;
  maxUses: string;
  audience: string;
  policyHash: string;
  signature: string;
};

export type ObservedEnvelope = {
  chainId?: number | string | null;
  action?: string | null;
  sender?: string | null;
  nonce?: string | null;
  target?: string | null;
  calldataHash?: string | null;
  nativeValue?: string | null;
  executedAt?: number | null;
  observedAt?: number | null;
  executionDataAvailable?: boolean;
};

const same = (left: unknown, right: unknown): boolean =>
  String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();

/** Rebuild the documented EIP-712 digest and recover the signer. */
export async function recoverAuthorizer(authorization: SignedAuthorization) {
  const typedData = {
    domain: { name: 'PriorSeal', version: '2', chainId: authorization.intent.chainId },
    types: AUTHORIZATION_TYPES,
    primaryType: 'PriorSealAuthorization' as const,
    message: {
      // `intent.intentHash` is stored as bare lowercase hex; the EIP-712 struct
      // uses the 0x-prefixed 32-byte form. The other three bytes32 fields are
      // already 0x-prefixed in the signed authorization.
      intentHash: `0x${authorization.intentHash.replace(/^0x/, '')}` as `0x${string}`,
      principalType: authorization.principal.type,
      principalId: authorization.principal.id,
      principalAccount: authorization.principal.account as `0x${string}`,
      authorizerType: authorization.authorizer.type,
      authorizer: authorization.authorizer.address as `0x${string}`,
      agentId: authorization.delegate.agentId,
      executor: authorization.delegate.executor as `0x${string}`,
      issuedAt: BigInt(authorization.issuedAt),
      notBefore: BigInt(authorization.notBefore),
      expiresAt: BigInt(authorization.expiresAt),
      authorizationNonce: authorization.authorizationNonce as `0x${string}`,
      maxUses: BigInt(authorization.maxUses),
      audience: authorization.audience,
      policyHash: authorization.policyHash as `0x${string}`,
    },
  };
  const digest = hashTypedData(typedData);
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    signature: authorization.signature as `0x${string}`,
  });
  return {
    digest,
    recovered,
    declaredAuthorizer: authorization.authorizer.address,
    matchesDeclaredAuthorizer: same(recovered, authorization.authorizer.address),
  };
}

/**
 * Published field map for `priorseal.execution-profile.exact-call.v1`,
 * contract v1.0.1. Returns the two published sets:
 *
 *   - `mismatchCodes`      — §4 envelope-mismatch codes; these alone decide `bound`.
 *   - `availabilityCodes`  — §5 evidence-availability codes; reported beside the
 *                            result, never inside the deciding set.
 *
 * Both sets are deterministic (sorted, de-duplicated).
 */
export function bindEnvelope(authorization: SignedAuthorization, observed: ObservedEnvelope) {
  const intent = authorization.intent;
  const mismatch: string[] = [];
  if (observed.chainId !== intent.chainId) mismatch.push('CHAIN_MISMATCH');
  if (!same(observed.action, intent.action)) mismatch.push('ACTION_MISMATCH');
  if (!same(observed.sender, intent.sender)) mismatch.push('SENDER_MISMATCH');
  if (String(observed.nonce ?? '') !== String(intent.nonce ?? '0')) mismatch.push('NONCE_MISMATCH');
  if (intent.callTarget != null && !same(observed.target, intent.callTarget)) mismatch.push('CALL_TARGET_MISMATCH');
  if (intent.calldataHash != null && !same(observed.calldataHash, intent.calldataHash)) mismatch.push('CALLDATA_MISMATCH');
  if (intent.transactionValue != null && String(observed.nativeValue ?? '') !== String(intent.transactionValue)) mismatch.push('TRANSACTION_VALUE_MISMATCH');
  const executedAt = observed.executedAt ?? observed.observedAt;
  if (executedAt != null && executedAt > intent.validUntil) mismatch.push('OUTSIDE_TIME_WINDOW');
  if (executedAt != null && (executedAt < authorization.notBefore || executedAt > authorization.expiresAt)) mismatch.push('OUTSIDE_AUTHORIZATION_WINDOW');
  const availability: string[] = [];
  if (observed.executionDataAvailable === false) availability.push('EXECUTION_UNAVAILABLE');
  const mismatchCodes = [...new Set(mismatch)].sort();
  const availabilityCodes = [...new Set(availability)].sort();
  return { bound: mismatchCodes.length === 0, mismatchCodes, availabilityCodes };
}
