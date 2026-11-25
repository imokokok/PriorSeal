import { hashTypedData, keccak256, toBytes, verifyTypedData } from "viem";
import type { KeyRegistry } from "verify-insight-receipt";

import { verifyInsightPolymarketBlsEvidence } from "./insight-polymarket-bls-evidence.js";
import { verifyInsightPolymarketBlsPercentChangeEvidence } from "./insight-polymarket-bls-percent-change-evidence.js";
import type { ContextCommitment } from "./types.js";

export const INSIGHT_POLYMARKET_SOURCE_EVIDENCE_SCHEMA =
  "insight.polymarket-source-evidence.v1" as const;
export const INSIGHT_POLYMARKET_SOURCE_EVIDENCE_NAMESPACE =
  INSIGHT_POLYMARKET_SOURCE_EVIDENCE_SCHEMA;
export const INSIGHT_POLYMARKET_SOURCE_EVIDENCE_ATTESTATION_SCHEMA =
  "insight.polymarket-source-evidence-attestation.v1" as const;
export const INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN = {
  name: "Insight Polymarket Source Evidence",
  version: "1",
  chainId: 1,
} as const;
export const INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES = {
  PolymarketSourceEvidence: [
    { name: "evidenceHash", type: "bytes32" },
    { name: "marketId", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
  ],
} as const;
const MAX_VALIDITY_SECONDS = 300;
const ADDRESS = /^0x[\da-f]{40}$/i;
const SIGNATURE = /^0x[\da-f]{130}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const ROOT_KEYS = [
  "binding",
  "checks",
  "collectedAt",
  "disclosure",
  "market",
  "observations",
  "requiresHumanReview",
  "reviewWarnings",
  "schema",
  "scope",
].sort();
type Evidence = {
  schema: typeof INSIGHT_POLYMARKET_SOURCE_EVIDENCE_SCHEMA;
  collectedAt: string;
  market: {
    id: string;
    slug: string;
    question: string;
    rulesDigest: string;
    resolutionSource: string;
    endDate: string | null;
    outcomeNames: string[];
  };
  binding: {
    source: "server-reviewed-source-binding";
    reviewedAt: string;
    reviewer: string;
  };
  checks: {
    marketActive: true;
    marketOpen: true;
    rulesDigestStable: true;
    resolutionSourceDeclared: true;
    sourceEvidenceRetrieved: true;
  };
  observations: Array<{
    id: string;
    provider: "bls.series" | "bls.percent-change" | "nws.latest-observation";
    evidence: Record<string, unknown>;
  }>;
  reviewWarnings: string[];
  requiresHumanReview: boolean;
  scope: {
    outcomeEvaluation: "not_performed";
    settlement: "not_performed";
    transactionAuthority: "none";
    execution: "not_performed";
  };
  disclosure: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}
const FORBIDDEN_DECISION_KEYS = new Set([
  "candidateOutcome",
  "comparison",
  "evaluation",
  "falseOutcomeName",
  "operator",
  "predicateSatisfied",
  "recommendation",
  "selectedOutcome",
  "threshold",
  "trueOutcomeName",
  "verdict",
]);
function hasOutcomeDerivation(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (Array.isArray(value))
    return value.some((entry) => hasOutcomeDerivation(entry, depth + 1));
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      FORBIDDEN_DECISION_KEYS.has(key) ||
      hasOutcomeDerivation(entry, depth + 1),
  );
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 32)
    throw new TypeError("Polymarket evidence exceeds maximum depth");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  if (record(value)) {
    const keys = Object.keys(value).sort();
    if (
      keys.some((key) =>
        ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new TypeError("Polymarket evidence has unsafe property");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("Polymarket evidence is not canonical JSON");
}
function makeWarnings(observations: Evidence["observations"]): string[] | null {
  const warnings: string[] = [];
  for (const item of observations) {
    if (item.provider === "bls.series") {
      if (
        !verifyInsightPolymarketBlsEvidence(item.evidence).valid ||
        !record(item.evidence.observation)
      )
        return null;
      const footnoteSets = [item.evidence.observation.footnotes];
      for (const footnotes of footnoteSets) {
        if (!Array.isArray(footnotes) || footnotes.length > 20) return null;
        for (const footnote of footnotes) {
          if (
            !record(footnote) ||
            typeof footnote.code !== "string" ||
            typeof footnote.text !== "string"
          )
            return null;
          if (footnote.code || footnote.text)
            warnings.push(
              `${footnote.code}${footnote.code && footnote.text ? ": " : ""}${footnote.text}`,
            );
        }
      }
    } else if (item.provider === "bls.percent-change") {
      if (
        !verifyInsightPolymarketBlsPercentChangeEvidence(item.evidence).valid ||
        !record(item.evidence.observation) ||
        !record(item.evidence.baseObservation)
      )
        return null;
      for (const row of [
        item.evidence.observation,
        item.evidence.baseObservation,
      ]) {
        const footnotes = row.footnotes;
        if (!Array.isArray(footnotes) || footnotes.length > 20) return null;
        for (const footnote of footnotes) {
          if (
            !record(footnote) ||
            typeof footnote.code !== "string" ||
            typeof footnote.text !== "string"
          )
            return null;
          if (footnote.code || footnote.text)
            warnings.push(
              `${footnote.code}${footnote.code && footnote.text ? ": " : ""}${footnote.text}`,
            );
        }
      }
    } else {
      const result = verifyInsightPolymarketNwsObservationEvidence(
        item.evidence,
      );
      if (!result.valid) return null;
      const measurement = item.evidence.measurement as Record<string, unknown>;
      const qualityControl = measurement.qualityControl as string[];
      if (qualityControl.length > 0) {
        warnings.push(
          `NWS quality-control flags are present for ${String(item.evidence.property)}; review their source meaning.`,
        );
      }
    }
  }
  return [...new Set(warnings)];
}
function parse(value: unknown): Evidence | null {
  const envelope =
    record(value) && value.success === true && record(value.data)
      ? value.data
      : value;
  const root =
    record(envelope) && record(envelope.evidence)
      ? envelope.evidence
      : envelope;
  if (
    !record(root) ||
    hasOutcomeDerivation(root) ||
    !exactKeys(root, ROOT_KEYS) ||
    root.schema !== INSIGHT_POLYMARKET_SOURCE_EVIDENCE_SCHEMA ||
    typeof root.collectedAt !== "string" ||
    !Number.isFinite(Date.parse(root.collectedAt)) ||
    !record(root.market) ||
    !exactKeys(root.market, [
      "id",
      "slug",
      "question",
      "rulesDigest",
      "resolutionSource",
      "endDate",
      "outcomeNames",
    ]) ||
    typeof root.market.id !== "string" ||
    !root.market.id ||
    root.market.id.length > 100 ||
    typeof root.market.slug !== "string" ||
    root.market.slug.length > 200 ||
    typeof root.market.question !== "string" ||
    !root.market.question ||
    root.market.question.length > 2000 ||
    typeof root.market.rulesDigest !== "string" ||
    !HASH.test(root.market.rulesDigest) ||
    typeof root.market.resolutionSource !== "string" ||
    !root.market.resolutionSource ||
    !isHttps(root.market.resolutionSource) ||
    !Array.isArray(root.market.outcomeNames) ||
    root.market.outcomeNames.length < 2 ||
    root.market.outcomeNames.length > 100 ||
    !root.market.outcomeNames.every(
      (name) => typeof name === "string" && !!name && name.length <= 100,
    ) ||
    (root.market.endDate !== null &&
      (typeof root.market.endDate !== "string" ||
        !Number.isFinite(Date.parse(root.market.endDate)))) ||
    !record(root.binding) ||
    !exactKeys(root.binding, ["source", "reviewedAt", "reviewer"]) ||
    root.binding.source !== "server-reviewed-source-binding" ||
    typeof root.binding.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(root.binding.reviewedAt)) ||
    typeof root.binding.reviewer !== "string" ||
    !root.binding.reviewer ||
    root.binding.reviewer.length > 100 ||
    !record(root.checks) ||
    !exactKeys(root.checks, [
      "marketActive",
      "marketOpen",
      "rulesDigestStable",
      "resolutionSourceDeclared",
      "sourceEvidenceRetrieved",
    ]) ||
    root.checks.marketActive !== true ||
    root.checks.marketOpen !== true ||
    root.checks.rulesDigestStable !== true ||
    root.checks.resolutionSourceDeclared !== true ||
    root.checks.sourceEvidenceRetrieved !== true ||
    !Array.isArray(root.observations) ||
    root.observations.length < 1 ||
    root.observations.length > 10 ||
    !Array.isArray(root.reviewWarnings) ||
    root.reviewWarnings.length > 20 ||
    !root.reviewWarnings.every(
      (item) => typeof item === "string" && item.length <= 600,
    ) ||
    typeof root.requiresHumanReview !== "boolean" ||
    !record(root.scope) ||
    !exactKeys(root.scope, [
      "outcomeEvaluation",
      "settlement",
      "transactionAuthority",
      "execution",
    ]) ||
    root.scope.outcomeEvaluation !== "not_performed" ||
    root.scope.settlement !== "not_performed" ||
    root.scope.transactionAuthority !== "none" ||
    root.scope.execution !== "not_performed" ||
    typeof root.disclosure !== "string" ||
    root.disclosure.length > 2000 ||
    !root.disclosure.includes(
      "does not compare an observation to a market threshold",
    ) ||
    !root.disclosure.includes("does not evaluate an event outcome")
  )
    return null;

  const seen = new Set<string>();
  const observations: Evidence["observations"] = [];
  for (const item of root.observations) {
    if (
      !record(item) ||
      !exactKeys(item, ["id", "provider", "evidence"]) ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 64 ||
      seen.has(item.id) ||
      (item.provider !== "bls.series" &&
        item.provider !== "bls.percent-change" &&
        item.provider !== "nws.latest-observation") ||
      !record(item.evidence)
    )
      return null;
    seen.add(item.id);
    observations.push(item as unknown as Evidence["observations"][number]);
  }
  const warnings = makeWarnings(observations);
  if (
    !warnings ||
    root.requiresHumanReview !== warnings.length > 0 ||
    canonical(root.reviewWarnings) !== canonical(warnings)
  )
    return null;
  return root as unknown as Evidence;
}

const NWS_PROPERTIES = new Set([
  "temperature",
  "dewpoint",
  "windSpeed",
  "windDirection",
  "windGust",
  "barometricPressure",
  "seaLevelPressure",
  "visibility",
  "maxTemperatureLast24Hours",
  "minTemperatureLast24Hours",
  "precipitationLastHour",
  "precipitationLast3Hours",
  "precipitationLast6Hours",
]);

/** Validate one raw NWS measurement without deriving a market outcome. */
export function verifyInsightPolymarketNwsObservationEvidence(value: unknown) {
  const invalid = { valid: false as const, reason: "MALFORMED" as const };
  if (
    !record(value) ||
    !exactKeys(value, [
      "schema",
      "source",
      "sourceUrl",
      "observationUrl",
      "stationId",
      "observedAt",
      "description",
      "property",
      "measurement",
      "retrievedAt",
      "disclosure",
    ]) ||
    value.schema !== "insight.polymarket-nws-observation.v1" ||
    value.source !== "us-national-weather-service-api" ||
    typeof value.stationId !== "string" ||
    !/^[A-Z0-9-]{3,10}$/.test(value.stationId) ||
    typeof value.property !== "string" ||
    !NWS_PROPERTIES.has(value.property) ||
    typeof value.sourceUrl !== "string" ||
    typeof value.observationUrl !== "string" ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    typeof value.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(value.retrievedAt)) ||
    (value.description !== null &&
      (typeof value.description !== "string" ||
        value.description.length > 160)) ||
    !record(value.measurement) ||
    !exactKeys(value.measurement, ["value", "unitCode", "qualityControl"]) ||
    typeof value.measurement.value !== "number" ||
    !Number.isFinite(value.measurement.value) ||
    typeof value.measurement.unitCode !== "string" ||
    value.measurement.unitCode.length < 1 ||
    value.measurement.unitCode.length > 80 ||
    !Array.isArray(value.measurement.qualityControl) ||
    value.measurement.qualityControl.length > 20 ||
    !value.measurement.qualityControl.every(
      (flag) => typeof flag === "string" && flag.length <= 40,
    ) ||
    typeof value.disclosure !== "string" ||
    value.disclosure.length > 2000 ||
    !value.disclosure.includes("does not compare values to thresholds") ||
    !value.disclosure.includes("does not determine event outcomes")
  )
    return invalid;
  const stationPath = `/stations/${value.stationId}`;
  try {
    const source = new URL(value.sourceUrl);
    const observation = new URL(value.observationUrl);
    if (
      source.protocol !== "https:" ||
      source.hostname !== "api.weather.gov" ||
      source.username ||
      source.password ||
      source.search ||
      source.hash ||
      source.pathname !== `${stationPath}/observations/latest` ||
      observation.protocol !== "https:" ||
      observation.hostname !== "api.weather.gov" ||
      observation.username ||
      observation.password ||
      observation.search ||
      observation.hash ||
      (observation.pathname !== stationPath &&
        !observation.pathname.startsWith(`${stationPath}/observations/`))
    )
      return invalid;
  } catch {
    return invalid;
  }
  return { valid: true as const, reason: "OK" as const };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
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
    !record(registry) ||
    (registry.public_keys && registry.keys) ||
    (registry.revoked_keys && registry.revoked)
  )
    return false;
  const keys = registry.public_keys ?? registry.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100)
    return false;
  const matches = keys.filter(
    (entry) =>
      record(entry) &&
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
    !revoked.some((entry) => record(entry) && entry.key_id === key.key_id)
  );
}

