import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { keccak256 } from "viem";
import {
	assertTrack1Registry,
	assertTrack1SignedDescriptor,
	TRACK1_V3_DESCRIPTOR,
} from "../scripts/interai-track1-registry.mjs";

const releaseId =
	"0x6e3bd18c541cc80e326754a7743f05050df348257102b93f9a13bc82c7e69f6b";
const signer = "0x6506F789Edd43338A416f59822A63F309f97E8ce";
const sender = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const target = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const weth = "eip155:84532/erc20:0x4200000000000000000000000000000000000006";
const usdc = "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const calldata = "0x04e45aaf00000000" as const;
const projection = {
	chainId: 84532,
	sender,
	target,
	value: "0",
	calldataHash: keccak256(calldata),
	nonce: "271",
};
const source = {
	uid: "source-uid",
	signature: "source-signature",
	attester: signer,
	schemaVersion: 3,
	validForSeconds: 600,
	eip712: TRACK1_V3_DESCRIPTOR.eip712,
	data: {
		schemaVersion: 3,
		verdict: "PASS",
		sourceAssetId: weth,
		destinationAssetId: usdc,
		tradeAmountUsd: 4_000_000,
	},
};
const destination = {
	...source,
	uid: "destination-uid",
	signature: "destination-signature",
	data: { ...source.data, sourceAssetId: usdc, destinationAssetId: weth },
};
const candidate = {
	schema: "interai.track1.jit-direct-verify-candidate-package.v1",
	hostPrerequisiteDisposition: "SATISFIED_AT_GENERATION",
	packageId:
		"interai-track1-base-sepolia-1790230000-11111111-2222-4333-8444-555555555555",
	canonicalAction: {
		schema: "interai-canonical-action/v1",
		tool_id: "wallet.send_transaction",
		type: "evm_call",
		operation: "eth_sendTransaction",
		arguments: { ...projection, amount_usd: 4, currency: "USD" },
		external_side_effect: true,
		irreversible: true,
	},
	interaiSixFieldProjection: projection,
	trustRoots: { registryReleaseId: releaseId },
	oracleSafetyCheckV3: { signer },
};

async function fixture(
	directory: string,
	sourceAssertion = source,
): Promise<void> {
	const files = {
		"candidate-run-package.json": candidate,
		"source-oracle-safety-check-v3.json": sourceAssertion,
		"destination-oracle-safety-check-v3.json": destination,
		"source-evidence-binding.json": {
			role: "source",
			assertionUid: sourceAssertion.uid,
			exactCalldata: calldata,
			exactCall: projection,
		},
		"destination-evidence-binding.json": {
			role: "destination",
			assertionUid: destination.uid,
			exactCalldata: calldata,
			exactCall: projection,
		},
		"oracle-registry-current.json": { releaseId },
		"oracle-keys.json": {
			issuer: "https://www.oracleinsight.xyz",
			registryRelease: {
				releaseId,
				current:
					"https://www.oracleinsight.xyz/.well-known/oracle-registry/current.json",
				immutable: `https://www.oracleinsight.xyz/.well-known/oracle-registry/releases/${releaseId}`,
			},
			attestation_enabled: true,
			schemas: { OracleSafetyCheck: TRACK1_V3_DESCRIPTOR },
			public_keys: [
				{
					key_id: "insight-oracle-safety-v2-202609",
					public_key: signer,
					algorithm: "EIP-712/secp256k1",
					validFrom: "2026-08-26T17:35:36.000Z",
					validUntil: null,
					revoked: false,
				},
			],
		},
		[`oracle-registry-release-${releaseId}.json`]: {
			releaseId,
			release: { kind: "OracleRegistryProtocolRelease" },
		},
	};
	await Promise.all(
		Object.entries(files).map(([name, value]) =>
			writeFile(path.join(directory, name), JSON.stringify(value)),
		),
	);
}

