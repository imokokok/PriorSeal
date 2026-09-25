import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTrack1ReadyWindow } from "../scripts/interai-track1-window.mjs";

const start = Date.parse("2026-09-27T02:00:00+08:00");
const valid = {
	schema: "interai.track1.ready-window.v1",
	channel: "original-email-thread",
	message: "READY",
	messageId: "1a0d9ad08132449b",
	gate: "enabled-and-verified",
	receivedAtIso: "2026-09-27T02:01:00+08:00",
	window: {
		channel: "original-email-thread",
		confirmationMessageId: "1a0d9ad08132449a",
		confirmedAtIso: "2026-09-27T01:50:00+08:00",
		startIso: "2026-09-27T02:00:00+08:00",
		endIso: "2026-09-27T03:00:00+08:00",
	},
};

test("accepts a fresh READY only inside an independently confirmed 60-minute window", () => {
	const result = validateTrack1ReadyWindow(valid, start + 2 * 60_000);
	assert.equal(result.start, start);
	assert.equal(result.end, start + 60 * 60_000);
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
				{ ...valid, window: { ...valid.window, endIso: "2026-09-27T03:01:00+08:00" } },
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
				{ ...valid, window: { ...valid.window, confirmationMessageId: valid.messageId } },
				start + 2 * 60_000,
			),
		/independently confirmed/,
	);
});
