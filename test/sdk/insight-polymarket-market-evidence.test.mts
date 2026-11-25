import assert from "node:assert/strict";
import test from "node:test";
import { hashTypedData, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
  INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
  insightPolymarketSourceEvidenceCommitment,
  verifyInsightPolymarketSourceEvidenceAttestation,
  verifyInsightPolymarketSourceEvidence,
  verifyInsightPolymarketBlsEvidence,
  verifyInsightPolymarketBlsPercentChangeEvidence,
} from "../../sdk/dist/index.js";

const signer = privateKeyToAccount(`0x${"45".repeat(32)}` as `0x${string}`);
const now = 1_800_000_000;
const keyRegistry = {
  keys: [{ key_id: "polymarket-source-test", public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: "attester" as const }],
};

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

async function signedEvidenceResponse() {
  const evidenceHash = keccak256(toBytes(canonical(evidence)));
  const issuedAt = now;
  const validUntil = now + 300;
  const typedData = {
    domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
    types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
    primaryType: "PolymarketSourceEvidence" as const,
    message: { evidenceHash, marketId: evidence.market.id, issuedAt: BigInt(issuedAt), validUntil: BigInt(validUntil), schemaVersion: 1n },
  };
  return {
    success: true,
    data: {
      evidence,
      attestation: {
        schema: "insight.polymarket-source-evidence-attestation.v1",
        decisionHash: evidenceHash,
        attestation: {
          type: "PolymarketSourceEvidence",
          schemaVersion: 1,
          uid: hashTypedData(typedData),
          attester: signer.address,
          signedAt: new Date(issuedAt * 1000).toISOString(),
          validForSeconds: 300,
          signature: await signer.signTypedData(typedData),
          data: { evidenceHash, marketId: evidence.market.id, issuedAt, validUntil, schemaVersion: 1 },
          eip712: { domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN, types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES, primaryType: "PolymarketSourceEvidence" },
        },
      },
    },
  };
}

const evidence = {
  schema: "insight.polymarket-source-evidence.v1",
  collectedAt: "2026-11-25T12:00:00.000Z",
  market: {
    id: "market-1",
    slug: "market-1",
    question: "A market question?",
    rulesDigest: `0x${"12".repeat(32)}`,
    resolutionSource: "https://www.bls.gov/example",
    endDate: "2026-12-10T13:30:00.000Z",
    outcomeNames: ["Yes", "No"],
  },
  binding: {
    source: "server-reviewed-source-binding",
    reviewedAt: "2026-11-25T10:00:00.000Z",
    reviewer: "reviewer",
  },
  checks: {
    marketActive: true,
    marketOpen: true,
    rulesDigestStable: true,
    resolutionSourceDeclared: true,
    sourceEvidenceRetrieved: true,
  },
  observations: [
    {
      id: "cpi-yoy",
      provider: "bls.percent-change",
      evidence: {
        schema: "insight.polymarket-bls-percent-change-evidence.v1",
        source: "us-bls-public-data-api-v2",
        apiVersion: 2,
        sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        seriesId: "CUUR0000SA0",
        months: 12,
        observation: {
          year: "2026",
          period: "M11",
          periodName: "November",
          value: "103.7",
          footnotes: [],
        },
        baseObservation: {
          year: "2025",
          period: "M11",
          value: "100",
          footnotes: [],
        },
        calculation: { type: "percent-change", value: "3.7", blsValue: "3.7" },
        retrievedAt: "2026-12-10T13:35:00.000Z",
        disclosure:
          "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov. BLS calculated percent change is independently checked against the captured observations.",
      },
    },
    {
      id: "unemployment-observation",
      provider: "bls.series",
      evidence: {
        schema: "insight.polymarket-bls-series-evidence.v1",
        source: "us-bls-public-data-api-v1",
        apiVersion: 1,
        sourceUrl:
          "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000",
        seriesId: "LNS14000000",
        observation: {
          year: "2026",
          period: "M10",
          periodName: "October",
          value: "4.0",
          numericValue: 4,
          footnotes: [],
        },
        retrievedAt: "2026-11-25T11:59:00.000Z",
        disclosure:
          "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.",
      },
    },
  ],
  reviewWarnings: [],
  requiresHumanReview: false,
  scope: {
    outcomeEvaluation: "not_performed",
    settlement: "not_performed",
    transactionAuthority: "none",
    execution: "not_performed",
  },
  disclosure:
    "This record contains market-integrity checks and source observations only. It does not compare an observation to a market threshold and does not evaluate an event outcome, produce a forecast, recommend a position, or authorize execution.",
};

