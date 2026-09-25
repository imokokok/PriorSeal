// Generated from interai-track1-window.mts by npm run core:build. Do not edit directly.
const VERIFIED_THREAD_IDS = /* @__PURE__ */ new Set([
  "19fcde01ce31cf7e",
  "1a0da1a463040f6d"
]);
function assert(value, message) {
  if (!value) throw new Error(message);
}
function object(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
  return value;
}
function isoTime(value, label) {
  assert(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    `${label} must be an explicit ISO timestamp with timezone`
  );
  const time = Date.parse(value);
  assert(Number.isFinite(time), `${label} is invalid`);
  return time;
}
function messageId(value, label) {
  assert(
    typeof value === "string" && /^[0-9a-f]{12,32}$/.test(value),
    `${label} must be a Gmail message ID`
  );
  return value;
}
function validateTrack1ReadyWindow(value, now = Date.now()) {
  assert(Number.isFinite(now), "Current time is invalid");
  const ready = object(value, "READY record");
  assert(
    ready.schema === "interai.track1.ready-window.v1" && ready.channel === "verified-email-thread" && typeof ready.threadId === "string" && VERIFIED_THREAD_IDS.has(ready.threadId) && ready.message === "READY" && ready.gate === "enabled-and-verified",
    "Explicit READY and verified bounded gate are required"
  );
  const readyMessageId = messageId(ready.messageId, "READY messageId");
  const readyAt = isoTime(ready.receivedAtIso, "READY receivedAtIso");
  const window = object(ready.window, "confirmed window");
  assert(
    window.channel === "verified-email-thread" && window.threadId === ready.threadId,
    "Window confirmation and READY must be in the same verified email thread"
  );
  const confirmationMessageId = messageId(
    window.confirmationMessageId,
    "Window confirmationMessageId"
  );
  const confirmedAt = isoTime(
    window.confirmedAtIso,
    "Window confirmedAtIso"
  );
  const start = isoTime(window.startIso, "Window startIso");
  const end = isoTime(window.endIso, "Window endIso");
  assert(end - start === 60 * 6e4, "Window must be exactly 60 minutes");
  assert(
    confirmedAt < start && confirmedAt < readyAt && confirmationMessageId !== readyMessageId,
    "Window must be independently confirmed before READY"
  );
  assert(
    start <= readyAt && readyAt <= now && now >= start && now < end,
    "READY or current time is outside the confirmed window"
  );
  return { start, end, readyAt, readyMessageId };
}
export {
  validateTrack1ReadyWindow
};
