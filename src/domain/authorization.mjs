import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { encodeFunctionData, hashTypedData, verifyTypedData } from 'viem';
import { bindIntentExecution } from './binding.mjs';
import { PriorSealError } from './errors.mjs';
import { hashJson, canonicalize } from './hashing.mjs';
import { buildIntent } from './intent.mjs';
import { classifyOutcome } from './outcome.mjs';
import { evaluateAuthorizationPolicy } from './intent-policy.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';
import { evmAddress, protocolId, uintString, unixSeconds } from './values.mjs';
import { verifyTransparencyEvidence } from './transparency.mjs';
import { verifyWitnessEvidence } from './witness.mjs';
import { validateTimestampEvidenceClaims, verifyTimestampEvidence } from './rfc3161.mjs';

export const AUTHORIZATION_SCHEMA = 'priorseal.authorization.v1';
export const AUTHORIZATION_RECEIPT_SCHEMA = 'priorseal.authorization-receipt.v1';
export const AUTHORIZATION_DOMAIN = 'priorseal/authorization/v1';
export const AUTHORIZED_RECEIPT_SCHEMA = 'priorseal.execution-receipt.v2';

const AUTHORIZATION_TYPES = Object.freeze({
  PriorSealAuthorization: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'principalId', type: 'string' },
    { name: 'principalAccount', type: 'address' },
    { name: 'authorizer', type: 'address' },
    { name: 'executor', type: 'address' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'notBefore', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'authorizationNonce', type: 'bytes32' },
    { name: 'maxUses', type: 'uint256' },
    { name: 'audience', type: 'string' },
    { name: 'policyHash', type: 'bytes32' },
  ],
});

export function buildAuthorization(input) {
  assertSafeJson(input);
  assertOnlyFields(input, ['schema', 'domain', 'authorizationId', 'intent', 'intentHash', 'principal', 'authorizer', 'delegate', 'issuedAt', 'notBefore', 'expiresAt', 'authorizationNonce', 'maxUses', 'audience', 'policyHash', 'signature'], 'authorization');
  assertOnlyFields(input.principal, ['type', 'id', 'account'], 'authorization.principal');
  assertOnlyFields(input.authorizer, ['type', 'address'], 'authorization.authorizer');
  assertOnlyFields(input.delegate, ['agentId', 'executor'], 'authorization.delegate');
  if (!input.principal?.id || !input.delegate?.agentId) throw new PriorSealError('INVALID_AUTHORIZATION', 'principal.id and delegate.agentId are required');
  const intent = buildIntent(stripIntentMetadata(input.intent));
  if (input.intentHash && input.intentHash !== intent.intentHash) throw new PriorSealError('INVALID_AUTHORIZATION', 'intentHash does not match intent');
  const authorizerType = String(input.authorizer?.type ?? '');
  if (!['eip712', 'eip1271'].includes(authorizerType)) throw new PriorSealError('INVALID_AUTHORIZATION', 'authorizer.type must be eip712 or eip1271');
  const principalType = String(input.principal?.type ?? '');
  if (!['user', 'organization'].includes(principalType)) throw new PriorSealError('INVALID_AUTHORIZATION', 'principal.type must be user or organization');
  const issuedAt = unixSeconds(input.issuedAt, 'issuedAt');
  const notBefore = unixSeconds(input.notBefore ?? input.issuedAt, 'notBefore');
  const expiresAt = unixSeconds(input.expiresAt ?? intent.validUntil, 'expiresAt');
  if (notBefore < issuedAt || expiresAt < notBefore || expiresAt > intent.validUntil) throw new PriorSealError('INVALID_AUTHORIZATION', 'authorization time window must be ordered and cannot exceed the intent validity');
  const authorizationNonce = String(input.authorizationNonce ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(authorizationNonce)) throw new PriorSealError('INVALID_AUTHORIZATION', 'authorizationNonce must be a 32-byte hex value');
  const policyHash = String(input.policyHash ?? `0x${'0'.repeat(64)}`).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(policyHash)) throw new PriorSealError('INVALID_AUTHORIZATION', 'policyHash must be a 32-byte hex value');
  const maxUses = uintString(input.maxUses ?? '1', 'maxUses');
  if (maxUses !== '1') throw new PriorSealError('INVALID_AUTHORIZATION', 'v1 authorizations are single-use and maxUses must be 1');
  const authorization = {
    schema: AUTHORIZATION_SCHEMA,
    domain: AUTHORIZATION_DOMAIN,
    intent,
    intentHash: intent.intentHash,
    principal: { type: principalType, id: protocolId(input.principal?.id, 'principal.id'), account: evmAddress(input.principal?.account, 'principal.account') },
    authorizer: { type: authorizerType, address: evmAddress(input.authorizer?.address, 'authorizer.address') },
    delegate: { agentId: protocolId(input.delegate?.agentId, 'delegate.agentId'), executor: evmAddress(input.delegate?.executor, 'delegate.executor') },
    issuedAt,
    notBefore,
    expiresAt,
    authorizationNonce,
    maxUses,
    audience: protocolId(input.audience ?? 'priorseal', 'audience'),
    policyHash,
    ...(input.signature ? { signature: String(input.signature) } : {}),
  };
  if (authorization.principal.account !== authorization.authorizer.address) throw new PriorSealError('INVALID_AUTHORIZATION', 'principal.account must be the signing account');
  const { signature, ...unsigned } = authorization;
  const authorizationId = `auth_${hashJson(unsigned).slice(0, 32)}`;
  if (input.authorizationId && input.authorizationId !== authorizationId) throw new PriorSealError('INVALID_AUTHORIZATION', 'authorizationId does not match authorization');
  return { ...authorization, authorizationId };
}

