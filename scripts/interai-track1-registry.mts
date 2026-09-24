/** Pinned Insight trust roots and OracleSafetyCheck v3 descriptor for Track 1. */
import { isDeepStrictEqual } from "node:util";

export const TRACK1_RELEASE_ID =
	"0x6e3bd18c541cc80e326754a7743f05050df348257102b93f9a13bc82c7e69f6b";
export const TRACK1_SIGNER = "0x6506F789Edd43338A416f59822A63F309f97E8ce";

const EXPECTED_RELEASE = {
	releaseId: TRACK1_RELEASE_ID,
	current:
		"https://www.oracleinsight.xyz/.well-known/oracle-registry/current.json",
	immutable: `https://www.oracleinsight.xyz/.well-known/oracle-registry/releases/${TRACK1_RELEASE_ID}`,
};

const fieldNames = [
	"verdict:string",
	"sourceAssetId:string",
	"destinationAssetId:string",
	"subjectChainId:uint256",
	"action:string",
	"tradeAmountUsd:uint256",
	"consensusPrice:uint256",
	"maxDeviationBps:uint256",
	"manipulationRiskBps:uint256",
	"participantCount:uint256",
	"requiredParticipantCount:uint256",
	"coverageStatus:string",
	"independenceStatus:string",
	"sourceGroupCount:uint256",
	"crossProviderAgreementBps:uint256",
	"maxStablecoinDepegBps:uint256",
	"maxDataAgeSeconds:uint256",
	"recommendedMaxPositionUsd:uint256",
	"reasonCodesHash:bytes32",
	"requestHash:bytes32",
	"evaluationScope:string",
	"evaluatedAssetIdsHash:bytes32",
	"providerObservationsHash:bytes32",
	"validUntil:uint256",
	"checkedAt:uint256",
	"schemaVersion:uint256",
	"requiredSourceGroupCount:uint256",
] as const;

export const TRACK1_V3_DESCRIPTOR = {
	schemaVersion: 3,
	eip712: {
		domain: { name: "Insight Oracle Safety", version: "3", chainId: 1 },
		types: {
			OracleSafetyCheck: fieldNames.map((field) => {
				const [name, type] = field.split(":");
				return { name, type };
			}),
		},
		primaryType: "OracleSafetyCheck",
	},
};

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
	assert(
		value !== null && typeof value === "object" && !Array.isArray(value),
		`${label} must be an object`,
	);
	return value as Record<string, unknown>;
}

/** Reject a missing or changed pinned registry before building or sending a request. */
export function assertTrack1Registry(
	registryValue: unknown,
	now = Date.now(),
): void {
	const registry = object(registryValue, "Insight key registry");
	assert(
		registry.issuer === "https://www.oracleinsight.xyz",
		"Insight registry issuer mismatch",
	);
	assert(
		isDeepStrictEqual(registry.registryRelease, EXPECTED_RELEASE),
		"Pinned Insight registryRelease metadata mismatch",
	);
	assert(
		registry.attestation_enabled === true,
		"Insight attestation is disabled",
	);
	const schemas = object(registry.schemas, "Insight registry schemas");
	assert(
		isDeepStrictEqual(schemas.OracleSafetyCheck, TRACK1_V3_DESCRIPTOR),
		"Pinned OracleSafetyCheck v3 EIP-712 descriptor mismatch",
	);
	assert(
		Array.isArray(registry.public_keys),
		"Insight registry public_keys missing",
	);
	const signers = registry.public_keys
		.map((entry: unknown) => object(entry, "Insight registry public key"))
		.filter(
			(key: Record<string, unknown>) =>
				typeof key.public_key === "string" &&
				key.public_key.toLowerCase() === TRACK1_SIGNER.toLowerCase(),
		);
	assert(signers.length === 1, "Pinned Insight signer missing or duplicated");
	const signer = signers[0];
	assert(
		signer?.key_id === "insight-oracle-safety-v2-202609" &&
			signer.algorithm === "EIP-712/secp256k1" &&
			signer.revoked === false &&
			signer.validFrom === "2026-08-26T17:35:36.000Z" &&
			signer.validUntil === null &&
			Date.parse(signer.validFrom) <= now,
		"Pinned Insight signer trust root changed or is not active",
	);
}

/** Compare the signed envelope's v3 type and domain with the pinned descriptor. */
export function assertTrack1SignedDescriptor(assertionValue: unknown): void {
	const assertion = object(assertionValue, "OracleSafetyCheck assertion");
	const eip712 = object(assertion.eip712, "OracleSafetyCheck eip712");
	const signedDescriptor = {
		domain: eip712.domain,
		types: eip712.types,
		primaryType: eip712.primaryType,
	};
	assert(
		isDeepStrictEqual(signedDescriptor, TRACK1_V3_DESCRIPTOR.eip712),
		"Signed OracleSafetyCheck v3 EIP-712 descriptor mismatch",
	);
}
