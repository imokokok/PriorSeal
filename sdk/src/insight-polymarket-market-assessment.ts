import { hashTypedData, keccak256, toBytes, verifyTypedData } from "viem";
import type { KeyRegistry } from "verify-insight-receipt";
import type { ContextCommitment } from "./types.js";

export const INSIGHT_POLYMARKET_MARKET_ASSESSMENT_SCHEMA =
  "insight.polymarket-market-assessment.v1" as const;
export const INSIGHT_POLYMARKET_MARKET_ASSESSMENT_NAMESPACE =
  "insight.polymarket-market-assessment.v1" as const;
export const INSIGHT_POLYMARKET_MARKET_ASSESSMENT_ATTESTATION_SCHEMA =
  "insight.polymarket-market-assessment-attestation.v1" as const;
export const INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN = {
  name: "Insight Polymarket Market Assessment",
  version: "1",
  chainId: 1,
} as const;
export const INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES = {
  PolymarketMarketAssessment: [
    { name: "assessmentHash", type: "bytes32" },
    { name: "marketId", type: "string" },
    { name: "outcome", type: "string" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
  ],
} as const;
const MAX_VALIDITY_SECONDS = 60;
const HASH = /^0x[\da-f]{64}$/i;
const ADDRESS = /^0x[\da-f]{40}$/i;
const SIGNATURE = /^0x[\da-f]{130}$/i;

export type InsightPolymarketMarketAssessment = {
  schema: typeof INSIGHT_POLYMARKET_MARKET_ASSESSMENT_SCHEMA;
  verdict: "ALLOW" | "CAUTION" | "BLOCK";
  evaluatedAt: string;
  market: {
    id: string;
    rulesDigest?: string;
    conditionId?: string | null;
    protocolVersion?: "v1" | "v2" | null;
    slug?: string;
    question?: string;
    endDate?: string | null;
    active?: boolean | null;
    closed?: boolean | null;
    resolutionSource?: string | null;
    liquidity?: number | null;
    volume?: number | null;
  };
  outcome: { name: string; probability: number | null };
  quotes: {
    source?: "polymarket-clob";
    bestBid: number | null;
    bestBidSize: number | null;
    bestAsk: number | null;
    bestAskSize: number | null;
    spread: number | null;
    timestamp: string | null;
    hash: string | null;
  } | null;
  checks: Array<{
    id: string;
    status: "pass" | "caution" | "block";
    detail: string;
  }>;
  reasons: string[];
  scope: {
    transactionAuthority: "none";
    forecast: "not_provided";
    execution: "not_performed";
    suitability: "not_assessed";
  };
  disclosure: string;
};

export type InsightPolymarketMarketAssessmentVerification = {
  valid: boolean;
  reason: "OK" | "MALFORMED" | "SCOPE_MISMATCH" | "HASH_MISMATCH";
  digest: `0x${string}` | null;
};
export type InsightPolymarketMarketAssessmentAttestationVerification = {
  valid: boolean;
  signatureValid: boolean;
  trusted: boolean;
  expired: boolean;
  reason: string;
  assessmentHash: string | null;
  attester: string | null;
  issuedAt: number | null;
  validUntil: number | null;
};
export type InsightPolymarketMarketAssessmentVerificationOptions = {
  keyRegistry?: KeyRegistry;
  now?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 48) throw new TypeError("Assessment JSON exceeds maximum depth");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => canonical(entry, depth + 1)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (
      keys.some((key) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new TypeError("Assessment has unsafe property");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("Assessment is not canonical JSON");
}
function isAssessment(
  value: unknown,
): value is InsightPolymarketMarketAssessment {
  const root =
    isRecord(value) && value.success === true && isRecord(value.data)
      ? value.data
      : value;
  if (
    !isRecord(root) ||
    root.schema !== INSIGHT_POLYMARKET_MARKET_ASSESSMENT_SCHEMA ||
    !["ALLOW", "CAUTION", "BLOCK"].includes(String(root.verdict)) ||
    typeof root.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(root.evaluatedAt)) ||
    !isRecord(root.market) ||
    typeof root.market.id !== "string" ||
    !root.market.id ||
    (root.metadataSource !== undefined &&
      root.metadataSource !== "polymarket-gamma") ||
    (root.market.rulesDigest !== undefined &&
      (typeof root.market.rulesDigest !== "string" ||
        !/^0x[\da-f]{64}$/i.test(root.market.rulesDigest))) ||
    (root.market.conditionId !== undefined &&
      root.market.conditionId !== null &&
      (typeof root.market.conditionId !== "string" ||
        !/^0x[\da-f]{64}$/i.test(root.market.conditionId))) ||
    (root.market.protocolVersion !== undefined &&
      root.market.protocolVersion !== null &&
      !["v1", "v2"].includes(String(root.market.protocolVersion))) ||
    (root.market.slug !== undefined && typeof root.market.slug !== "string") ||
    (root.market.question !== undefined &&
      typeof root.market.question !== "string") ||
    (root.market.endDate !== undefined &&
      root.market.endDate !== null &&
      (typeof root.market.endDate !== "string" ||
        !Number.isFinite(Date.parse(root.market.endDate)))) ||
    (root.market.active !== undefined &&
      root.market.active !== null &&
      typeof root.market.active !== "boolean") ||
    (root.market.closed !== undefined &&
      root.market.closed !== null &&
      typeof root.market.closed !== "boolean") ||
    (root.market.resolutionSource !== undefined &&
      root.market.resolutionSource !== null &&
      typeof root.market.resolutionSource !== "string") ||
    (root.market.liquidity !== undefined &&
      root.market.liquidity !== null &&
      (typeof root.market.liquidity !== "number" ||
        !Number.isFinite(root.market.liquidity) ||
        root.market.liquidity < 0)) ||
    (root.market.volume !== undefined &&
      root.market.volume !== null &&
      (typeof root.market.volume !== "number" ||
        !Number.isFinite(root.market.volume) ||
        root.market.volume < 0)) ||
    !isRecord(root.outcome) ||
    typeof root.outcome.name !== "string" ||
    (root.outcome.probability !== null &&
      (typeof root.outcome.probability !== "number" ||
        !Number.isFinite(root.outcome.probability) ||
        root.outcome.probability < 0 ||
        root.outcome.probability > 1)) ||
    !Array.isArray(root.checks) ||
    root.checks.length > 100 ||
    !Array.isArray(root.reasons) ||
    root.reasons.length > 100 ||
    !isRecord(root.scope) ||
    root.scope.transactionAuthority !== "none" ||
    root.scope.forecast !== "not_provided" ||
    root.scope.execution !== "not_performed" ||
    root.scope.suitability !== "not_assessed" ||
    typeof root.disclosure !== "string"
  )
    return false;
  const quote = root.quotes;
  if (
    quote !== null &&
    (!isRecord(quote) ||
      (quote.source !== undefined && quote.source !== "polymarket-clob") ||
      (quote.bestAsk !== null &&
        (typeof quote.bestAsk !== "number" ||
          quote.bestAsk < 0 ||
          quote.bestAsk > 1)) ||
      (quote.bestBid !== null &&
        (typeof quote.bestBid !== "number" ||
          quote.bestBid < 0 ||
          quote.bestBid > 1)) ||
      (quote.bestBidSize !== null &&
        (typeof quote.bestBidSize !== "number" ||
          !Number.isFinite(quote.bestBidSize) ||
          quote.bestBidSize <= 0)) ||
      (quote.bestAskSize !== null &&
        (typeof quote.bestAskSize !== "number" ||
          !Number.isFinite(quote.bestAskSize) ||
          quote.bestAskSize <= 0)) ||
      (quote.spread !== null &&
        (typeof quote.spread !== "number" ||
          !Number.isFinite(quote.spread) ||
          quote.spread < -1 ||
          quote.spread > 1)) ||
      (quote.timestamp !== null &&
        (typeof quote.timestamp !== "string" ||
          !Number.isFinite(Date.parse(quote.timestamp)))) ||
      (quote.hash !== null &&
        (typeof quote.hash !== "string" ||
          !/^0x[\da-f]{64}$/i.test(quote.hash))))
  )
    return false;
  return (
    root.checks.every(
      (check) =>
        isRecord(check) &&
        typeof check.id === "string" &&
        check.id.length <= 100 &&
        ["pass", "caution", "block"].includes(String(check.status)) &&
        typeof check.detail === "string" &&
        check.detail.length <= 2000,
    ) &&
    root.reasons.every(
      (reason) => typeof reason === "string" && reason.length <= 500,
    )
  );
}

function isTrustedKey(
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
  const keys = registry.public_keys ?? registry.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100)
    return false;
  const matches = keys.filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry.public_key === "string" &&
      entry.public_key.toLowerCase() === address.toLowerCase(),
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
  if (
    issuedAt < Date.parse(key.validFrom) / 1000 ||
    (key.validUntil !== null && issuedAt >= Date.parse(key.validUntil) / 1000)
  )
    return false;
  const revoked = registry.revoked_keys ?? registry.revoked ?? [];
  return (
    Array.isArray(revoked) &&
    !revoked.some((entry) => isRecord(entry) && entry.key_id === key.key_id)
  );
}