export type InsightPolymarketSourceEvidenceAttestationOptions = {
  keyRegistry?: KeyRegistry;
  now?: number;
};
export type InsightPolymarketSourceEvidenceAttestationVerification = {
  valid: boolean;
  signatureValid: boolean;
  trusted: boolean;
  expired: boolean;
  reason: string;
  evidenceHash: string | null;
  attester: string | null;
  issuedAt: number | null;
  validUntil: number | null;
};

/** Verify the Insight EIP-712 signature, key epoch and exact source record returned by the API. */
export async function verifyInsightPolymarketSourceEvidenceAttestation(
  value: unknown,
  options: InsightPolymarketSourceEvidenceAttestationOptions = {},
): Promise<InsightPolymarketSourceEvidenceAttestationVerification> {
  const empty = {
    valid: false,
    signatureValid: false,
    trusted: false,
    expired: false,
    reason: "MALFORMED",
    evidenceHash: null,
    attester: null,
    issuedAt: null,
    validUntil: null,
  } as const;
  try {
    const envelope =
      record(value) && value.success === true && record(value.data)
        ? value.data
        : value;
    if (
      !record(envelope) ||
      !record(envelope.evidence) ||
      !record(envelope.attestation)
    )
      return empty;
    const evidence = parse(envelope.evidence);
    if (!evidence) return empty;
    const decision = envelope.attestation;
    const attestation = record(decision.attestation)
      ? decision.attestation
      : null;
    const data =
      attestation && record(attestation.data) ? attestation.data : null;
    if (
      !attestation ||
      !data ||
      decision.schema !==
        INSIGHT_POLYMARKET_SOURCE_EVIDENCE_ATTESTATION_SCHEMA ||
      !HASH.test(String(decision.decisionHash)) ||
      attestation.type !== "PolymarketSourceEvidence" ||
      attestation.schemaVersion !== 1 ||
      !HASH.test(String(attestation.uid)) ||
      !ADDRESS.test(String(attestation.attester)) ||
      !SIGNATURE.test(String(attestation.signature)) ||
      attestation.validForSeconds !== MAX_VALIDITY_SECONDS ||
      !HASH.test(String(data.evidenceHash)) ||
      data.marketId !== evidence.market.id ||
      data.schemaVersion !== 1 ||
      !Number.isSafeInteger(data.issuedAt) ||
      (data.issuedAt as number) < 0 ||
      !Number.isSafeInteger(data.validUntil) ||
      (data.validUntil as number) <= (data.issuedAt as number) ||
      (data.validUntil as number) - (data.issuedAt as number) >
        MAX_VALIDITY_SECONDS ||
      attestation.signedAt !==
        new Date((data.issuedAt as number) * 1000).toISOString() ||
      canonical(attestation.eip712) !==
        canonical({
          domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
          types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
          primaryType: "PolymarketSourceEvidence",
        })
    )
      return empty;

    const evidenceHash = keccak256(toBytes(canonical(envelope.evidence)));
    if (
      evidenceHash.toLowerCase() !==
        String(decision.decisionHash).toLowerCase() ||
      evidenceHash.toLowerCase() !== String(data.evidenceHash).toLowerCase()
    )
      return { ...empty, reason: "EVIDENCE_HASH_MISMATCH" };
    const issuedAt = data.issuedAt as number;
    const validUntil = data.validUntil as number;
    const collectedAt = Math.floor(Date.parse(evidence.collectedAt) / 1000);
    if (issuedAt < collectedAt || validUntil > issuedAt + MAX_VALIDITY_SECONDS)
      return { ...empty, reason: "EVIDENCE_STALE" };
    const typedData = {
      domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
      types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
      primaryType: "PolymarketSourceEvidence" as const,
      message: {
        evidenceHash: String(data.evidenceHash) as `0x${string}`,
        marketId: String(data.marketId),
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
      address: String(attestation.attester) as `0x${string}`,
      signature: String(attestation.signature) as `0x${string}`,
    });
    if (!signatureValid) return { ...empty, reason: "SIGNATURE_INVALID" };
    if (
      !registryTrust(
        options.keyRegistry,
        String(attestation.attester),
        issuedAt,
      )
    )
      return {
        ...empty,
        signatureValid: true,
        reason: "SIGNER_UNTRUSTED",
        evidenceHash,
        attester: String(attestation.attester),
        issuedAt,
        validUntil,
      };
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const expired = validUntil <= now;
    const issuedInFuture = issuedAt > now + 5;
    return {
      valid: !expired && !issuedInFuture,
      signatureValid: true,
      trusted: true,
      expired,
      reason: expired ? "EXPIRED" : issuedInFuture ? "ISSUED_IN_FUTURE" : "OK",
      evidenceHash,
      attester: String(attestation.attester),
      issuedAt,
      validUntil,
    };
  } catch {
    return { ...empty, reason: "VERIFICATION_ERROR" };
  }
}

/** Commit to reviewed market metadata and source records only; no event result is calculated. */
export function insightPolymarketSourceEvidenceCommitment(
  value: unknown,
): ContextCommitment {
  const evidence = parse(value);
  if (!evidence)
    throw new TypeError("Invalid Insight Polymarket source evidence");
  return {
    namespace: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_NAMESPACE,
    algorithm: "keccak256",
    digest: keccak256(toBytes(canonical(evidence))),
  };
}
export function verifyInsightPolymarketSourceEvidence(
  value: unknown,
  expectedDigest?: string,
) {
  const evidence = parse(value);
  if (!evidence)
    return { valid: false, reason: "MALFORMED" as const, digest: null };
  try {
    const digest = insightPolymarketSourceEvidenceCommitment(evidence)
      .digest as `0x${string}`;
    if (
      expectedDigest !== undefined &&
      (!HASH.test(expectedDigest) ||
        digest.toLowerCase() !== expectedDigest.toLowerCase())
    )
      return { valid: false, reason: "HASH_MISMATCH" as const, digest };
    return { valid: true, reason: "OK" as const, digest };
  } catch {
    return { valid: false, reason: "MALFORMED" as const, digest: null };
  }
}