export function authorizationTypedData(value) {
  const authorization = value.schema === AUTHORIZATION_SCHEMA ? value : buildAuthorization(value);
  return {
    domain: { name: 'PriorSeal', version: '1', chainId: authorization.intent.chainId },
    types: AUTHORIZATION_TYPES,
    primaryType: 'PriorSealAuthorization',
    message: {
      intentHash: `0x${authorization.intentHash}`,
      principalId: authorization.principal.id,
      principalAccount: authorization.principal.account,
      authorizer: authorization.authorizer.address,
      executor: authorization.delegate.executor,
      issuedAt: BigInt(authorization.issuedAt),
      notBefore: BigInt(authorization.notBefore),
      expiresAt: BigInt(authorization.expiresAt),
      authorizationNonce: authorization.authorizationNonce,
      maxUses: BigInt(authorization.maxUses),
      audience: authorization.audience,
      policyHash: authorization.policyHash,
    },
  };
}

export async function verifyAuthorization(value, { now = Math.floor(Date.now() / 1000), audience = 'priorseal', verifyContractSignature } = {}) {
  let authorization;
  try { authorization = buildAuthorization(value); } catch (error) { return invalid(error.code ?? 'INVALID_AUTHORIZATION'); }
  if (!authorization.signature) return invalid('MISSING_AUTHORIZATION_SIGNATURE');
  if (authorization.audience !== audience) return invalid('AUTHORIZATION_AUDIENCE_MISMATCH');
  if (authorization.issuedAt > now) return invalid('AUTHORIZATION_ISSUED_IN_FUTURE');
  if (now < authorization.notBefore) return invalid('AUTHORIZATION_NOT_YET_VALID');
  if (now > authorization.expiresAt) return invalid('AUTHORIZATION_EXPIRED');
  const typedData = authorizationTypedData(authorization);
  try {
    const valid = authorization.authorizer.type === 'eip1271'
      ? Boolean(verifyContractSignature && await verifyContractSignature({ authorization, digest: hashTypedData(typedData), signature: authorization.signature }))
      : await verifyTypedData({ ...typedData, address: authorization.authorizer.address, signature: authorization.signature });
    return valid ? { valid: true, code: 'OK', authorization } : invalid(authorization.authorizer.type === 'eip1271' && !verifyContractSignature ? 'AUTHORIZATION_VERIFIER_UNAVAILABLE' : 'INVALID_AUTHORIZATION_SIGNATURE');
  } catch { return invalid('INVALID_AUTHORIZATION_SIGNATURE'); }
}

export function erc1271CallData(digest, signature) {
  return encodeFunctionData({ abi: [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }], outputs: [{ name: 'magicValue', type: 'bytes4' }] }], functionName: 'isValidSignature', args: [digest, signature] });
}

