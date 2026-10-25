import { hashTypedData, keccak256, toBytes, verifyTypedData } from "viem";
import type { KeyRegistry } from "verify-insight-receipt";

import { matchUniqueContextCommitment } from "./context-commitment.js";
import { buildExactCallIntent } from "./exact-call.js";
import type {
  Authorization,
  ContextCommitment,
  ExactCallIntentInput,
  Intent,
  Receipt,
} from "./types.js";
import { verifyReceiptLocally, type LocalVerifierOptions } from "./verifier.js";

export const INSIGHT_BASE_LENDING_GUARD_NAMESPACE =
  "insight.base-lending-guard.v1" as const;
export const INSIGHT_BASE_LENDING_GUARD_SCHEMA =
  "insight.base-lending-guard-decision.v1" as const;
export const BASE_LENDING_GUARD_INTENT_ASSET_PREFIX =
  "eip155:8453/lending:" as const;

const DOMAIN = {
  name: "Insight Base Lending Guard",
  version: "1",
  chainId: 1,
} as const;
const TYPES = {
  BaseLendingGuardDecision: [
    { name: "decisionHash", type: "bytes32" },
    { name: "calldataHash", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
  ],
} as const;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const VALID_FOR_SECONDS = 300;
const LABEL = "Insight Base Lending Guard attester";
const SUPPORTED_PROTOCOL_IDS = [
  "aave-v3-base",
  "morpho-blue-base",
  "compound-v3-base",
  "moonwell-base",
] as const;
type SupportedProtocolId = (typeof SUPPORTED_PROTOCOL_IDS)[number];

export type InsightBaseLendingGuardDecision = {
  schema: typeof INSIGHT_BASE_LENDING_GUARD_SCHEMA;
  guard: {
    schema: "insight.base-lending-guard.v1";
    verdict: "ALLOW" | "CAUTION" | "BLOCK";
    protocolId: SupportedProtocolId;
    action: "supply" | "borrow";
    scope: { chainId: 8453; [key: string]: unknown };
    [key: string]: unknown;
  };
  transaction: {
    chainId: 8453;
    from: string;
    to: string;
    data: `0x${string}`;
    nonce: string | number;
    value: string | number;
  };
  action: {
    protocolId: SupportedProtocolId;
    action: "supply" | "borrow";
    target: string;
    calldataHash: `0x${string}`;
    amount: string;
    account: string;
    receiver: string | null;
    asset: string | null;
    marketId: string | null;
  };
  decisionHash: `0x${string}`;
  attestation: {
    type: "BaseLendingGuardDecision";
    schemaVersion: 1;
    uid: `0x${string}`;
    attester: string;
    attesterLabel: typeof LABEL;
    signedAt: string;
    validForSeconds: 300;
    signature: `0x${string}`;
    verifyUrl: string;
    data: {
      decisionHash: `0x${string}`;
      calldataHash: `0x${string}`;
      account: string;
      chainId: 8453;
      verdict: 0 | 1 | 2;
      issuedAt: number;
      validUntil: number;
      schemaVersion: 1;
    };
    eip712: Record<string, unknown>;
  } | null;
};

export type InsightBaseLendingGuardVerification = {
  valid: boolean;
  signatureValid: boolean;
  trusted: boolean;
  expired: boolean;
  reason: string;
  decisionHash: string | null;
  attester: string | null;
  issuedAt: number | null;
  validUntil: number | null;
};

type GuardVerificationOptions = {
  keyRegistry?: KeyRegistry;
  now?: number;
  allowHistorical?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64)
    throw new TypeError("Base lending decision exceeds canonical JSON depth");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length > 20_000)
      throw new TypeError("Base lending decision is too large");
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (
      keys.length > 20_000 ||
      keys.some((key) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new TypeError("Unsafe Base lending decision JSON");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("Base lending decision is not canonical JSON");
}

function uint(value: unknown): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
  )
    return null;
  const result = String(value);
  return UINT.test(result) ? result : null;
}

