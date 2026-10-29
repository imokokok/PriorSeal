/**
 * Offline verifier for the Grey Ridge Signals testnet provenance worked
 * example. The fixture deliberately has a real public mainnet quote but a
 * synthetic Base Sepolia settlement model: a mainnet-only seller must not be
 * represented as having accepted a testnet payment.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = { [key: string]: Json };

const evidence = parseRecord(
	JSON.parse(await readFile(new URL("./evidence.json", import.meta.url), "utf8")),
	"evidence",
);
const failures: string[] = [];

function check(condition: unknown, code: string): void {
	if (!condition) failures.push(code);
}

function parseRecord(value: unknown, label: string): RecordValue {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	return value as RecordValue;
}

function object(value: Json | undefined, label: string): RecordValue {
	return parseRecord(value, label);
}

function text(value: Json | undefined, label: string): string {
	if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a non-empty string`);
	return value;
}

function bool(value: Json | undefined, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return value;
}

function canonicalJson(value: Json): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
		.join(",")}}`;
}

function digest(value: Json): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const sourceQuote = object(evidence.sourceQuote, "sourceQuote");
const sourceResponse = object(sourceQuote.response, "sourceQuote.response");
const sourceResource = object(sourceResponse.resource, "sourceQuote.response.resource");
const sourceRequirement = object(sourceResponse.requirement, "sourceQuote.response.requirement");
const settlement = object(evidence.testnetSettlement, "testnetSettlement");
const action = object(evidence.action, "action");
const boundaries = object(evidence.boundaries, "boundaries");
const authorization = object(evidence.authorization, "authorization");

const sourceDigest = digest(sourceQuote);
const settlementDigest = digest(settlement);
const actionDigest = digest(action);
const signedAuthorization: RecordValue = {
	schema: text(authorization.schema, "authorization.schema"),
	signedAt: text(authorization.signedAt, "authorization.signedAt"),
	sourceQuoteDigest: text(authorization.sourceQuoteDigest, "authorization.sourceQuoteDigest"),
	settlementDigest: text(authorization.settlementDigest, "authorization.settlementDigest"),
	actionDigest: text(authorization.actionDigest, "authorization.actionDigest"),
	boundaries: object(authorization.boundaries, "authorization.boundaries"),
};
const authorizationDigest = digest(signedAuthorization);

check(evidence.schema === "priorseal.grey-ridge-signals-testnet-provenance.v1", "EVIDENCE_SCHEMA");
check(sourceResponse.httpStatus === 402, "SOURCE_NOT_402");
check(sourceResource.network === "eip155:8453", "SOURCE_NOT_BASE_MAINNET");
check(sourceRequirement.network === "eip155:8453", "SOURCE_REQUIREMENT_NETWORK");
check(sourceRequirement.scheme === "exact", "SOURCE_REQUIREMENT_SCHEME");
check(bool(sourceQuote.paid, "sourceQuote.paid") === false, "SOURCE_MUST_NOT_BE_PAID");
check(text(sourceResponse.paymentRequiredHeaderSha256, "sourceQuote.response.paymentRequiredHeaderSha256").match(/^[0-9a-f]{64}$/), "SOURCE_HEADER_HASH");

check(settlement.mode === "SYNTHETIC_TEST_VECTOR", "SETTLEMENT_MUST_BE_SYNTHETIC");
check(settlement.network === "eip155:84532", "SETTLEMENT_NOT_BASE_SEPOLIA");
check(settlement.settlementState === "SYNTHETIC_SETTLED", "SETTLEMENT_STATE");
check(bool(settlement.paymentPayloadSubmitted, "testnetSettlement.paymentPayloadSubmitted") === false, "SETTLEMENT_MUST_NOT_SUBMIT_PAYMENT");
check(settlement.transactionHash === null, "SETTLEMENT_MUST_NOT_HAVE_TRANSACTION");
check(settlement.sourceQuoteDigest === sourceDigest, "SETTLEMENT_SOURCE_BINDING");

check(action.mode === "TESTNET_EXAMPLE_NOT_BROADCAST", "ACTION_MODE");
check(action.chainId === 84532, "ACTION_NOT_BASE_SEPOLIA");
check(bool(action.authorized, "action.authorized"), "ACTION_NOT_AUTHORIZED");
check(bool(action.broadcast, "action.broadcast") === false, "ACTION_MUST_NOT_BROADCAST");
check(action.settlementDigest === settlementDigest, "ACTION_SETTLEMENT_BINDING");

for (const [key, expected] of Object.entries({
	testnetOnly: true,
	sourcePaid: false,
	greyRidgeSignalValidated: false,
	executionBroadcast: false,
	greyRidgeIntegrationClaimed: false,
	paymentOrDataAccessAuthorized: false,
})) {
	check(boundaries[key] === expected, `BOUNDARY_${key}`);
}

check(authorization.sourceQuoteDigest === sourceDigest, "AUTHORIZATION_SOURCE_BINDING");
check(authorization.settlementDigest === settlementDigest, "AUTHORIZATION_SETTLEMENT_BINDING");
check(authorization.actionDigest === actionDigest, "AUTHORIZATION_ACTION_BINDING");
check(authorization.digest === authorizationDigest, "AUTHORIZATION_DIGEST");

const publicKey = createPublicKey(text(authorization.signerPublicKeyPem, "authorization.signerPublicKeyPem"));
const signature = Buffer.from(text(authorization.signature, "authorization.signature"), "base64");
check(
	verify(null, Buffer.from(authorizationDigest, "hex"), publicKey, signature),
	"AUTHORIZATION_SIGNATURE",
);

const tamperedQuote = structuredClone(sourceQuote);
object(tamperedQuote.response, "tamperedQuote.response").requirement = {
	...object(object(tamperedQuote.response, "tamperedQuote.response").requirement, "tamperedQuote.requirement"),
	amount: "8001",
};
check(digest(tamperedQuote) !== settlement.sourceQuoteDigest, "TAMPERED_QUOTE_MUST_NOT_BIND");

if (failures.length) {
	for (const failure of failures) console.error(`FAIL ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`PASS source quote is an unpaid Base-mainnet HTTP 402 capture (${sourceDigest})`);
	console.log(`PASS synthetic Base-Sepolia settlement model binds that source quote (${settlementDigest})`);
	console.log(`PASS unbroadcast testnet authorization binds the settlement and action (${actionDigest})`);
	console.log("PASS changed source quote fails the source-to-settlement binding");
	console.log("SUMMARY 4/4 PASS");
}