export function buildAuthorizationReceipt({ authorization, issuer, keyId = 'default', acceptedAt, sequence = 1, previousEntryHash = null }) {
  const authorizationHash = hashJson(authorization);
  const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
  return { schema: AUTHORIZATION_RECEIPT_SCHEMA, domain: 'priorseal/authorization-receipt/v1', authorizationId: authorization.authorizationId, authorizationHash, intentHash: authorization.intentHash, acceptedAt, sequence, previousEntryHash, entryHash, status: 'ACCEPTED', issuer, algorithm: 'Ed25519', keyId };
}

export function signAuthorizationReceipt(receipt, privateKeyPem) {
  return { ...receipt, signature: sign(null, Buffer.from(canonicalize(receipt)), createPrivateKey(privateKeyPem)).toString('base64url') };
}

export function verifyAuthorizationReceipt(receipt, publicKeyPem) {
  const { signature, ...unsigned } = receipt ?? {};
  if (!signature || receipt.schema !== AUTHORIZATION_RECEIPT_SCHEMA) return false;
  if (receipt.entryHash !== hashJson({ sequence: receipt.sequence, authorizationHash: receipt.authorizationHash, acceptedAt: receipt.acceptedAt, previousEntryHash: receipt.previousEntryHash })) return false;
  try { return verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')); } catch { return false; }
}

export function buildAuthorizedReceipt({ authorization, acceptance, policyEvidence = null, timestampEvidence = null, witnessEvidence = null, transparency = null, execution, issuer, keyId = 'default', issuedAt = Math.floor(Date.now() / 1000), verifierVersion = '2.2.0' }) {
  const intent = authorization.intent;
  const evidencePolicy = policyEvidence ?? defaultPolicyEvidence(authorization, acceptance.acceptedAt);
  validatePolicyEvidence(authorization, evidencePolicy, acceptance.acceptedAt);
  const baseBinding = bindIntentExecution(intent, execution, issuedAt);
  const executorMismatch = execution.sender?.toLowerCase() !== authorization.delegate.executor;
  const executedAt = execution.executedAt ?? execution.observedAt ?? 0;
  const timestampPolicy = evidencePolicy.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = validateTimestampEvidenceClaims(timestampEvidence, timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: acceptance.acceptedAt, before: executedAt });
    if (!timestamped.valid) throw new PriorSealError(timestamped.code, 'Valid pre-execution RFC 3161 evidence is required', timestamped);
  } else if (timestampEvidence) throw new PriorSealError('TIMESTAMP_POLICY_MISMATCH', 'Timestamp evidence is not bound by the signed authorization policy');
  const witnessPolicy = evidencePolicy.document?.witnessQuorum;
  if (witnessPolicy) {
    const witnessed = verifyWitnessEvidence(witnessEvidence, authorization, witnessPolicy, { expectedRequestedAt: acceptance.acceptedAt, before: executedAt });
    if (!witnessed.valid) throw new PriorSealError(witnessed.code, 'A valid pre-execution witness quorum is required', witnessed);
  } else if (witnessEvidence) throw new PriorSealError('WITNESS_POLICY_MISMATCH', 'Witness evidence is not bound by the signed authorization policy');
  const authorizationAfterExecution = acceptance.acceptedAt > executedAt;
  const outsideAuthorizationWindow = executedAt < authorization.notBefore || executedAt > authorization.expiresAt;
  const binding = { bound: baseBinding.bound && !executorMismatch && !authorizationAfterExecution && !outsideAuthorizationWindow, reasonCodes: [...new Set([...baseBinding.reasonCodes, ...(executorMismatch ? ['EXECUTOR_MISMATCH'] : []), ...(authorizationAfterExecution ? ['AUTHORIZATION_AFTER_EXECUTION'] : []), ...(outsideAuthorizationWindow ? ['OUTSIDE_AUTHORIZATION_WINDOW'] : [])])] };
  const executionHash = hashJson(execution);
  const authorizationHash = hashJson(authorization);
  const outcome = executorMismatch || authorizationAfterExecution || outsideAuthorizationWindow ? 'UNDETERMINED' : classifyOutcome(intent, execution);
  const reasonCodes = binding.reasonCodes;
  const unsigned = { schema: AUTHORIZED_RECEIPT_SCHEMA, domain: 'priorseal/execution-receipt/v2', receiptId: '', intentHash: intent.intentHash, authorizationHash, executionHash, authorizationEvidence: { authorization, acceptance, policy: evidencePolicy, ...(timestampEvidence ? { timestamp: timestampEvidence } : {}), ...(witnessEvidence ? { witnesses: witnessEvidence } : {}), ...(transparency ? { transparency } : {}) }, execution, issuer, issuedAt, validUntil: intent.validUntil, outcome, reasonCodes, binding, algorithm: 'Ed25519', keyId, verifierVersion };
  unsigned.receiptId = authorizedReceiptId(unsigned);
  return unsigned;
}

