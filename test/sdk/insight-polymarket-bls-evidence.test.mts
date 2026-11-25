import assert from "node:assert/strict";
import test from "node:test";

import {
  insightPolymarketBlsEvidenceCommitment,
  verifyInsightPolymarketBlsEvidence,
} from "../../sdk/dist/index.js";

const evidence = {
  schema: "insight.polymarket-bls-series-evidence.v1",
  source: "us-bls-public-data-api-v1",
  apiVersion: 1,
  sourceUrl: "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0",
  seriesId: "CUUR0000SA0",
  observation: {
    year: "2026",
    period: "M10",
    periodName: "October",
    value: "325.250",
    numericValue: 325.25,
    footnotes: [{ code: "P", text: "Preliminary." }],
  },
  retrievedAt: "2026-11-24T12:00:00.000Z",
  disclosure:
    "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov. Official series observation captured over HTTPS.",
};

test("commits to an exact BLS observation and verifies the stored digest", () => {
  const commitment = insightPolymarketBlsEvidenceCommitment(evidence);
  assert.equal(
    commitment.namespace,
    "insight.polymarket-bls-series-evidence.v1",
  );
  assert.equal(
    verifyInsightPolymarketBlsEvidence(evidence, commitment.digest).valid,
    true,
  );
  assert.equal(
    verifyInsightPolymarketBlsEvidence(evidence, `0x${"00".repeat(32)}`).reason,
    "HASH_MISMATCH",
  );
});

test("rejects tampered values and non-BLS source URLs", () => {
  const tampered = structuredClone(evidence);
  tampered.observation.value = "326.000";
  tampered.observation.numericValue = 326;
  assert.notEqual(
    insightPolymarketBlsEvidenceCommitment(tampered).digest,
    insightPolymarketBlsEvidenceCommitment(evidence).digest,
  );

  const forged = { ...evidence, sourceUrl: "https://example.test/CUUR0000SA0" };
  assert.throws(
    () => insightPolymarketBlsEvidenceCommitment(forged),
    /Invalid Insight Polymarket BLS evidence/,
  );
});

test("accepts a registered BLS API v2 evidence record", () => {
  const version2 = {
    ...evidence,
    source: "us-bls-public-data-api-v2",
    apiVersion: 2,
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0",
  };
  assert.equal(verifyInsightPolymarketBlsEvidence(version2).valid, true);
});