/** Create a PriorSeal context commitment for the exact assessment bytes. This binds context; it does not attest to the source or independently prove its truth. */
export function insightPolymarketMarketAssessmentCommitment(
  value: unknown,
): ContextCommitment {
  if (!isAssessment(value))
    throw new TypeError("Invalid Insight Polymarket market assessment");
  const possibleEnvelope = value as unknown as Record<string, unknown>;
  const root =
    possibleEnvelope.success === true && isRecord(possibleEnvelope.data)
      ? possibleEnvelope.data
      : value;
  return {
    namespace: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_NAMESPACE,
    algorithm: "keccak256",
    digest: keccak256(toBytes(canonical(root))),
  };
}

/** Recompute the commitment and optionally compare it with a previously bound digest. */
export function verifyInsightPolymarketMarketAssessment(
  value: unknown,
  expectedDigest?: string,
): InsightPolymarketMarketAssessmentVerification {
  if (!isAssessment(value))
    return { valid: false, reason: "MALFORMED", digest: null };
  try {
    const commitment = insightPolymarketMarketAssessmentCommitment(value);
    if (
      expectedDigest !== undefined &&
      (!/^0x[\da-f]{64}$/i.test(expectedDigest) ||
        commitment.digest.toLowerCase() !== expectedDigest.toLowerCase())
    )
      return {
        valid: false,
        reason: "HASH_MISMATCH",
        digest: commitment.digest as `0x${string}`,
      };
    return {
      valid: true,
      reason: "OK",
      digest: commitment.digest as `0x${string}`,
    };
  } catch {
    return { valid: false, reason: "SCOPE_MISMATCH", digest: null };
  }
}