export function authorizedReceiptId(receipt) {
  return `psr_${hashJson({ authorizationHash: receipt.authorizationHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId }).slice(0, 32)}`;
}

export function validateAuthorizedReceiptClaims(receipt) {
  try {
    if (receipt?.schema !== AUTHORIZED_RECEIPT_SCHEMA || receipt.domain !== 'priorseal/execution-receipt/v2') return invalid('UNSUPPORTED_SCHEMA');
    const authorization = buildAuthorization(receipt.authorizationEvidence?.authorization);
    const acceptance = receipt.authorizationEvidence?.acceptance;
    if (!acceptance || acceptance.authorizationId !== authorization.authorizationId) return invalid('AUTHORIZATION_RECEIPT_MISMATCH');
    if (receipt.authorizationHash !== hashJson(authorization) || acceptance.authorizationHash !== receipt.authorizationHash) return invalid('AUTHORIZATION_HASH_MISMATCH');
    validatePolicyEvidence(authorization, receipt.authorizationEvidence?.policy, acceptance.acceptedAt);
    const timestampPolicy = receipt.authorizationEvidence?.policy?.document?.timestampPolicy;
    if (timestampPolicy) {
      const executedAt = receipt.execution?.executedAt ?? receipt.execution?.observedAt ?? 0;
      const timestamped = validateTimestampEvidenceClaims(receipt.authorizationEvidence?.timestamp, timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: acceptance.acceptedAt, before: executedAt });
      if (!timestamped.valid) return invalid(timestamped.code);
    } else if (receipt.authorizationEvidence?.timestamp) return invalid('TIMESTAMP_POLICY_MISMATCH');
    const witnessPolicy = receipt.authorizationEvidence?.policy?.document?.witnessQuorum;
    if (witnessPolicy) {
      const executedAt = receipt.execution?.executedAt ?? receipt.execution?.observedAt ?? 0;
      const witnessed = verifyWitnessEvidence(receipt.authorizationEvidence?.witnesses, authorization, witnessPolicy, { expectedRequestedAt: acceptance.acceptedAt, before: executedAt });
      if (!witnessed.valid) return invalid(witnessed.code);
    } else if (receipt.authorizationEvidence?.witnesses) return invalid('WITNESS_POLICY_MISMATCH');
    if (receipt.intentHash !== authorization.intentHash || authorization.intentHash !== hashJson(stripIntentHash(authorization.intent))) return invalid('INTENT_HASH_MISMATCH');
    if (receipt.executionHash !== hashJson(receipt.execution)) return invalid('EXECUTION_HASH_MISMATCH');
    if (receipt.receiptId !== authorizedReceiptId(receipt)) return invalid('RECEIPT_ID_MISMATCH');
    const baseBinding = bindIntentExecution(authorization.intent, receipt.execution, receipt.issuedAt);
    const executorMismatch = receipt.execution.sender?.toLowerCase() !== authorization.delegate.executor;
    const executedAt = receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0;
    const authorizationAfterExecution = acceptance.acceptedAt > executedAt;
    const outsideAuthorizationWindow = executedAt < authorization.notBefore || executedAt > authorization.expiresAt;
    const binding = { bound: baseBinding.bound && !executorMismatch && !authorizationAfterExecution && !outsideAuthorizationWindow, reasonCodes: [...new Set([...baseBinding.reasonCodes, ...(executorMismatch ? ['EXECUTOR_MISMATCH'] : []), ...(authorizationAfterExecution ? ['AUTHORIZATION_AFTER_EXECUTION'] : []), ...(outsideAuthorizationWindow ? ['OUTSIDE_AUTHORIZATION_WINDOW'] : [])])] };
    if (hashJson(binding) !== hashJson(receipt.binding)) return invalid('BINDING_MISMATCH');
    if (hashJson(binding.reasonCodes) !== hashJson(receipt.reasonCodes)) return invalid('REASON_CODES_MISMATCH');
    const expectedOutcome = executorMismatch || authorizationAfterExecution || outsideAuthorizationWindow ? 'UNDETERMINED' : classifyOutcome(authorization.intent, receipt.execution);
    if (expectedOutcome !== receipt.outcome) return invalid('OUTCOME_MISMATCH');
    return { valid: true, code: 'OK', authorization };
  } catch (error) { return invalid(error.code ?? 'INVALID_RECEIPT'); }
}