function verdictCode(verdict: string): 0 | 1 | 2 | null {
  return verdict === "ALLOW"
    ? 0
    : verdict === "CAUTION"
      ? 1
      : verdict === "BLOCK"
        ? 2
        : null;
}

function validVerificationUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === "/api/v1/safety/base-lending-guard/verify"
    );
  } catch {
    return false;
  }
}

function registryTrust(
  registry: KeyRegistry | undefined,
  address: string,
  issuedAt: number,
): boolean {
  if (
    !registry ||
    !isRecord(registry) ||
    (registry.public_keys && registry.keys) ||
    (registry.revoked_keys && registry.revoked)
  )
    return false;
  const rawKeys = registry.public_keys ?? registry.keys;
  if (!Array.isArray(rawKeys) || rawKeys.length < 1 || rawKeys.length > 100)
    return false;
  const matches = rawKeys.filter(
    (key) =>
      isRecord(key) &&
      typeof key.public_key === "string" &&
      key.public_key.toLowerCase() === address.toLowerCase(),
  );
  if (matches.length !== 1) return false;
  const key = matches[0];
  if (
    key.revoked !== false ||
    (key.role !== undefined && key.role !== "attester") ||
    typeof key.key_id !== "string" ||
    typeof key.validFrom !== "string" ||
    !Number.isFinite(Date.parse(key.validFrom)) ||
    (key.validUntil !== null &&
      (typeof key.validUntil !== "string" ||
        !Number.isFinite(Date.parse(key.validUntil))))
  )
    return false;
  const validFrom = Date.parse(key.validFrom) / 1000;
  const validUntil =
    key.validUntil === null ? null : Date.parse(key.validUntil) / 1000;
  if (issuedAt < validFrom || (validUntil !== null && issuedAt >= validUntil))
    return false;
  const revoked = registry.revoked_keys ?? registry.revoked ?? [];
  return (
    Array.isArray(revoked) &&
    !revoked.some((item) => isRecord(item) && item.key_id === key.key_id)
  );
}

function asDecision(value: unknown): InsightBaseLendingGuardDecision | null {
  if (
    !isRecord(value) ||
    value.schema !== INSIGHT_BASE_LENDING_GUARD_SCHEMA ||
    !isRecord(value.guard) ||
    !isRecord(value.transaction) ||
    !isRecord(value.action) ||
    !isRecord(value.attestation)
  )
    return null;
  return value as unknown as InsightBaseLendingGuardDecision;
}

function unsignedDecision(decision: InsightBaseLendingGuardDecision) {
  return {
    schema: decision.schema,
    guard: decision.guard,
    transaction: decision.transaction,
    action: decision.action,
  };
}

/** The namespaced, opaque commitment that an exact PriorSeal intent carries. */
export function baseLendingGuardCommitment(
  decision: Pick<InsightBaseLendingGuardDecision, "decisionHash">,
): ContextCommitment {
  if (!HEX32.test(decision.decisionHash))
    throw new TypeError("Base lending decision hash must be 32-byte hex");
  return {
    namespace: INSIGHT_BASE_LENDING_GUARD_NAMESPACE,
    algorithm: "keccak256",
    digest: decision.decisionHash.toLowerCase() as `0x${string}`,
  };
}

/** The non-token asset label used to prevent token-unit semantics being invented for a lending call. */
export function baseLendingGuardIntentAsset(
  protocolId: InsightBaseLendingGuardDecision["guard"]["protocolId"],
): string {
  return `${BASE_LENDING_GUARD_INTENT_ASSET_PREFIX}${protocolId}`;
}

