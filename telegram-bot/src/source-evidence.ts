import {
  insightPolymarketSourceEvidenceCommitment,
  verifyInsightPolymarketSourceEvidenceAttestation,
} from "../../sdk/dist/index.js";
import type { KeyRegistry } from "verify-insight-receipt";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_STORED_EVIDENCE_BYTES = 64 * 1024;

type SourceEvidenceEnv = {
  INSIGHT_API_KEY?: string;
  INSIGHT_BASE_URL?: string;
  INSIGHT_KEY_REGISTRY_URL?: string;
};
type Fetcher = typeof fetch;
export type VerifiedSourceEvidence = {
  summary: string;
  marketId: string;
  collectedAt: string;
  evidenceHash: string;
  payloadJson: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeField(value: unknown, maxLength = 180): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, maxLength)
    : "n/a";
}

async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function fetchJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
    throw new Error("UPSTREAM_TOO_LARGE");
  const text = await readBoundedStream(response.body, MAX_RESPONSE_BYTES);
  if (text === null) throw new Error("UPSTREAM_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("UPSTREAM_INVALID_JSON");
  }
}

function evidenceFromResponse(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const data =
    value.success === true && isRecord(value.data) ? value.data : value;
  return isRecord(data) && isRecord(data.evidence) ? data.evidence : null;
}

function sourceObservationSummary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 6)
    .map((item) => {
      const detail = isRecord(item.evidence) ? item.evidence : {};
      if (item.provider === "aviationweather.metar") {
        const reports = Array.isArray(detail.reports)
          ? detail.reports.length
          : 0;
        return `Source ${safeField(item.id, 64)}: ${safeField(detail.stationId, 4)} | ${reports} raw METAR reports | ${safeField(detail.retrievedAt, 32)}`;
      }
      if (item.provider === "nws.latest-observation") {
        const measurement = isRecord(detail.measurement)
          ? detail.measurement
          : {};
        const valueText =
          typeof measurement.value === "number" &&
          Number.isFinite(measurement.value)
            ? `${measurement.value} ${safeField(measurement.unitCode, 80)}`
            : "n/a";
        const observedAt =
          typeof detail.observedAt === "string" ? detail.observedAt : "";
        return `Source ${safeField(item.id, 64)}: ${safeField(valueText, 48)} | ${safeField(detail.property, 48)}${observedAt ? ` | ${safeField(observedAt, 32)}` : ""}`;
      }
      if (item.provider === "sec.submissions") {
        const filings = Array.isArray(detail.filings)
          ? detail.filings.length
          : 0;
        return `Source ${safeField(item.id, 64)}: SEC CIK ${safeField(detail.cik, 10)} | ${filings} recent filing records`;
      }
      if (item.provider === "bea.nipa") {
        const records = Array.isArray(detail.records)
          ? detail.records.length
          : 0;
        return `Source ${safeField(item.id, 64)}: BEA ${safeField(detail.tableName, 24)} ${safeField(detail.frequency, 2)} ${safeField(detail.year, 4)} | ${records} rows${detail.partial === true ? " | partial" : ""}`;
      }
      if (item.provider === "fred.series") {
        const observations = Array.isArray(detail.observations)
          ? detail.observations.length
          : 0;
        return `Source ${safeField(item.id, 64)}: FRED ${safeField(detail.seriesId, 32)} | ${observations} observations | Terms: ${safeField(detail.termsUrl, 100)}`;
      }
      if (item.provider === "openfda.application") {
        const submissions = Array.isArray(detail.submissions)
          ? detail.submissions.length
          : 0;
        return `Source ${safeField(item.id, 64)}: FDA ${safeField(detail.applicationNumber, 16)} | ${submissions} submission records`;
      }
      const observation = isRecord(detail.observation)
        ? detail.observation
        : {};
      const calculation = isRecord(detail.calculation)
        ? detail.calculation
        : {};
      const valueText =
        typeof calculation.value === "string"
          ? `${calculation.value}% (12-month change)`
          : typeof observation.value === "string"
            ? observation.value
            : "n/a";
      const period = [
        observation.year,
        observation.periodName ?? observation.period,
      ]
        .filter((part) => typeof part === "string")
        .join(" ");
      return `Source ${safeField(item.id, 64)}: ${safeField(valueText, 48)}${period ? ` | ${safeField(period, 48)}` : ""}`;
    });
}

