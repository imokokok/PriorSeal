// Generated from summarize-guarded-jupiter-events.mts by npm run core:build. Do not edit directly.
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_LINE_BYTES = 16 * 1024;
const PREPARE_PATHS = /* @__PURE__ */ new Set([
  "/v1/jupiter/guarded-swaps/prepare",
  "/v1/solana/guarded-swaps/prepare"
]);
const SUBMIT_PATHS = /* @__PURE__ */ new Set([
  "/v1/jupiter/guarded-swaps/submit",
  "/v1/solana/guarded-swaps/submit"
]);
const DIRECT_JUPITER_PREPARE_PATH = "/v1/jupiter/guarded-swaps/prepare";
const DIRECT_JUPITER_SUBMIT_PATH = "/v1/jupiter/guarded-swaps/submit";
function summarizeGuardedJupiterEvents(lines) {
  let acceptedEvents = 0;
  let rejectedLines = 0;
  let prepared = 0;
  let submitted = 0;
  let unknown = 0;
  let preparationFailures = 0;
  let submissionFailures = 0;
  const failuresByCode = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const event = parseSafeEvent(line);
    if (!event) {
      rejectedLines += 1;
      continue;
    }
    acceptedEvents += 1;
    if (event.kind === "prepared") {
      prepared += 1;
    } else if (event.kind === "submitted") {
      submitted += 1;
    } else if (event.kind === "unknown") {
      unknown += 1;
    } else {
      if (event.phase === "prepare") preparationFailures += 1;
      else submissionFailures += 1;
      failuresByCode.set(event.code, (failuresByCode.get(event.code) ?? 0) + 1);
    }
  }
  const totalSubmissions = submitted + unknown;
  return {
    schema: "priorseal.guarded-jupiter-pilot-metrics.v1",
    source: { acceptedEvents, rejectedLines },
    preparation: { succeeded: prepared },
    submission: {
      total: totalSubmissions,
      submitted,
      unknown,
      submitPerPrepared: ratio(totalSubmissions, prepared),
      unknownSubmissionRate: ratio(unknown, totalSubmissions)
    },
    failures: {
      total: preparationFailures + submissionFailures,
      preparation: preparationFailures,
      submission: submissionFailures,
      byCode: [...failuresByCode.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => left.code.localeCompare(right.code))
    },
    limitations: [
      "Aggregate protected-route events do not prove that an authorization was signed, a transaction settled, or evidence was independently verified.",
      "This report intentionally excludes request IDs, wallet addresses, transaction data, provider credentials, request bodies, and browser activity.",
      "Generic /v1/solana/guarded-swaps failures are excluded because the failure event does not identify whether Jupiter or another provider was selected."
    ]
  };
}
function parseSafeEvent(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return null;
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyAllowedKeys(value)) return null;
  if (typeof value.event !== "string" || typeof value.requestId !== "string" || value.requestId.length === 0 || value.requestId.length > 160 || value.method !== "POST" || typeof value.path !== "string")
    return null;
  if (value.event === "guarded_jupiter.prepare_succeeded") {
    return PREPARE_PATHS.has(value.path) && hasExactKeys(value, ["event", "requestId", "method", "path"]) ? { kind: "prepared" } : null;
  }
  if (value.event === "guarded_jupiter.submit_completed") {
    if (!SUBMIT_PATHS.has(value.path) || !hasExactKeys(value, ["event", "requestId", "method", "path", "submission"])) return null;
    return value.submission === "SUBMITTED" ? { kind: "submitted" } : value.submission === "UNKNOWN" ? { kind: "unknown" } : null;
  }
  if (value.event !== "http.request_failed") return null;
  const code = value.code;
  const status = value.status;
  if (!hasExactKeys(value, ["event", "requestId", "method", "path", "code", "status"]) || typeof code !== "string" || !isSafeFailureCode(code) || typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599)
    return null;
  if (value.path === DIRECT_JUPITER_PREPARE_PATH) return { kind: "failed", phase: "prepare", code };
  if (value.path === DIRECT_JUPITER_SUBMIT_PATH) return { kind: "failed", phase: "submit", code };
  return null;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyAllowedKeys(value) {
  return Object.keys(value).every((key) => ["event", "requestId", "method", "path", "submission", "code", "status"].includes(key));
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isSafeFailureCode(value) {
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(value);
}
function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}
async function runGuardedJupiterMetricsCli(args) {
  if (args.length !== 1) throw new TypeError("Usage: npm run jupiter:pilot:metrics -- /absolute/path/to/events.ndjson");
  const inputPath = resolve(args[0]);
  const handle = await open(inputPath, "r");
  try {
    const input = await handle.stat();
    if (!input.isFile()) throw new TypeError("The metrics input must be a regular NDJSON file");
    if (input.size > MAX_INPUT_BYTES) throw new RangeError(`The metrics input must not exceed ${MAX_INPUT_BYTES} bytes`);
    const contents = await handle.readFile({ encoding: "utf8" });
    const lines = contents.split(/\r?\n/).filter((line) => line.length > 0);
    return `${JSON.stringify(summarizeGuardedJupiterEvents(lines), null, 2)}
`;
  } finally {
    await handle.close();
  }
}
const invokedDirectly = process.argv[1] !== void 0 && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runGuardedJupiterMetricsCli(process.argv.slice(2)).then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Unable to summarize guarded Jupiter events";
    process.stderr.write(`${message}
`);
    process.exitCode = 1;
  });
}
export {
  runGuardedJupiterMetricsCli,
  summarizeGuardedJupiterEvents
};