/** Independently verify Insight's EIP-712 decision and exact calldata binding. */
export async function verifyInsightBaseLendingGuardDecision(
  value: unknown,
  options: GuardVerificationOptions = {},
): Promise<InsightBaseLendingGuardVerification> {
  const empty = {
    valid: false,
    signatureValid: false,
    trusted: false,
    expired: false,
    reason: "MALFORMED",
    decisionHash: null,
    attester: null,
    issuedAt: null,
    validUntil: null,
  } as const;
  try {
    const decision = asDecision(value);
    if (!decision || !decision.attestation)
      return { ...empty, reason: "MISSING_OR_MALFORMED_ATTESTATION" };
    const { guard, transaction, action, attestation } = decision;
    const data = attestation.data;
    const nonce = uint(transaction.nonce),
      valueString = uint(transaction.value);
    const expectedVerdict = verdictCode(guard.verdict);
    if (
      guard.schema !== "insight.base-lending-guard.v1" ||
      !SUPPORTED_PROTOCOL_IDS.includes(guard.protocolId as SupportedProtocolId) ||
      !["supply", "borrow"].includes(guard.action) ||
      !isRecord(guard.scope) ||
      guard.scope.chainId !== 8453 ||
      transaction.chainId !== 8453 ||
      !ADDRESS.test(transaction.from) ||
      !ADDRESS.test(transaction.to) ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction.data) ||
      nonce === null ||
      valueString !== "0" ||
      action.protocolId !== guard.protocolId ||
      action.action !== guard.action ||
      !ADDRESS.test(action.target) ||
      action.target.toLowerCase() !== transaction.to.toLowerCase() ||
      !HEX32.test(action.calldataHash) ||
      action.calldataHash.toLowerCase() !==
        keccak256(transaction.data).toLowerCase() ||
      !UINT.test(action.amount) ||
      !ADDRESS.test(action.account) ||
      action.account.toLowerCase() !== transaction.from.toLowerCase() ||
      (action.receiver !== null &&
        (!ADDRESS.test(action.receiver) ||
          action.receiver.toLowerCase() !== transaction.from.toLowerCase())) ||
      (action.asset !== null && !ADDRESS.test(action.asset)) ||
      (action.marketId !== null && !HEX32.test(action.marketId)) ||
      !HEX32.test(decision.decisionHash) ||
      !HEX32.test(data.decisionHash) ||
      !HEX32.test(data.calldataHash) ||
      !ADDRESS.test(data.account) ||
      data.chainId !== 8453 ||
      data.verdict !== expectedVerdict ||
      !Number.isSafeInteger(data.issuedAt) ||
      !Number.isSafeInteger(data.validUntil) ||
      data.schemaVersion !== 1 ||
      attestation.type !== "BaseLendingGuardDecision" ||
      attestation.schemaVersion !== 1 ||
      attestation.attesterLabel !== LABEL ||
      !HEX32.test(attestation.uid) ||
      !ADDRESS.test(attestation.attester) ||
      !SIGNATURE.test(attestation.signature) ||
      !validVerificationUrl(attestation.verifyUrl) ||
      attestation.validForSeconds !== VALID_FOR_SECONDS ||
      attestation.signedAt !== new Date(data.issuedAt * 1000).toISOString() ||
      data.validUntil - data.issuedAt !== VALID_FOR_SECONDS ||
      canonicalJson(attestation.eip712) !==
        canonicalJson({
          domain: DOMAIN,
          types: TYPES,
          primaryType: "BaseLendingGuardDecision",
        })
    )
      return { ...empty, reason: "MALFORMED" };

    const decisionHash = keccak256(
      toBytes(canonicalJson(unsignedDecision(decision))),
    );
    if (
      decisionHash.toLowerCase() !== decision.decisionHash.toLowerCase() ||
      decisionHash.toLowerCase() !== data.decisionHash.toLowerCase() ||
      data.calldataHash.toLowerCase() !== action.calldataHash.toLowerCase() ||
      data.account.toLowerCase() !== action.account.toLowerCase()
    )
      return {
        ...empty,
        reason: "DECISION_HASH_OR_CALL_BINDING_MISMATCH",
        decisionHash,
        attester: attestation.attester,
        issuedAt: data.issuedAt,
        validUntil: data.validUntil,
      };
    const typedData = {
      domain: DOMAIN,
      types: TYPES,
      primaryType: "BaseLendingGuardDecision" as const,
      message: {
        decisionHash: data.decisionHash,
        calldataHash: data.calldataHash,
        account: data.account as `0x${string}`,
        chainId: BigInt(data.chainId),
        verdict: data.verdict,
        issuedAt: BigInt(data.issuedAt),
        validUntil: BigInt(data.validUntil),
        schemaVersion: BigInt(data.schemaVersion),
      },
    };
    const uid = hashTypedData(typedData);
    if (uid.toLowerCase() !== attestation.uid.toLowerCase())
      return {
        ...empty,
        reason: "UID_MISMATCH",
        decisionHash,
        attester: attestation.attester,
        issuedAt: data.issuedAt,
        validUntil: data.validUntil,
      };
    const signatureValid = await verifyTypedData({
      ...typedData,
      address: attestation.attester as `0x${string}`,
      signature: attestation.signature,
    });
    if (!signatureValid)
      return {
        ...empty,
        reason: "SIGNATURE_INVALID",
        decisionHash,
        attester: attestation.attester,
        issuedAt: data.issuedAt,
        validUntil: data.validUntil,
      };
    const trusted = registryTrust(
      options.keyRegistry,
      attestation.attester,
      data.issuedAt,
    );
    if (!trusted)
      return {
        ...empty,
        signatureValid: true,
        reason: "SIGNER_UNTRUSTED",
        decisionHash,
        attester: attestation.attester,
        issuedAt: data.issuedAt,
        validUntil: data.validUntil,
      };
    const expired =
      data.validUntil <= (options.now ?? Math.floor(Date.now() / 1000));
    const valid = options.allowHistorical
      ? data.validUntil > data.issuedAt
      : !expired;
    return {
      valid,
      signatureValid: true,
      trusted: true,
      expired,
      reason: valid ? "OK" : "EXPIRED",
      decisionHash,
      attester: attestation.attester,
      issuedAt: data.issuedAt,
      validUntil: data.validUntil,
    };
  } catch {
    return { ...empty, reason: "VERIFICATION_ERROR" };
  }
}

