/** Validates one explicitly confirmed, READY-gated InterAI Track 1 window. */

type Json = Record<string, unknown>;
// Both IDs were independently checked against Gmail originals. The second is
// the continuation thread used for the current coordination exchange.
const VERIFIED_THREAD_IDS = new Set(["19fcde01ce31cf7e", "1a0da1a463040f6d"]);

// One bounded transport can take 20 seconds; retain five seconds for cleanup.
export const TRACK1_SEND_BUDGET_MS = 25_000;

export function track1SendBudget(
	expiries: {
		quote: number;
		source: number;
		destination: number;
		window: number;
	},
	now = Date.now(),
): {
	earliestExpiryIso: string;
	remainingMilliseconds: number;
	requiredMilliseconds: number;
} {
	assert(Number.isFinite(now), "Current time is invalid");
	const times = Object.values(expiries);
	assert(times.every(Number.isFinite), "Every expiry must be finite");
	const earliest = Math.min(...times);
	const remainingMilliseconds = earliest - now;
	assert(
		remainingMilliseconds >= TRACK1_SEND_BUDGET_MS,
		"Insufficient time for 20-second transport and 5-second cleanup",
	);
	return {
		earliestExpiryIso: new Date(earliest).toISOString(),
		remainingMilliseconds,
		requiredMilliseconds: TRACK1_SEND_BUDGET_MS,
	};
}

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function object(value: unknown, label: string): Json {
	assert(
		value !== null && typeof value === "object" && !Array.isArray(value),
		`${label} must be an object`,
	);
	return value as Json;
}

function isoTime(value: unknown, label: string): number {
	assert(
		typeof value === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
				value,
			),
		`${label} must be an explicit ISO timestamp with timezone`,
	);
	const time = Date.parse(value);
	assert(Number.isFinite(time), `${label} is invalid`);
	return time;
}

function messageId(value: unknown, label: string): string {
	assert(
		typeof value === "string" && /^[0-9a-f]{12,32}$/.test(value),
		`${label} must be a Gmail message ID`,
	);
	return value;
}

export function validateTrack1ReadyWindow(
	value: unknown,
	now: number = Date.now(),
): { start: number; end: number; readyAt: number; readyMessageId: string } {
	assert(Number.isFinite(now), "Current time is invalid");
	const ready = object(value, "READY record");
	assert(
		ready.schema === "interai.track1.ready-window.v1" &&
			ready.channel === "verified-email-thread" &&
			typeof ready.threadId === "string" &&
			VERIFIED_THREAD_IDS.has(ready.threadId) &&
			ready.message === "READY" &&
			ready.gate === "enabled-and-verified",
		"Explicit READY and verified bounded gate are required",
	);
	const readyMessageId = messageId(ready.messageId, "READY messageId");
	const readyAt = isoTime(ready.receivedAtIso, "READY receivedAtIso");
	const window = object(ready.window, "confirmed window");
	assert(
		window.channel === "verified-email-thread" &&
			window.threadId === ready.threadId,
		"Window confirmation and READY must be in the same verified email thread",
	);
	const confirmationMessageId = messageId(
		window.confirmationMessageId,
		"Window confirmationMessageId",
	);
	const confirmedAt = isoTime(window.confirmedAtIso, "Window confirmedAtIso");
	const start = isoTime(window.startIso, "Window startIso");
	const end = isoTime(window.endIso, "Window endIso");
	assert(end - start === 60 * 60_000, "Window must be exactly 60 minutes");
	assert(
		confirmedAt < start &&
			confirmedAt < readyAt &&
			confirmationMessageId !== readyMessageId,
		"Window must be independently confirmed before READY",
	);
	assert(
		start <= readyAt && readyAt <= now && now >= start && now < end,
		"READY or current time is outside the confirmed window",
	);
	return { start, end, readyAt, readyMessageId };
}
