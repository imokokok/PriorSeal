import assert from "node:assert/strict";
import test from "node:test";

import {
  insightPolymarketSourceEvidenceCommitment,
  verifyInsightPolymarketNwsObservationEvidence,
  verifyInsightPolymarketSourceEvidence,
} from "../../sdk/dist/index.js";

const nwsObservation = {
  schema: "insight.polymarket-nws-observation.v1",
  source: "us-national-weather-service-api",
  sourceUrl: "https://api.weather.gov/stations/KTOP/observations/latest",
  observationUrl:
    "https://api.weather.gov/stations/KTOP/observations/2026-11-25T12:00:00+00:00",
  stationId: "KTOP",
  observedAt: "2026-11-25T12:00:00.000Z",
  description: "Clear",
  property: "temperature",
  measurement: { value: 18.5, unitCode: "wmoUnit:degC", qualityControl: [] },
  retrievedAt: "2026-11-25T12:01:00.000Z",
  disclosure:
    "Captured from the US National Weather Service API. This record does not compare values to thresholds, does not determine event outcomes, and does not authorize execution.",
};

const evidence = {
  schema: "insight.polymarket-source-evidence.v1",
  collectedAt: "2026-11-25T12:01:01.000Z",
  market: {
    id: "weather-market-1",
    slug: "weather-market-1",
    question: "A reviewed source-data question?",
    rulesDigest: `0x${"12".repeat(32)}`,
    resolutionSource: "https://www.weather.gov/",
    endDate: null,
    outcomeNames: ["Yes", "No"],
  },
  binding: {
    source: "server-reviewed-source-binding",
    reviewedAt: "2026-11-25T11:00:00.000Z",
    reviewer: "source-review",
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
      id: "station-temperature",
      provider: "nws.latest-observation",
      evidence: nwsObservation,
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
    "This record contains source observations only. It does not compare an observation to a market threshold and does not evaluate an event outcome, produce a forecast, recommend a position, or authorize execution.",
};

test("validates and commits one exact NWS source observation", () => {
  assert.deepEqual(
    verifyInsightPolymarketNwsObservationEvidence(nwsObservation),
    { valid: true, reason: "OK" },
  );
  const commitment = insightPolymarketSourceEvidenceCommitment(evidence);
  assert.equal(commitment.namespace, "insight.polymarket-source-evidence.v1");
  assert.equal(
    verifyInsightPolymarketSourceEvidence(evidence, commitment.digest).valid,
    true,
  );
});

test("rejects tampered provenance, unknown fields, and threshold data", () => {
  assert.equal(
    verifyInsightPolymarketNwsObservationEvidence({
      ...nwsObservation,
      observationUrl: "https://example.com/stations/KTOP/observations/1",
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketNwsObservationEvidence({
      ...nwsObservation,
      injected: true,
    }).valid,
    false,
  );
  const threshold = structuredClone(evidence);
  (threshold.observations[0]!.evidence as Record<string, unknown>).threshold =
    20;
  assert.deepEqual(verifyInsightPolymarketSourceEvidence(threshold), {
    valid: false,
    reason: "MALFORMED",
    digest: null,
  });
});
