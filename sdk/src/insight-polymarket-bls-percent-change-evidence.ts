import { keccak256, toBytes } from "viem";

import type { ContextCommitment } from "./types.js";

export const INSIGHT_POLYMARKET_BLS_PERCENT_CHANGE_SCHEMA =
  "insight.polymarket-bls-percent-change-evidence.v1" as const;
export const INSIGHT_POLYMARKET_BLS_PERCENT_CHANGE_NAMESPACE =
  INSIGHT_POLYMARKET_BLS_PERCENT_CHANGE_SCHEMA;
const NOTICE =
  "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.";
const PERIOD = /^M(0[1-9]|1[0-2])$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    keys.length === wanted.length &&
    keys.every((key, index) => key === wanted[index])
  );
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 32)
    throw new TypeError("BLS percent-change evidence exceeds maximum depth");
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
      throw new TypeError("BLS percent-change evidence has unsafe property");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new TypeError("BLS percent-change evidence is not canonical JSON");
}
function independentlyCalculate(current: string, base: string): string | null {
  if (!DECIMAL.test(current) || !DECIMAL.test(base)) return null;
  const parse = (value: string) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(
      ".",
    );
    return {
      coefficient: BigInt(`${negative ? "-" : ""}${whole}${fraction}`),
      scale: fraction.length,
    };
  };
  const a = parse(current);
  const b = parse(base);
  if (b.coefficient === 0n) return null;
  const scale = Math.max(a.scale, b.scale);
  const delta =
    a.coefficient * 10n ** BigInt(scale - a.scale) -
    b.coefficient * 10n ** BigInt(scale - b.scale);
  const numerator = delta * 1000n;
  const denominator = b.coefficient * 10n ** BigInt(scale - b.scale);
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  const signed = negative ? -rounded : rounded;
  return `${signed / 10n}.${signed < 0n ? -(signed % 10n) : signed % 10n}`;
}
function parseEvidence(value: unknown): Record<string, unknown> | null {
  const root =
    isRecord(value) && value.success === true && isRecord(value.data)
      ? value.data
      : value;
  if (
    !isRecord(root) ||
    !exactKeys(root, [
      "schema",
      "source",
      "apiVersion",
      "sourceUrl",
      "seriesId",
      "months",
      "observation",
      "baseObservation",
      "calculation",
      "retrievedAt",
      "disclosure",
    ]) ||
    root.schema !== INSIGHT_POLYMARKET_BLS_PERCENT_CHANGE_SCHEMA ||
    root.source !== "us-bls-public-data-api-v2" ||
    root.apiVersion !== 2 ||
    root.sourceUrl !== "https://api.bls.gov/publicAPI/v2/timeseries/data/" ||
    typeof root.seriesId !== "string" ||
    !/^[A-Z0-9_#-]{1,32}$/.test(root.seriesId) ||
    root.months !== 12 ||
    typeof root.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(root.retrievedAt)) ||
    typeof root.disclosure !== "string" ||
    root.disclosure.length > 1200 ||
    !root.disclosure.includes(NOTICE) ||
    !isRecord(root.observation) ||
    !isRecord(root.baseObservation) ||
    !isRecord(root.calculation)
  )
    return null;
  const observation = root.observation;
  const base = root.baseObservation;
  const calculation = root.calculation;
  if (
    !exactKeys(observation, [
      "year",
      "period",
      "periodName",
      "value",
      "footnotes",
    ]) ||
    !exactKeys(base, ["year", "period", "value", "footnotes"]) ||
    !exactKeys(calculation, ["type", "value", "blsValue"]) ||
    typeof observation.year !== "string" ||
    !/^(19|20|21)\d{2}$/.test(observation.year) ||
    typeof observation.period !== "string" ||
    !PERIOD.test(observation.period) ||
    typeof observation.periodName !== "string" ||
    !observation.periodName ||
    observation.periodName.length > 100 ||
    typeof observation.value !== "string" ||
    !DECIMAL.test(observation.value) ||
    typeof base.year !== "string" ||
    base.year !== String(Number(observation.year) - 1) ||
    base.period !== observation.period ||
    typeof base.value !== "string" ||
    !DECIMAL.test(base.value) ||
    calculation.type !== "percent-change" ||
    typeof calculation.value !== "string" ||
    !DECIMAL.test(calculation.value) ||
    calculation.blsValue !== calculation.value ||
    independentlyCalculate(observation.value, base.value) !== calculation.value
  )
    return null;
  for (const row of [observation, base]) {
    if (
      !Array.isArray(row.footnotes) ||
      row.footnotes.length > 20 ||
      !row.footnotes.every(
        (item) =>
          isRecord(item) &&
          typeof item.code === "string" &&
          item.code.length <= 20 &&
          typeof item.text === "string" &&
          item.text.length <= 500,
      )
    )
      return null;
  }
  return root;
}

export type InsightPolymarketBlsPercentChangeVerification = {
  valid: boolean;
  reason: "OK" | "MALFORMED" | "HASH_MISMATCH";
  digest: `0x${string}` | null;
};
export function insightPolymarketBlsPercentChangeEvidenceCommitment(
  value: unknown,
): ContextCommitment {
  const evidence = parseEvidence(value);
  if (!evidence)
    throw new TypeError(
      "Invalid Insight Polymarket BLS percent-change evidence",
    );
  return {
    namespace: INSIGHT_POLYMARKET_BLS_PERCENT_CHANGE_NAMESPACE,
    algorithm: "keccak256",
    digest: keccak256(toBytes(canonical(evidence))),
  };
}
export function verifyInsightPolymarketBlsPercentChangeEvidence(
  value: unknown,
  expectedDigest?: string,
): InsightPolymarketBlsPercentChangeVerification {
  const evidence = parseEvidence(value);
  if (!evidence) return { valid: false, reason: "MALFORMED", digest: null };
  try {
    const digest = insightPolymarketBlsPercentChangeEvidenceCommitment(evidence)
      .digest as `0x${string}`;
    if (
      expectedDigest !== undefined &&
      (!/^0x[\da-f]{64}$/i.test(expectedDigest) ||
        digest.toLowerCase() !== expectedDigest.toLowerCase())
    )
      return { valid: false, reason: "HASH_MISMATCH", digest };
    return { valid: true, reason: "OK", digest };
  } catch {
    return { valid: false, reason: "MALFORMED", digest: null };
  }
}
