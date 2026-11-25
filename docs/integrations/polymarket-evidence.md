# Polymarket read-only source evidence

PriorSeal can verify and preserve signed source observations associated with a reviewed Polymarket market. This integration records data provenance and integrity only. It does not predict outcomes, compare values with resolution thresholds, recommend positions, authorize orders, or execute transactions.

## Current supported source adapters

- **BLS:** exact public series observations and registered v2 12-month percent changes, including source periods, footnotes, retrieval time, and a calculation consistency check.
- **US National Weather Service:** one latest station measurement from a fixed official API endpoint, including the exact field, unit, station, observation timestamp, source record URL, quality-control flags, and retrieval time.

- **AviationWeather METAR:** a bounded snapshot of raw reports from the exact market-declared METAR query URL, including station, query window and retrieval time. Raw reports are not parsed into temperatures or compared with market bands.
- **SEC EDGAR:** the latest one to five filing metadata rows for one exact CIK. The request uses the official submissions endpoint and a configured contact-bearing User-Agent.
- **BEA NIPA:** at most 20 rows from one declared table, frequency and year. A truncated table is marked partial and requires review.
- **FRED:** at most 25 observations from one declared series and date window capped at ten years.
- **openFDA Drugs@FDA:** submission metadata for one exact NDA, BLA or ANDA application number. The API key is optional and is never included in saved evidence.

Each adapter captures a declared source record; it does not establish that the source controls settlement for a market. Every provider must match the official domain of the market's declared resolution source, and its identifiers and periods must be part of a server-side binding reviewed against the current Gamma rules digest. Insight fails closed when no such binding exists, credentials required by a configured provider are missing, or the market rules change.

The NWS API contains recent station observations only, may delay readings during quality-control processing, and includes stations whose providers vary. Null readings fail closed. Its captured value must not be treated as a market outcome. AviationWeather snapshots can be partial until the source query window ends and always carry a human-review warning. Both weather adapters preserve source payloads without determining market results. [NWS API documentation](https://www.weather.gov/documentation/services-web-api)

## Resource and credential limits

Collection runs only when a user requests evidence; there is no polling or scheduled refresh. Insight permits at most eight source observations, fetches at most two sources concurrently, and fetches identical source inputs once per request. The new adapters use four-second request timeouts and bounded response bodies (SEC 256 KB; BEA 96 KB; FRED and openFDA 64 KB); they request one CIK/table/series/application at a time and cap returned records. No provider data is cached between requests. SEC requests require `SEC_EDGAR_USER_AGENT` with a contact email. BEA and FRED keys are required only when a configured binding uses those providers. `OPENFDA_API_KEY` is optional. Provider credentials are sent only from the Worker to the upstream API and are omitted from evidence URLs and Telegram summaries.

FRED evidence includes the official [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html) URL, and the Telegram summary displays it. Insight's Terms of Service also tells users that using a FRED-backed feature binds them to those terms. A downstream application using this SDK/API must preserve the same terms link and user agreement.

## Verify before use

For the signed response from `POST /api/v1/polymarket/evidence`, use the PriorSeal SDK and a trusted Insight key-registry snapshot:

```ts
import {
  insightPolymarketSourceEvidenceCommitment,
  verifyInsightPolymarketSourceEvidenceAttestation,
  verifyInsightPolymarketSourceEvidence,
} from "priorseal";

const signed = await verifyInsightPolymarketSourceEvidenceAttestation(
  response,
  {
    keyRegistry: trustedInsightKeyRegistry,
  },
);
if (!signed.valid) throw new Error(`Evidence rejected: ${signed.reason}`);

const checked = verifyInsightPolymarketSourceEvidence(
  response,
  signed.evidenceHash!,
);
if (!checked.valid) throw new Error(`Evidence rejected: ${checked.reason}`);
const commitment = insightPolymarketSourceEvidenceCommitment(response);
```

The signature is time-limited and proves that the configured Insight key signed the exact evidence bytes. The canonical commitment detects later changes to those bytes. Neither proves that the upstream BLS/NWS record is accurate, that the source page is immutable, or that the market settled correctly.

The Telegram `/evidence <market-id>` path performs the same signature and schema checks, stores the signed evidence and commitment in that chat's Durable Object for up to 30 days, and returns a digest. That private storage is an evidence archive, not a PriorSeal receipt or public transparency anchor.

## Deliberate coverage limits

Sports, election results, court decisions, and crypto-price event evidence are not enabled by this integration. Each needs a specific authoritative source and a human-reviewed mapping for each market; there is no universal source per category. New adapters must add bounded retrieval, strict input and response validation, source-specific revision/freshness/unit semantics, an exact PriorSeal verifier, and tamper/missing-data tests. Do not add outcome comparisons or execution permissions to an adapter.