function guardScope(
  intent: Intent,
  decision: InsightBaseLendingGuardDecision,
  now: number,
): void {
  const attestation = decision.attestation;
  if (
    !attestation ||
    intent.schema !== "priorseal.intent.v2" ||
    intent.executionProfile !== "priorseal.execution-profile.exact-call.v1" ||
    intent.action !== "CONTRACT_CALL" ||
    intent.asset !== baseLendingGuardIntentAsset(decision.guard.protocolId) ||
    intent.amount !== decision.action.amount ||
    Number(intent.chainId) !== 8453 ||
    intent.sender.toLowerCase() !== decision.transaction.from.toLowerCase() ||
    intent.callTarget?.toLowerCase() !==
      decision.transaction.to.toLowerCase() ||
    intent.recipient.toLowerCase() !== decision.transaction.to.toLowerCase() ||
    intent.calldataHash?.toLowerCase() !==
      decision.action.calldataHash.toLowerCase() ||
    intent.transactionValue !== "0" ||
    intent.nonce !== String(decision.transaction.nonce) ||
    !Number.isSafeInteger(intent.validUntil) ||
    intent.validUntil > attestation.data.validUntil ||
    now >= intent.validUntil
  )
    throw new Error("BASE_LENDING_GUARD_CALL_SCOPE_MISMATCH");
  if (
    !matchUniqueContextCommitment(intent, baseLendingGuardCommitment(decision))
      .matched
  )
    throw new Error("BASE_LENDING_GUARD_CONTEXT_COMMITMENT_MISMATCH");
}

/**
 * Build the sole supported PriorSeal exact-call intent for an Insight ALLOW
 * decision. The function verifies the independent Insight key registry before
 * it returns, reserves the namespace, and caps authorization lifetime.
 */
