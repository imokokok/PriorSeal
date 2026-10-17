import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareX402EvidencePack } from "../../scripts/x402-evidence-pack.mjs";

test("x402 evidence pack is private, hashed, and excludes sensitive payment material", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "priorseal-x402-evidence-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const writer = await prepareX402EvidencePack(join(root, "pack"));
	await writer.captureResponse({
		receiptId: "psr_deb86e8c35fea8268806afd6aeefbab7",
		resourceUrl:
			"https://priorseal-staging.example/v1/receipts/psr_deb86e8c35fea8268806afd6aeefbab7/bundle",
		paymentRequiredHeader: "base64-public-challenge",
		challenge: {
			x402Version: 2,
			accepts: [{ network: "eip155:84532", amount: "10000" }],
		},
		bundle: {
			schema: "priorseal.verification-bundle.v1",
			bundleHash: "a".repeat(64),
			signature: "issuer-signature",
		},
		settlement: {
			success: true,
			network: "eip155:84532",
			transaction: `0x${"b".repeat(64)}`,
			payer: "0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC",
		},
		payer: "0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC",
		network: "eip155:84532",
		asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		amount: "10000",
		payTo: "0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231",
	});
	const completed = await writer.complete({
		receiptId: "psr_deb86e8c35fea8268806afd6aeefbab7",
		resourceUrl:
			"https://priorseal-staging.example/v1/receipts/psr_deb86e8c35fea8268806afd6aeefbab7/bundle",
		bundleHash: "a".repeat(64),
		paymentEvidenceId: "psp_eff42090ee9e86b9831db8d28203b2a8",
		localVerification: { valid: true, code: "OK" },
		paymentEvidenceVerification: { valid: true, code: "OK" },
	});
	const manifest = JSON.parse(
		await readFile(completed.manifestPath, "utf8"),
	) as {
		files: Array<{ name: string; sha256: string }>;
		retention: { rawPaymentSignatureStored: boolean };
	};
	assert.equal((await stat(completed.directory)).mode & 0o777, 0o700);
	assert.equal((await stat(completed.manifestPath)).mode & 0o777, 0o600);
	assert.deepEqual(
		manifest.files.map((file) => file.name),
		[
			"payment-challenge.json",
			"verification-bundle.json",
			"settlement.json",
			"verification-result.json",
		],
	);
	assert.ok(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)));
	for (const file of manifest.files) {
		const content = await readFile(join(completed.directory, file.name));
		assert.equal(
			file.sha256,
			createHash("sha256").update(content).digest("hex"),
		);
	}
	assert.equal(manifest.retention.rawPaymentSignatureStored, false);
});

test("x402 evidence pack refuses a raw payment signature", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "priorseal-x402-evidence-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const writer = await prepareX402EvidencePack(join(root, "pack"));
	await assert.rejects(
		() =>
			writer.captureResponse({
				receiptId: "psr_deb86e8c35fea8268806afd6aeefbab7",
				resourceUrl: "https://priorseal-staging.example/bundle",
				paymentRequiredHeader: "challenge",
				challenge: { x402Version: 2 },
				bundle: { paymentSignature: "must-not-persist" },
				settlement: { success: true },
				payer: "payer",
				network: "eip155:84532",
				asset: "asset",
				amount: "10000",
				payTo: "payee",
			}),
		/prohibited sensitive field/,
	);
	await assert.rejects(
		() =>
			writer.captureResponse({
				receiptId: "psr_deb86e8c35fea8268806afd6aeefbab7",
				resourceUrl: "https://priorseal-staging.example/bundle",
				paymentRequiredHeader: "challenge",
				challenge: { x402Version: 2 },
				bundle: { payment: { payload: "must-not-persist" } },
				settlement: { success: true },
				payer: "payer",
				network: "eip155:84532",
				asset: "asset",
				amount: "10000",
				payTo: "payee",
			}),
		/prohibited sensitive field/,
	);
});

test("x402 evidence pack rejects a repository destination before creating it", async () => {
	await assert.rejects(
		() => prepareX402EvidencePack(join(process.cwd(), "evidence-output")),
		/outside the repository/,
	);
});
