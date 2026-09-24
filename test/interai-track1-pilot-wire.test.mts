import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { keccak256 } from "viem";

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
			registryRelease: { releaseId },
			attestation_enabled: true,
			public_keys: [{ public_key: signer, revoked: false }],
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
		for (const item of request.external_evidence) {
			assert.equal(item.profile, "insight.oracle-safety-check.v3.pilot/v1");
			assert.equal(
				JSON.parse(item.registry_json).registryRelease.releaseId,
				releaseId,
			);
			assert.equal(
				JSON.parse(item.registry_json).public_keys[0].public_key,
				signer,
			);
			assert.deepEqual(item.binding, { calldata });
		}
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