export async function buildBaseLendingGuardBoundIntent(
  input: ExactCallIntentInput,
  decisionValue: unknown,
  options: GuardVerificationOptions = {},
): Promise<Intent> {
  input = structuredClone(input);
  const decision = asDecision(structuredClone(decisionValue));
  if (!decision) throw new TypeError("BASE_LENDING_GUARD_MALFORMED");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const verification = await verifyInsightBaseLendingGuardDecision(decision, {
    ...options,
    now,
  });
  if (
    !verification.valid ||
    !decision.attestation ||
    decision.guard.verdict !== "ALLOW"
  )
    throw new TypeError(`BASE_LENDING_GUARD_BLOCKED:${verification.reason}`);
  if (
    input.contextCommitments?.some(
      (entry) =>
        entry.namespace.toLowerCase() === INSIGHT_BASE_LENDING_GUARD_NAMESPACE,
    )
  )
    throw new TypeError("BASE_LENDING_GUARD_RESERVED_NAMESPACE");
  if (
    input.asset !== baseLendingGuardIntentAsset(decision.guard.protocolId) ||
    String(input.amount) !== decision.action.amount ||
    canonicalJson(input.transaction) !== canonicalJson(decision.transaction)
  )
    throw new TypeError("BASE_LENDING_GUARD_INPUT_SCOPE_MISMATCH");
  const intent = buildExactCallIntent({
    ...input,
    validUntil: Math.min(
      input.validUntil,
      decision.attestation.data.validUntil,
    ),
    contextCommitments: [
      ...(input.contextCommitments ?? []),
      baseLendingGuardCommitment(decision),
    ],
  });
  guardScope(intent, decision, now);
  return intent;
}

/** Check an issued PriorSeal authorization against one signed Insight decision. */
export async function verifyBaseLendingGuardAuthorizationBinding(
  authorization: Authorization | unknown,
  decisionValue: unknown,
  options: GuardVerificationOptions = {},
): Promise<{ valid: boolean; reason: string }> {
  const decision = asDecision(decisionValue);
  if (
    !decision ||
    !isRecord(authorization) ||
    !isRecord(authorization.intent) ||
    !Number.isSafeInteger(authorization.issuedAt) ||
    !Number.isSafeInteger(authorization.expiresAt)
  )
    return { valid: false, reason: "MALFORMED" };
  const verification = await verifyInsightBaseLendingGuardDecision(decision, {
    ...options,
    now: Number(authorization.issuedAt),
    allowHistorical: true,
  });
  if (
    !verification.valid ||
    !decision.attestation ||
    decision.guard.verdict !== "ALLOW"
  )
    return { valid: false, reason: `INSIGHT_${verification.reason}` };
  try {
    guardScope(
      authorization.intent as Intent,
      decision,
      Number(authorization.issuedAt),
    );
    if (Number(authorization.expiresAt) > decision.attestation.data.validUntil)
      return {
        valid: false,
        reason: "AUTHORIZATION_OUTLIVES_INSIGHT_DECISION",
      };
    return { valid: true, reason: "OK" };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "BINDING_MISMATCH",
    };
  }
}

/** Verify a PriorSeal receipt plus its embedded authorization's unique Insight decision binding. */
export async function verifyBaseLendingGuardReceiptBundle(input: {
  receipt: Receipt | unknown;
  decision: unknown;
  priorSealTrust: LocalVerifierOptions;
  insightTrust: GuardVerificationOptions;
}): Promise<{ valid: boolean; reason: string }> {
  const receiptResult = await verifyReceiptLocally(
    input.receipt,
    input.priorSealTrust,
  );
  if (
    !receiptResult.valid ||
    !isRecord(input.receipt) ||
    !isRecord(input.receipt.authorizationEvidence)
  )
    return { valid: false, reason: `PRIORSEAL_${receiptResult.code}` };
  const authorization = input.receipt.authorizationEvidence.authorization;
  const binding = await verifyBaseLendingGuardAuthorizationBinding(
    authorization,
    input.decision,
    input.insightTrust,
  );
  if (!binding.valid) return { valid: false, reason: binding.reason };
  return { valid: true, reason: "OK" };
}