test("exact Track 1 pilot request has fixed fields and stringified ordered evidence", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "interai-pilot-wire-"));
	try {
		await fixture(dir);
		const output = path.join(dir, "request.json");
		const result = spawnSync(
			process.execPath,
			[
				"scripts/build-interai-track1-direct-request.mjs",
				"--candidate-dir",
				dir,
				"--output",
				output,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const request = JSON.parse(await readFile(output, "utf8"));
		assert.deepEqual(Object.keys(request).sort(), [
			"action",
			"authorization_ttl_seconds",
			"context",
			"domain",
			"execution_context",
			"external_evidence",
			"policy",
			"use_case",
		]);
		assert.equal(request.use_case, "agent-before-tool-execution");
		assert.equal(request.execution_context.environment, "base-sepolia-testnet");
		assert.equal(request.execution_context.run_id, candidate.packageId);
		assert.deepEqual(request.context, {
			environment: "test",
			user_confirmation: true,
		});
		assert.deepEqual(request.policy, {
			require_trust_receipt: true,
			require_user_confirmation_for_irreversible: true,
		});
		assert.equal(request.domain, "interai-priorseal-track1");
		assert.deepEqual(request.action, candidate.canonicalAction);
		assert.equal(request.external_evidence.length, 2);
		assert.deepEqual(
			JSON.parse(request.external_evidence[0].attestation_json),
			source,
		);
		assert.deepEqual(
			JSON.parse(request.external_evidence[1].attestation_json),
			destination,
		);
		const pinnedRegistry = JSON.parse(
			await readFile(path.join(dir, "oracle-keys.json"), "utf8"),
		);
		for (const item of request.external_evidence) {
			assert.equal(item.profile, "insight.oracle-safety-check.v3.pilot/v1");
			assert.equal(typeof item.registry_json, "string");
			assert.deepEqual(JSON.parse(item.registry_json), pinnedRegistry);
			assert.deepEqual(item.binding, { calldata });
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("JIT registry and signed descriptor drift fail closed", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "interai-pilot-registry-"));
	try {
		await fixture(dir);
		const registryPath = path.join(dir, "oracle-keys.json");
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		assert.doesNotThrow(() => assertTrack1Registry(registry));
		assert.doesNotThrow(() => assertTrack1SignedDescriptor(source));
		for (const mutate of [
			(value: typeof registry) => {
				delete value.schemas.OracleSafetyCheck;
			},
			(value: typeof registry) => {
				value.schemas.OracleSafetyCheck.eip712.types.OracleSafetyCheck[0].type =
					"bytes32";
			},
			(value: typeof registry) => {
				value.registryRelease.immutable = "https://example.com/release";
			},
			(value: typeof registry) => {
				value.public_keys[0].revoked = true;
			},
		]) {
			const changed = structuredClone(registry);
			mutate(changed);
			assert.throws(() => assertTrack1Registry(changed));
		}
		const changedEnvelope = structuredClone(source);
		changedEnvelope.eip712.types.OracleSafetyCheck[0].type = "bytes32";
		assert.throws(() => assertTrack1SignedDescriptor(changedEnvelope));
		delete registry.schemas.OracleSafetyCheck;
		await writeFile(registryPath, JSON.stringify(registry));
		const output = path.join(dir, "request.json");
		const result = spawnSync(
			process.execPath,
			[
				"scripts/build-interai-track1-direct-request.mjs",
				"--candidate-dir",
				dir,
				"--output",
				output,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /v3 EIP-712 descriptor mismatch/);
		await assert.rejects(readFile(output));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("mismatched source asset fails before any request is written", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "interai-pilot-wire-bad-"));
	try {
		await fixture(dir, {
			...source,
			data: { ...source.data, sourceAssetId: usdc },
		});
		const output = path.join(dir, "request.json");
		const result = spawnSync(
			process.execPath,
			[
				"scripts/build-interai-track1-direct-request.mjs",
				"--candidate-dir",
				dir,
				"--output",
				output,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /source assertion or binding mismatch/);
		await assert.rejects(readFile(output));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