/** Verify the EIP-712 attestation and the current trusted-key epoch for the assessment route response. */
export async function verifyInsightPolymarketMarketAssessmentAttestation(
  value: unknown,
  options: InsightPolymarketMarketAssessmentVerificationOptions = {},
): Promise<InsightPolymarketMarketAssessmentAttestationVerification> {
  const empty = {
    valid: false,
    signatureValid: false,
    trusted: false,
    expired: false,
    reason: "MALFORMED",
    assessmentHash: null,
    attester: null,
    issuedAt: null,
    validUntil: null,
  } as const;
  try {
    const envelope =
      isRecord(value) && value.success === true && isRecord(value.data)
        ? value.data
        : value;
    if (
      !isRecord(envelope) ||
      !isRecord(envelope.assessment) ||
      !isRecord(envelope.attestation) ||
      !isAssessment(envelope.assessment)
    )
      return empty;
    const { assessment } = envelope;
    const decisionEnvelope = envelope.attestation;
    const attestation = isRecord(decisionEnvelope.attestation)
      ? decisionEnvelope.attestation
      : decisionEnvelope;
    const data = isRecord(attestation.data) ? attestation.data : null;
    if (!data) return empty;
    const verdict =
      assessment.verdict === "ALLOW"
        ? 0
        : assessment.verdict === "CAUTION"
          ? 1
          : 2;
    if (
      decisionEnvelope.schema !==
        INSIGHT_POLYMARKET_MARKET_ASSESSMENT_ATTESTATION_SCHEMA ||
      !HASH.test(String(decisionEnvelope.decisionHash)) ||
      attestation.type !== "PolymarketMarketAssessment" ||
      attestation.schemaVersion !== 1 ||
      !HASH.test(String(attestation.uid)) ||
      !ADDRESS.test(String(attestation.attester)) ||
      !SIGNATURE.test(String(attestation.signature)) ||
      attestation.validForSeconds !== MAX_VALIDITY_SECONDS ||
      !HASH.test(String(data?.assessmentHash)) ||
      data.marketId !== assessment.market.id ||
      data.outcome !== assessment.outcome.name ||
      data.verdict !== verdict ||
      data.schemaVersion !== 1 ||
      !Number.isSafeInteger(data.issuedAt) ||
      (data.issuedAt as number) < 0 ||
      !Number.isSafeInteger(data.validUntil) ||
      (data.validUntil as number) - (data.issuedAt as number) <= 0 ||
      (data.validUntil as number) - (data.issuedAt as number) >
        MAX_VALIDITY_SECONDS ||
      attestation.signedAt !==
        new Date((data.issuedAt as number) * 1000).toISOString() ||
      canonical(attestation.eip712) !==
        canonical({
          domain: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN,
          types: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES,
          primaryType: "PolymarketMarketAssessment",
        })
    )
      return empty;
    const assessmentHash = keccak256(toBytes(canonical(assessment)));
    if (
      assessmentHash.toLowerCase() !==
        String(decisionEnvelope.decisionHash).toLowerCase() ||
      assessmentHash.toLowerCase() !== String(data.assessmentHash).toLowerCase()
    )
      return { ...empty, reason: "ASSESSMENT_HASH_MISMATCH" };
    const issuedAt = data.issuedAt as number;
    const validUntil = data.validUntil as number;
    const assessedAt = Math.floor(Date.parse(assessment.evaluatedAt) / 1000);
    if (
      issuedAt < assessedAt ||
      validUntil > assessedAt + MAX_VALIDITY_SECONDS + 2
    )
      return { ...empty, reason: "ASSESSMENT_STALE" };
    const typedData = {
      domain: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN,
      types: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES,
      primaryType: "PolymarketMarketAssessment" as const,
      message: {
        assessmentHash: data.assessmentHash as `0x${string}`,
        marketId: data.marketId as string,
        outcome: data.outcome as string,
        verdict: data.verdict as number,
        issuedAt: BigInt(issuedAt),
        validUntil: BigInt(validUntil),
        schemaVersion: 1n,
      },
    };
    if (
      hashTypedData(typedData).toLowerCase() !==
      String(attestation.uid).toLowerCase()
    )
      return { ...empty, reason: "UID_MISMATCH" };
    const signatureValid = await verifyTypedData({
      ...typedData,
      address: attestation.attester as `0x${string}`,
      signature: attestation.signature as `0x${string}`,
    });
    if (!signatureValid) return { ...empty, reason: "SIGNATURE_INVALID" };
    if (
      !isTrustedKey(
        options.keyRegistry,
        attestation.attester as string,
        issuedAt,
      )
    )
      return {
        ...empty,
        signatureValid: true,
        reason: "SIGNER_UNTRUSTED",
        assessmentHash,
        attester: attestation.attester as string,
        issuedAt,
        validUntil,
      };
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const expired = validUntil <= now;
    const issuedInFuture = issuedAt > now + 5;
    const valid = !expired && !issuedInFuture;
    return {
      valid,
      signatureValid: true,
      trusted: true,
      expired,
      reason: valid ? "OK" : expired ? "EXPIRED" : "ISSUED_IN_FUTURE",
      assessmentHash,
      attester: attestation.attester as string,
      issuedAt,
      validUntil,
    };
  } catch {
    return { ...empty, reason: "VERIFICATION_ERROR" };
  }
}
