import assert from "node:assert/strict";
import test from "node:test";

import {
  insightPolymarketSourceEvidenceCommitment,
  verifyInsightPolymarketNwsObservationEvidence,
  verifyInsightPolymarketAviationWeatherMetarEvidence,
  verifyInsightPolymarketPublicSourceEvidence,
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

const aviationWeatherEvidence = {
  schema: "insight.polymarket-aviationweather-metar.v1",
  source: "us-aviation-weather-center-data-api",
  sourceUrl:
    "https://aviationweather.gov/api/data/metar?ids=KDAL&format=raw&date=2026-11-27T09%3A00%3A00Z&hours=30",
  stationId: "KDAL",
  date: "2026-11-27T09:00:00.000Z",
  hours: 30,
  reports: ["METAR KDAL 260053Z 14008KT 10SM CLR 12/02 A3011 RMK AO2"],
  retrievedAt: "2026-11-26T01:20:00.000Z",
  disclosure:
    "Timestamped raw snapshot. It may be partial while the source window is in progress, may be corrected or delayed, does not parse temperatures, does not compare observations to thresholds, does not determine event outcomes, and does not authorize execution.",
};

test("validates a fixed AviationWeather query and commits its raw METAR snapshot", () => {
  assert.deepEqual(
    verifyInsightPolymarketAviationWeatherMetarEvidence(
      aviationWeatherEvidence,
    ),
    { valid: true, reason: "OK" },
  );
  const aviationRecord = {
    ...evidence,
    market: {
      ...evidence.market,
      resolutionSource:
        "https://aviationweather.gov/api/data/metar?ids=KDAL&format=raw&date=2026-11-27T09:00:00Z&hours=30",
    },
    observations: [
      {
        id: "dallas-metar-window",
        provider: "aviationweather.metar",
        evidence: aviationWeatherEvidence,
      },
    ],
    reviewWarnings: [
      "METAR snapshot may cover an incomplete source window; human review required.",
    ],
    requiresHumanReview: true,
  };
  const commitment = insightPolymarketSourceEvidenceCommitment(aviationRecord);
  assert.equal(
    verifyInsightPolymarketSourceEvidence(aviationRecord, commitment.digest)
      .valid,
    true,
  );
  const wrongMarketSource = {
    ...aviationRecord,
    market: {
      ...aviationRecord.market,
      resolutionSource:
        "https://aviationweather.gov/api/data/metar?ids=KDFW&format=raw&date=2026-11-27T09:00:00Z&hours=30",
    },
  };
  assert.equal(
    verifyInsightPolymarketSourceEvidence(wrongMarketSource).valid,
    false,
  );
});

test("rejects untrusted AviationWeather hosts and malformed METAR rows", () => {
  assert.equal(
    verifyInsightPolymarketAviationWeatherMetarEvidence({
      ...aviationWeatherEvidence,
      sourceUrl: aviationWeatherEvidence.sourceUrl.replace(
        "aviationweather.gov",
        "example.com",
      ),
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketAviationWeatherMetarEvidence({
      ...aviationWeatherEvidence,
      reports: ["METAR KDFW 260053Z 14008KT"],
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketAviationWeatherMetarEvidence({
      ...aviationWeatherEvidence,
      reports: ["METAR KDALX 260053Z 14008KT"],
    }).valid,
    false,
  );
});

const publicDisclosure =
  "Captured on demand from an official public source over HTTPS. This bounded source record does not interpret market rules, evaluate event outcomes, forecast, recommend a position, and does not authorize execution. Human review is required.";
const publicRecords = [
  {
    provider: "sec.submissions",
    domain: "https://www.sec.gov/Archives/edgar/data/320193/example.htm",
    evidence: {
      schema: "insight.polymarket-sec-submissions.v1",
      source: "us-sec-edgar-data-api",
      sourceUrl: "https://data.sec.gov/submissions/CIK0000320193.json",
      cik: "0000320193",
      companyName: "Example Corp",
      filings: [
        {
          form: "8-K",
          filingDate: "2026-11-20",
          accessionNumber: "0000320193-26-000001",
          primaryDocument: "a.htm",
        },
      ],
      retrievedAt: "2026-11-25T12:00:00.000Z",
      disclosure: publicDisclosure,
    },
  },
  {
    provider: "bea.nipa",
    domain: "https://apps.bea.gov/data/",
    evidence: {
      schema: "insight.polymarket-bea-nipa.v1",
      source: "us-bureau-of-economic-analysis-api",
      sourceUrl: "https://apps.bea.gov/api/data/",
      dataset: "NIPA",
      tableName: "T10101",
      frequency: "Q",
      year: "2026",
      records: [
        {
          tableName: "T10101",
          lineNumber: "1",
          lineDescription: "Gross domestic product",
          timePeriod: "2026Q3",
          dataValue: "123.4",
          unit: "Billions",
          noteRef: "",
        },
      ],
      partial: false,
      retrievedAt: "2026-11-25T12:00:00.000Z",
      disclosure: publicDisclosure,
    },
  },
  {
    provider: "fred.series",
    domain: "https://fred.stlouisfed.org/series/CPIAUCSL",
    evidence: {
      schema: "insight.polymarket-fred-series.v1",
      source: "federal-reserve-bank-of-st-louis-fred-api",
      sourceUrl: "https://api.stlouisfed.org/fred/series/observations",
      termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
      seriesId: "CPIAUCSL",
      observationStart: "2026-10-01",
      observationEnd: "2026-11-30",
      observations: [{ date: "2026-10-01", value: "101.2" }],
      retrievedAt: "2026-11-25T12:00:00.000Z",
      disclosure: publicDisclosure,
    },
  },
  {
    provider: "openfda.application",
    domain:
      "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=021234",
    evidence: {
      schema: "insight.polymarket-openfda-application.v1",
      source: "us-fda-openfda-drugs-at-fda-api",
      sourceUrl: "https://api.fda.gov/drug/drugsfda.json",
      applicationNumber: "NDA021234",
      sponsorName: "Example Pharma",
      submissions: [
        {
          submissionType: "ORIG",
          submissionStatus: "AP",
          submissionStatusDate: "20200101",
        },
      ],
      retrievedAt: "2026-11-25T12:00:00.000Z",
      disclosure: publicDisclosure,
    },
  },
] as const;

test("validates bounded SEC, BEA, FRED and FDA metadata and binds each to its official source domain", () => {
  for (const [index, item] of publicRecords.entries()) {
    assert.deepEqual(
      verifyInsightPolymarketPublicSourceEvidence(item.provider, item.evidence),
      { valid: true, reason: "OK" },
      item.provider,
    );
    const record = {
      ...evidence,
      market: { ...evidence.market, resolutionSource: item.domain },
      observations: [
        {
          id: `public-${index}`,
          provider: item.provider,
          evidence: item.evidence,
        },
      ],
      reviewWarnings: [
        "Public record is source metadata only; human review required.",
      ],
      requiresHumanReview: true,
    };
    const commitment = insightPolymarketSourceEvidenceCommitment(record);
    assert.equal(
      verifyInsightPolymarketSourceEvidence(record, commitment.digest).valid,
      true,
    );
    assert.equal(
      verifyInsightPolymarketSourceEvidence({
        ...record,
        market: evidence.market,
      }).valid,
      false,
    );
  }
});

test("rejects provider payloads with decision fields, forged identifiers, or unsafe URLs", () => {
  const sec = publicRecords[0].evidence;
  assert.equal(
    verifyInsightPolymarketPublicSourceEvidence("sec.submissions", {
      ...sec,
      sourceUrl: "https://evil.example/submissions/CIK0000320193.json",
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketPublicSourceEvidence("sec.submissions", {
      ...sec,
      verdict: "YES",
    }).valid,
    false,
  );
  const fred = publicRecords[2].evidence;
  assert.equal(
    verifyInsightPolymarketPublicSourceEvidence("fred.series", {
      ...fred,
      observations: [{ date: "2026-10-01", value: "101.2", threshold: 100 }],
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketPublicSourceEvidence("fred.series", {
      ...fred,
      observationStart: "2010-01-01",
      observationEnd: "2026-11-30",
    }).valid,
    false,
  );
  assert.equal(
    verifyInsightPolymarketPublicSourceEvidence("fred.series", {
      ...fred,
      observationStart: "2026-02-30",
    }).valid,
    false,
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
