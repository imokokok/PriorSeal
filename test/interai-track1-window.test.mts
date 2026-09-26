import assert from "node:assert/strict";
import { test } from "node:test";

import {
	track1SendBudget,
	validateTrack1ReadyWindow,
} from "../scripts/interai-track1-window.mjs";

test("send budget covers transport and cleanup against the earliest expiry", () => {
	const now = Date.parse("2026-09-26T22:02:00+08:00");
	const expiries = {
		quote: now + 60_000,
		source: now + 600_000,
		destination: now + 600_000,
		window: now + 3_000_000,
	};
	assert.equal(track1SendBudget(expiries, now).remainingMilliseconds, 60_000);
	for (const key of Object.keys(expiries) as (keyof typeof expiries)[]) {
		assert.throws(
			() => track1SendBudget({ ...expiries, [key]: now + 24_999 }, now),
			/Insufficient time/,
		);
		assert.equal(
			track1SendBudget({ ...expiries, [key]: now + 25_000 }, now)
				.remainingMilliseconds,
			25_000,
		);
	}
	assert.throws(
		() => track1SendBudget({ ...expiries, source: NaN }, now),
		/finite/,
	);
});

const start = Date.parse("2026-09-27T02:00:00+08:00");
const valid = {
	schema: "interai.track1.ready-window.v1",
	channel: "verified-email-thread",
	threadId: "1a0da1a463040f6d",
	message: "READY",
	messageId: "1a0d9ad08132449b",
	gate: "enabled-and-verified",
	receivedAtIso: "2026-09-27T02:01:00+08:00",
	window: {
		channel: "verified-email-thread",
		threadId: "1a0da1a463040f6d",
		confirmationMessageId: "1a0d9ad08132449a",
		confirmedAtIso: "2026-09-27T01:50:00+08:00",
		startIso: "2026-09-27T02:00:00+08:00",
		endIso: "2026-09-27T03:00:00+08:00",
	},
};

test("accepts a fresh READY in the verified continuation thread and confirmed 60-minute window", () => {
	const result = validateTrack1ReadyWindow(valid, start + 2 * 60_000);
	assert.equal(result.start, start);
	assert.equal(result.end, start + 60 * 60_000);
	assert.equal(result.readyMessageId, valid.messageId);
});

test("also accepts the verified earlier thread when confirmation and READY both use it", () => {
	const threadId = "19fcde01ce31cf7e";
	const result = validateTrack1ReadyWindow(
		{ ...valid, threadId, window: { ...valid.window, threadId } },
		start + 2 * 60_000,
	);
	assert.equal(result.readyMessageId, valid.messageId);
});

test("rejects the expired legacy READY shape and an unverified gate", () => {
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{
					channel: "original-email-thread",
					message: "READY",
					receivedAtIso: "2026-09-25T23:51:50+08:00",
				},
				start + 2 * 60_000,
			),
		/Explicit READY/,
	);
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{ ...valid, gate: "disabled" },
				start + 2 * 60_000,
			),
		/verified bounded gate/,
	);
});

test("rejects a changed window, stale READY, or reused confirmation message", () => {
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{
					...valid,
					window: { ...valid.window, endIso: "2026-09-27T03:01:00+08:00" },
				},
				start + 2 * 60_000,
			),
		/60 minutes/,
	);
	assert.throws(
		() => validateTrack1ReadyWindow(valid, start + 60 * 60_000),
		/outside the confirmed window/,
	);
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{
					...valid,
					window: { ...valid.window, confirmationMessageId: valid.messageId },
				},
				start + 2 * 60_000,
			),
		/independently confirmed/,
	);
});

test("rejects an unknown READY thread or confirmation in a different thread", () => {
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{ ...valid, threadId: "1a0d9ad08132449a" },
				start + 2 * 60_000,
			),
		/Explicit READY/,
	);
	assert.throws(
		() =>
			validateTrack1ReadyWindow(
				{ ...valid, window: { ...valid.window, threadId: "19fcde01ce31cf7e" } },
				start + 2 * 60_000,
			),
		/same verified email thread/,
	);
});
