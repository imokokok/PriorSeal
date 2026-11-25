import assert from "node:assert/strict";
import test from "node:test";

import {
  insightPolymarketBlsPercentChangeEvidenceCommitment,
  verifyInsightPolymarketBlsPercentChangeEvidence,
} from "../../sdk/dist/index.js";

const evidence = {
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
  baseObservation: { year: "2025", period: "M11", value: "100", footnotes: [] },
  calculation: { type: "percent-change", value: "3.7", blsValue: "3.7" },
  retrievedAt: "2026-12-10T13:35:00.000Z",
  disclosure:
    "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov. Independently checked.",
};

test("verifies a BLS v2 percent change against its exact observations and commits it", () => {
  assert.equal(
    verifyInsightPolymarketBlsPercentChangeEvidence(evidence).valid,
    true,
  );
  assert.match(
    insightPolymarketBlsPercentChangeEvidenceCommitment(evidence).digest,
    /^0x[\da-f]{64}$/i,
  );
});

test("rejects a changed result, base period, or unsupported source", () => {
  assert.equal(
    verifyInsightPolymarketBlsPercentChangeEvidence({
      ...evidence,
      calculation: { ...evidence.calculation, value: "3.8", blsValue: "3.8" },
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketBlsPercentChangeEvidence({
      ...evidence,
      baseObservation: { ...evidence.baseObservation, period: "M10" },
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketBlsPercentChangeEvidence({
      ...evidence,
      sourceUrl: "https://example.com",
    }).valid,
    false,
  );
});
