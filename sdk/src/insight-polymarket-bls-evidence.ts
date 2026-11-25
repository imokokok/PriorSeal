import { keccak256, toBytes } from "viem";

import type { ContextCommitment } from "./types.js";

export const INSIGHT_POLYMARKET_BLS_EVIDENCE_SCHEMA =
  "insight.polymarket-bls-series-evidence.v1" as const;
export const INSIGHT_POLYMARKET_BLS_EVIDENCE_NAMESPACE =
  "insight.polymarket-bls-series-evidence.v1" as const;
const SERIES_ID = /^[A-Z0-9_#-]{1,32}$/;
const PERIOD = /^(M(0[1-9]|1[0-3])|Q0[1-4]|A01)$/;
const BLS_REQUIRED_NOTICE =
  "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.";

export type InsightPolymarketBlsSeriesEvidence = {
  schema: typeof INSIGHT_POLYMARKET_BLS_EVIDENCE_SCHEMA;
  source: "us-bls-public-data-api-v1" | "us-bls-public-data-api-v2";
  apiVersion: 1 | 2;
  sourceUrl: string;
  seriesId: string;
  observation: {
    year: string;
    period: string;
    periodName: string;
    value: string;
    numericValue: number;
    footnotes: Array<{ code: string; text: string }>;
  };
  retrievedAt: string;
  disclosure: string;
};

export type InsightPolymarketBlsEvidenceVerification = {
  valid: boolean;
  reason: "OK" | "MALFORMED" | "HASH_MISMATCH";
  digest: `0x${string}` | null;
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

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new TypeError("BLS evidence exceeds maximum depth");
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
      throw new TypeError("BLS evidence has unsafe property");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("BLS evidence is not canonical JSON");
}

function parseEvidence(
  value: unknown,
): InsightPolymarketBlsSeriesEvidence | null {
  const root =
    isRecord(value) && value.success === true && isRecord(value.data)
      ? value.data
      : value;
  if (
    !isRecord(root) ||
    root.schema !== INSIGHT_POLYMARKET_BLS_EVIDENCE_SCHEMA ||
    typeof root.seriesId !== "string" ||
    !SERIES_ID.test(root.seriesId) ||
    (root.apiVersion !== 1 && root.apiVersion !== 2) ||
    root.source !== `us-bls-public-data-api-v${root.apiVersion}` ||
    root.sourceUrl !==
      `https://api.bls.gov/publicAPI/v${root.apiVersion}/timeseries/data/${encodeURIComponent(root.seriesId)}` ||
    typeof root.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(root.retrievedAt)) ||
    typeof root.disclosure !== "string" ||
    root.disclosure.length > 1000 ||
    !root.disclosure.includes(BLS_REQUIRED_NOTICE) ||
    !isRecord(root.observation)
  )
    return null;
  const observation = root.observation;
  if (
    typeof observation.year !== "string" ||
    !/^(19|20|21)\d{2}$/.test(observation.year) ||
    typeof observation.period !== "string" ||
    !PERIOD.test(observation.period) ||
    typeof observation.periodName !== "string" ||
    observation.periodName.length > 100 ||
    typeof observation.value !== "string" ||
    !/^-?\d+(?:\.\d+)?$/.test(observation.value) ||
    typeof observation.numericValue !== "number" ||
    !Number.isFinite(observation.numericValue) ||
    Number(observation.value) !== observation.numericValue ||
    !Array.isArray(observation.footnotes) ||
    observation.footnotes.length > 20
  )
    return null;
  if (
    !observation.footnotes.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.code === "string" &&
        entry.code.length <= 20 &&
        typeof entry.text === "string" &&
        entry.text.length <= 500,
    )
  )
    return null;
  return root as unknown as InsightPolymarketBlsSeriesEvidence;
}

/** Bind the exact retrieved BLS evidence bytes to a PriorSeal intent. This does not authenticate BLS itself. */
export function insightPolymarketBlsEvidenceCommitment(
  value: unknown,
): ContextCommitment {
  const evidence = parseEvidence(value);
  if (!evidence) throw new TypeError("Invalid Insight Polymarket BLS evidence");
  return {
    namespace: INSIGHT_POLYMARKET_BLS_EVIDENCE_NAMESPACE,
    algorithm: "keccak256",
    digest: keccak256(toBytes(canonical(evidence))),
  };
}

/** Recompute the evidence commitment and optionally compare it to a stored digest. */
export function verifyInsightPolymarketBlsEvidence(
  value: unknown,
  expectedDigest?: string,
): InsightPolymarketBlsEvidenceVerification {
  const evidence = parseEvidence(value);
  if (!evidence) return { valid: false, reason: "MALFORMED", digest: null };
  try {
    const digest = insightPolymarketBlsEvidenceCommitment(evidence)
      .digest as `0x${string}`;
    if (
      expectedDigest !== undefined &&
      (!/^0x[\da-f]{64}$/i.test(expectedDigest) ||
        digest.toLowerCase() !== expectedDigest.toLowerCase())
    ) {
      return { valid: false, reason: "HASH_MISMATCH", digest };
    }
    return { valid: true, reason: "OK", digest };
  } catch {
    return { valid: false, reason: "MALFORMED", digest: null };
  }
}