test("validates and commits market metadata and exact BLS source records only", () => {
  assert.equal(
    verifyInsightPolymarketBlsPercentChangeEvidence(
      evidence.observations[0].evidence,
    ).valid,
    true,
  );
  assert.equal(
    verifyInsightPolymarketBlsEvidence(evidence.observations[1].evidence).valid,
    true,
  );
  const commitment = insightPolymarketSourceEvidenceCommitment(evidence);
  assert.equal(commitment.namespace, "insight.polymarket-source-evidence.v1");
  assert.equal(
    verifyInsightPolymarketSourceEvidence(evidence, commitment.digest).valid,
    true,
  );
});

test("rejects outcome derivation fields and tampered market or source evidence", () => {
  assert.equal(
    verifyInsightPolymarketSourceEvidence({
      ...evidence,
      candidateOutcome: "Yes",
    }).valid,
    false,
  );
  const commitment = insightPolymarketSourceEvidenceCommitment(evidence);
  const changedMarket = structuredClone(evidence);
  changedMarket.market.rulesDigest = `0x${"34".repeat(32)}`;
  assert.equal(
    verifyInsightPolymarketSourceEvidence(changedMarket, commitment.digest)
      .valid,
    false,
  );
  const changedObservation = structuredClone(evidence);
  const changedFirstObservation = changedObservation.observations[0];
  assert.ok(changedFirstObservation);
  const changedCalculation = changedFirstObservation.evidence.calculation;
  assert.ok(changedCalculation);
  changedCalculation.value = "3.8";
  assert.equal(
    verifyInsightPolymarketSourceEvidence(changedObservation).valid,
    false,
  );
});

test("rejects a false integrity check or a scope that claims outcome evaluation", () => {
  assert.equal(
    verifyInsightPolymarketSourceEvidence({
      ...evidence,
      checks: { ...evidence.checks, rulesDigestStable: false },
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketSourceEvidence({
      ...evidence,
      scope: { ...evidence.scope, outcomeEvaluation: "performed" },
    }).valid,
    false,
  );
});

test("verifies Insight source-evidence signature, trusted key epoch, and exact record commitment", async () => {
  const response = await signedEvidenceResponse();
  const verification = await verifyInsightPolymarketSourceEvidenceAttestation(response, { keyRegistry, now });
  assert.equal(verification.valid, true, JSON.stringify(verification));
  assert.equal(verification.signatureValid, true);
  assert.equal(verification.trusted, true);
  assert.equal(verification.evidenceHash, insightPolymarketSourceEvidenceCommitment(evidence).digest);
  assert.equal(verifyInsightPolymarketSourceEvidence(response).valid, true);
});

test("rejects modified evidence, untrusted signers, and expired source attestations", async () => {
  const response = await signedEvidenceResponse();
  const altered = structuredClone(response);
  altered.data.evidence.market.question = "Changed question";
  assert.equal((await verifyInsightPolymarketSourceEvidenceAttestation(altered, { keyRegistry, now })).valid, false);
  assert.equal((await verifyInsightPolymarketSourceEvidenceAttestation(response, { now })).reason, "SIGNER_UNTRUSTED");
  assert.equal((await verifyInsightPolymarketSourceEvidenceAttestation(response, { keyRegistry, now: now + 300 })).reason, "EXPIRED");
});
