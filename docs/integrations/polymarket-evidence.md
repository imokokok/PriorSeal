# Polymarket read-only source evidence

PriorSeal can verify and preserve signed source observations associated with a reviewed Polymarket market. This integration records data provenance and integrity only. It does not predict outcomes, compare values with resolution thresholds, recommend positions, authorize orders, or execute transactions.

## Current supported source adapters

- **BLS:** exact public series observations and registered v2 12-month percent changes, including source periods, footnotes, retrieval time, and a calculation consistency check.
- **US National Weather Service:** one latest station measurement from a fixed official API endpoint, including the exact field, unit, station, observation timestamp, source record URL, quality-control flags, and retrieval time.

Each adapter captures a declared source record; it does not establish that the source controls settlement for a market. BLS series/period selection and NWS station/field selection must be part of a server-side market binding reviewed against the current Gamma rules digest. Insight fails closed when no such binding exists or when the market rules change.

The NWS API contains recent station observations only, may delay readings during quality-control processing, and includes stations whose providers vary. Null readings fail closed. Its captured value must not be treated as a market outcome. [NWS API documentation](https://www.weather.gov/documentation/services-web-api)

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
