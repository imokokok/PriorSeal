#!/usr/bin/env node
// Generated from compute-commitments.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
const CORE_PROFILE = "send21.draft.core.v1";
const QUOTE_PROFILE = "send21.draft.quote.v1";
const CORE_NAMESPACE = CORE_PROFILE;
const QUOTE_NAMESPACE = QUOTE_PROFILE;
const coreKeys = [
  "id",
  "network",
  "currency",
  "paymentMethod",
  "receiverAddress",
  "tokenAddress",
  "lightningAddress",
  "bolt11",
  "amountBaseUnits",
  "fiatAmount",
  "fiatCurrency",
  "memo",
  "shortfallAbsorbPercent",
  "paymentRequestId",
  "createdAt",
  "expiresAt",
  "schema"
];
const quoteKeys = [
  "id",
  "draftId",
  "rate",
  "rateSource",
  "fiatAmount",
  "fiatCurrency",
  "cryptoAmountBaseUnits",
  "platformFeeBaseUnits",
  "network",
  "currency",
  "tokenAddress",
  "bolt11",
  "lockedAt",
  "lockedUntil",
  "schema",
  "source",
  "expiresAt",
  "sha256"
];
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function requireRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a JSON object`);
}
function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}
function requireString(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
}
function requireNullableString(value, label) {
  if (value !== null) requireString(value, label);
}
function requireNullableFiniteNumber(value, label) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`${label} must be a finite JSON number or null`);
  }
}
function requireNullableBaseUnits(value, label) {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`${label} must be a non-negative safe integer or null`);
  }
}
function requireTimestamp(value, label) {
  requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new TypeError(`${label} must use UTC milliseconds with a Z suffix`);
  }
}
function jcs(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("JCS accepts JSON records only");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`;
}
function validateCore(core) {
  requireRecord(core, "core");
  requireExactKeys(core, coreKeys, "core");
  for (const field of ["id", "network", "currency", "paymentMethod", "receiverAddress", "tokenAddress", "schema"]) {
    requireString(core[field], `core.${field}`);
  }
  for (const field of ["lightningAddress", "bolt11", "fiatCurrency", "memo", "paymentRequestId"]) {
    requireNullableString(core[field], `core.${field}`);
  }
  requireNullableBaseUnits(core.amountBaseUnits, "core.amountBaseUnits");
  requireNullableFiniteNumber(core.fiatAmount, "core.fiatAmount");
  requireNullableFiniteNumber(core.shortfallAbsorbPercent, "core.shortfallAbsorbPercent");
  requireTimestamp(core.createdAt, "core.createdAt");
  requireTimestamp(core.expiresAt, "core.expiresAt");
  if (core.schema !== CORE_PROFILE) throw new TypeError(`core.schema must be ${CORE_PROFILE}`);
}
function validateQuote(quote) {
  requireRecord(quote, "quote");
  requireExactKeys(quote, quoteKeys, "quote");
  for (const field of ["id", "draftId", "rateSource", "fiatCurrency", "network", "currency", "tokenAddress", "source", "schema", "sha256"]) {
    requireString(quote[field], `quote.${field}`);
  }
  requireNullableString(quote.bolt11, "quote.bolt11");
  requireNullableFiniteNumber(quote.rate, "quote.rate");
  requireNullableFiniteNumber(quote.fiatAmount, "quote.fiatAmount");
  for (const field of ["cryptoAmountBaseUnits", "platformFeeBaseUnits"]) {
    requireNullableBaseUnits(quote[field], `quote.${field}`);
  }
  for (const field of ["lockedAt", "lockedUntil", "expiresAt"]) requireTimestamp(quote[field], `quote.${field}`);
  if (quote.schema !== QUOTE_PROFILE) throw new TypeError(`quote.schema must be ${QUOTE_PROFILE}`);
  if (!/^[0-9a-f]{64}$/.test(quote.sha256)) throw new TypeError("quote.sha256 must be lowercase SHA-256 hex");
}
function coreDigest(core) {
  validateCore(core);
  return sha256(jcs(core));
}
function quoteDigest(quote) {
  validateQuote(quote);
  const { sha256: _publishedHash, ...preimage } = quote;
  return sha256(jcs(preimage));
}
function requirePublishedDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be lowercase SHA-256 hex`);
  }
}
function verifyCoreDigest(core, publishedHash) {
  requirePublishedDigest(publishedHash, "coreSha256");
  const recomputed = coreDigest(core);
  if (recomputed !== publishedHash) throw new Error(`coreSha256 mismatch: got ${recomputed}, expected ${publishedHash}`);
  return recomputed;
}
function verifyQuoteDigest(quote) {
  validateQuote(quote);
  const recomputed = quoteDigest(quote);
  if (recomputed !== quote.sha256) throw new Error(`quote.sha256 mismatch: got ${recomputed}, expected ${quote.sha256}`);
  return recomputed;
}
function contextCommitments(core, publishedCoreHash, quote) {
  const coreHash = verifyCoreDigest(core, publishedCoreHash);
  const quoteHash = verifyQuoteDigest(quote);
  return [
    { namespace: CORE_NAMESPACE, algorithm: "sha256", digest: `0x${coreHash}` },
    { namespace: QUOTE_NAMESPACE, algorithm: "sha256", digest: `0x${quoteHash}` }
  ];
}
const vectorCore = {
  amountBaseUnits: null,
  bolt11: null,
  createdAt: "2026-10-12T08:00:00.123Z",
  currency: "Usdc",
  expiresAt: "2026-10-13T08:00:00.123Z",
  fiatAmount: 25,
  fiatCurrency: "EUR",
  id: "3f2a1c4e-0000-4000-8000-000000000001",
  lightningAddress: null,
  memo: "Invoice 2026-001",
  network: "Base",
  paymentMethod: "MultiOutput",
  paymentRequestId: null,
  receiverAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
  schema: CORE_PROFILE,
  shortfallAbsorbPercent: null,
  tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};
const vectorQuote = {
  bolt11: null,
  cryptoAmountBaseUnits: 27982986,
  currency: "Usdc",
  draftId: "3f2a1c4e-0000-4000-8000-000000000001",
  expiresAt: "2026-10-12T08:15:00.123Z",
  fiatAmount: 25,
  fiatCurrency: "EUR",
  id: "3f2a1c4e-0000-4000-8000-000000000002",
  lockedAt: "2026-10-12T08:00:00.123Z",
  lockedUntil: "2026-10-12T08:15:00.123Z",
  network: "Base",
  platformFeeBaseUnits: 0,
  rate: 0.8934,
  rateSource: "coinbase",
  schema: QUOTE_PROFILE,
  sha256: "67de0e66b1a138b86e5b06e7b2fb63c4ad9a21d38f3ef6bb2eb47277dd1f3481",
  source: "coinbase",
  tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};
const expectedCoreHash = "327bb193ff1cfdf2ecf25a89fb0f4a99b65aefa39524799ec43c6adab9c833d7";
const expectedQuoteHash = "67de0e66b1a138b86e5b06e7b2fb63c4ad9a21d38f3ef6bb2eb47277dd1f3481";
function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: got ${actual}, expected ${expected}`);
}
function expectFailure(label, operation) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`${label}: expected failure`);
}
function verify() {
  expectEqual(verifyCoreDigest(vectorCore, expectedCoreHash), expectedCoreHash, "core vector");
  expectEqual(verifyQuoteDigest(vectorQuote), expectedQuoteHash, "quote vector");
  expectEqual(vectorQuote.sha256, expectedQuoteHash, "published quote hash");
  const missingRequiredNull = { ...vectorCore };
  delete missingRequiredNull.bolt11;
  expectFailure("missing required null", () => coreDigest(missingRequiredNull));
  expectFailure("unexpected core member", () => coreDigest({ ...vectorCore, paymentUri: "derived-only" }));
  expectFailure("quote hash mismatch", () => verifyQuoteDigest({ ...vectorQuote, sha256: "0".repeat(64) }));
  const withHashInPreimage = sha256(jcs(vectorQuote));
  if (withHashInPreimage === expectedQuoteHash) throw new Error("quote sha256 member was included in its own preimage");
  console.log("send21 v0.2 profile-conformance vectors and negative checks pass");
}
if (process.argv.includes("--verify")) {
  verify();
} else {
  const coreHash = coreDigest(vectorCore);
  const quoteHash = quoteDigest(vectorQuote);
  console.log(JSON.stringify({
    profiles: {
      core: { profile: CORE_PROFILE, digest: coreHash, matchesPublished: coreHash === expectedCoreHash },
      quote: { profile: QUOTE_PROFILE, digest: quoteHash, matchesPublished: quoteHash === expectedQuoteHash }
    },
    contextCommitments: contextCommitments(vectorCore, expectedCoreHash, vectorQuote)
  }, null, 2));
}
