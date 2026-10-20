import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	runGuardedJupiterMetricsCli,
	summarizeGuardedJupiterEvents,
} from "../../scripts/summarize-guarded-jupiter-events.mjs";

test("guarded Jupiter metrics aggregate only the approved protected-route event shapes", () => {
	const output = summarizeGuardedJupiterEvents([
		JSON.stringify({ event: "guarded_jupiter.prepare_succeeded", requestId: "request-1", method: "POST", path: "/v1/jupiter/guarded-swaps/prepare" }),
		JSON.stringify({ event: "guarded_jupiter.prepare_succeeded", requestId: "request-2", method: "POST", path: "/v1/solana/guarded-swaps/prepare" }),
		JSON.stringify({ event: "guarded_jupiter.submit_completed", requestId: "request-1", method: "POST", path: "/v1/jupiter/guarded-swaps/submit", submission: "SUBMITTED" }),
		JSON.stringify({ event: "guarded_jupiter.submit_completed", requestId: "request-2", method: "POST", path: "/v1/solana/guarded-swaps/submit", submission: "UNKNOWN" }),
		JSON.stringify({ event: "http.request_failed", requestId: "request-3", method: "POST", path: "/v1/jupiter/guarded-swaps/prepare", code: "REQUEST_TIMEOUT", status: 504 }),
		JSON.stringify({ event: "http.request_failed", requestId: "request-4", method: "POST", path: "/v1/jupiter/guarded-swaps/submit", code: "INVALID_REQUEST", status: 400 }),
	]);

	assert.deepEqual(output.source, { acceptedEvents: 6, rejectedLines: 0 });
	assert.deepEqual(output.preparation, { succeeded: 2 });
	assert.deepEqual(output.submission, { total: 2, submitted: 1, unknown: 1, submitPerPrepared: 1, unknownSubmissionRate: 0.5 });
	assert.deepEqual(output.failures, {
		total: 2,
		preparation: 1,
		submission: 1,
		byCode: [{ code: "INVALID_REQUEST", count: 1 }, { code: "REQUEST_TIMEOUT", count: 1 }],
	});
});

test("guarded Jupiter metrics reject unapproved data without reproducing it", () => {
	const secret = "private-wallet-or-transaction-data";
	const output = summarizeGuardedJupiterEvents([
		JSON.stringify({ event: "guarded_jupiter.prepare_succeeded", requestId: "request-1", method: "POST", path: "/v1/jupiter/guarded-swaps/prepare", wallet: secret }),
		JSON.stringify({ event: "http.request_failed", requestId: "request-2", method: "POST", path: "/v1/solana/guarded-swaps/submit", code: "INVALID_REQUEST", status: 400 }),
		"not-json",
	]);

	assert.deepEqual(output.source, { acceptedEvents: 0, rejectedLines: 3 });
	assert.doesNotMatch(JSON.stringify(output), new RegExp(secret));
	assert.equal(output.failures.total, 0);
});

test("guarded Jupiter metrics CLI reads an NDJSON file and exposes no raw event fields", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "priorseal-jupiter-metrics-"));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const input = join(root, "events.ndjson");
	await writeFile(input, `${JSON.stringify({ event: "guarded_jupiter.prepare_succeeded", requestId: "not-in-output", method: "POST", path: "/v1/jupiter/guarded-swaps/prepare" })}\n`, "utf8");
	const output = await runGuardedJupiterMetricsCli([input]);
	assert.match(output, /\"acceptedEvents\": 1/);
	assert.doesNotMatch(output, /not-in-output/);
});