export async function verifyAuthorizedReceipt(receipt, publicKeyPem, options = {}) {
  const fail = (code) => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId });
  const claims = validateAuthorizedReceiptClaims(receipt);
  if (!claims.valid) return fail(claims.code);
  const acceptance = receipt.authorizationEvidence.acceptance;
  if (acceptance.issuer !== receipt.issuer || acceptance.keyId !== receipt.keyId || !verifyAuthorizationReceipt(acceptance, publicKeyPem)) return fail('INVALID_AUTHORIZATION_RECEIPT');
  const timestampPolicy = receipt.authorizationEvidence.policy?.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = await verifyTimestampEvidence(receipt.authorizationEvidence.timestamp, new TextEncoder().encode(canonicalize(claims.authorization)), timestampPolicy, { authorizationHash: receipt.authorizationHash, requestedAt: acceptance.acceptedAt, before: receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0 });
    if (!timestamped.valid) return fail(timestamped.code);
  }
  if (receipt.authorizationEvidence.transparency && !verifyTransparencyEvidence(receipt.authorizationEvidence.transparency, acceptance, publicKeyPem)) return fail('INVALID_TRANSPARENCY_PROOF');
  const authorizationResult = await verifyAuthorization(claims.authorization, { now: acceptance.acceptedAt, audience: options.audience ?? 'priorseal', verifyContractSignature: options.verifyContractSignature });
  if (!authorizationResult.valid) return fail(authorizationResult.code);
  if (!verifyEd25519Statement(receipt, publicKeyPem)) return fail('INVALID_SIGNATURE');
  return { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId, authorizationId: claims.authorization.authorizationId };
}

function verifyEd25519Statement(statement, publicKeyPem) {
  const { signature, ...unsigned } = statement ?? {};
  if (!signature) return false;
  try { return verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')); } catch { return false; }
}

function stripIntentHash(intent) { const { intentHash, ...unsigned } = intent; return unsigned; }
function stripIntentMetadata(intent) { const { schema, intentHash, ...input } = intent ?? {}; return input; }
function defaultPolicyEvidence(authorization, evaluatedAt) {
  if (authorization.policyHash !== `0x${'0'.repeat(64)}`) throw new PriorSealError('MISSING_POLICY_EVIDENCE', 'A non-default policy must be embedded in an authorized receipt');
  return { schema: 'priorseal.policy-evidence.v1', policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt } };
}
function validatePolicyEvidence(authorization, evidence, evaluatedAt) {
  if (!evidence || evidence.schema !== 'priorseal.policy-evidence.v1') throw new PriorSealError('INVALID_POLICY_EVIDENCE', 'Policy evidence is missing or malformed');
  const expectedHash = evidence.document ? `0x${hashJson(evidence.document)}` : `0x${'0'.repeat(64)}`;
  if (evidence.policyHash !== authorization.policyHash || evidence.policyHash !== expectedHash) throw new PriorSealError('INVALID_POLICY_EVIDENCE', 'Policy evidence hash does not match the authorization');
  const expectedResult = evidence.document ? evaluateAuthorizationPolicy(authorization, evidence.document, evaluatedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt };
  if (!expectedResult.allowed || hashJson(expectedResult) !== hashJson(evidence.result)) throw new PriorSealError('INVALID_POLICY_EVIDENCE', 'Policy evaluation does not match the embedded policy');
  return true;
}
function invalid(code) { return { valid: false, code }; }