function buildEvidenceSummary(
  evidence: Record<string, unknown>,
  digest: string,
): string {
  const market = isRecord(evidence.market) ? evidence.market : {};
  const checks = isRecord(evidence.checks) ? evidence.checks : {};
  const observations = sourceObservationSummary(evidence.observations);
  const warnings = Array.isArray(evidence.reviewWarnings)
    ? evidence.reviewWarnings
        .filter((warning): warning is string => typeof warning === "string")
        .slice(0, 3)
    : [];
  return [
    `Polymarket source evidence: ${safeField(market.slug)}`,
    `Market ID: ${safeField(market.id, 100)}`,
    `Market active/open: ${checks.marketActive === true && checks.marketOpen === true ? "yes" : "not verified"}`,
    `Rules stable: ${checks.rulesDigestStable === true ? "yes" : "no"}`,
    `Collected: ${safeField(evidence.collectedAt, 32)}`,
    ...observations,
    ...warnings.map((warning) => `Review note: ${safeField(warning, 120)}`),
    "PriorSeal: Insight signature and trusted key verified",
    `Evidence commitment: ${digest}`,
    "Outcome evaluation and settlement: not performed. No forecast, recommendation, or transaction authority.",
  ].join("\n");
}

/** Fetch only reviewed Insight evidence, verify its issuer, then return a read-only summary. */
export async function collectMarketEvidence(
  env: SourceEvidenceEnv,
  marketId: string,
  fetcher: Fetcher = fetch,
): Promise<VerifiedSourceEvidence> {
  const apiKey = env.INSIGHT_API_KEY;
  const base = env.INSIGHT_BASE_URL;
  const registryAddress = env.INSIGHT_KEY_REGISTRY_URL;
  if (!apiKey || !base || !registryAddress)
    throw new Error("BOT_CONFIGURATION_INCOMPLETE");
  let baseUrl: URL;
  let registryUrl: URL;
  try {
    baseUrl = new URL(base);
    registryUrl = new URL(registryAddress);
  } catch {
    throw new Error("BOT_UPSTREAM_URL_INVALID");
  }
  if (
    baseUrl.protocol !== "https:" ||
    registryUrl.protocol !== "https:" ||
    baseUrl.origin !== "https://www.oracleinsight.xyz" ||
    registryUrl.origin !== baseUrl.origin ||
    registryUrl.pathname !== "/.well-known/oracle-keys.json"
  )
    throw new Error("BOT_UPSTREAM_URL_INVALID");

  const endpoint = new URL("/api/v1/polymarket/evidence", baseUrl);
  const [response, registryDocument] = await Promise.all([
    fetchJson(
      fetcher,
      endpoint.toString(),
      {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ marketId }),
      },
      24_000,
    ),
    fetchJson(fetcher, registryUrl.toString(), {
      headers: { accept: "application/json" },
    }),
  ]);
  if (!isRecord(registryDocument)) throw new Error("KEY_REGISTRY_INVALID");
  const verification = await verifyInsightPolymarketSourceEvidenceAttestation(
    response,
    {
      keyRegistry: registryDocument as KeyRegistry,
    },
  );
  if (!verification.valid)
    throw new Error(`EVIDENCE_ATTESTATION_${verification.reason}`);
  const evidence = evidenceFromResponse(response);
  if (
    !evidence ||
    !isRecord(evidence.market) ||
    evidence.market.id !== marketId
  ) {
    throw new Error("ATTESTED_RESULT_MISMATCH");
  }
  const commitment = insightPolymarketSourceEvidenceCommitment(response);
  if (
    commitment.digest.toLowerCase() !== verification.evidenceHash?.toLowerCase()
  ) {
    throw new Error("EVIDENCE_COMMITMENT_MISMATCH");
  }
  const payloadJson = JSON.stringify(response);
  if (
    new TextEncoder().encode(payloadJson).byteLength > MAX_STORED_EVIDENCE_BYTES
  ) {
    throw new Error("EVIDENCE_RECORD_TOO_LARGE");
  }
  if (typeof evidence.collectedAt !== "string")
    throw new Error("EVIDENCE_TIMESTAMP_INVALID");
  return {
    summary: buildEvidenceSummary(evidence, commitment.digest),
    marketId,
    collectedAt: evidence.collectedAt,
    evidenceHash: commitment.digest,
    payloadJson,
  };
}
