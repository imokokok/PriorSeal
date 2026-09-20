// Vendored standalone @402signal/route-guard v0.7.3 from commit ca6e2f1ee806bec6621487338ba6ed3f1ac09352.

// ../402signal-source/sdk/route-guard/internal-json.mjs
var Fraction = class {
  constructor(value) {
    this.value = value;
  }
};
function parse(raw, { ordinaryNumbers = false, limit = 65536, fail: fail2 = () => {
  throw new SyntaxError("invalid_json");
} } = {}) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > limit)
    fail2("invalid_json");
  let i = 0;
  const white = () => {
    while (" 	\r\n".includes(raw[i]) && i < raw.length) i++;
  };
  const str = () => {
    const start = i++;
    while (i < raw.length) {
      const c = raw[i++];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') {
        let value2;
        try {
          value2 = JSON.parse(raw.slice(start, i));
        } catch {
          fail2("invalid_json");
        }
        for (const ch of value2) {
          const cp = ch.codePointAt(0);
          if (cp >= 55296 && cp <= 57343) fail2("invalid_json");
        }
        return value2;
      }
    }
    fail2("invalid_json");
  };
  function value(depth = 0) {
    if (depth > 24) fail2("invalid_json");
    white();
    if (raw[i] === '"') return str();
    if (raw[i] === "{") {
      i++;
      white();
      const out2 = /* @__PURE__ */ Object.create(null);
      if (raw[i] === "}") {
        i++;
        return out2;
      }
      for (; ; ) {
        white();
        if (raw[i] !== '"') fail2("invalid_json");
        const key = str();
        white();
        if (Object.hasOwn(out2, key) || raw[i++] !== ":") fail2("invalid_json");
        out2[key] = value(depth + 1);
        white();
        if (raw[i] === "}") {
          i++;
          return out2;
        }
        if (raw[i++] !== ",") fail2("invalid_json");
      }
    }
    if (raw[i] === "[") {
      i++;
      white();
      const out2 = [];
      if (raw[i] === "]") {
        i++;
        return out2;
      }
      for (; ; ) {
        out2.push(value(depth + 1));
        white();
        if (raw[i] === "]") {
          i++;
          return out2;
        }
        if (raw[i++] !== ",") fail2("invalid_json");
      }
    }
    for (const [text, v] of [
      ["true", true],
      ["false", false],
      ["null", null]
    ]) {
      if (raw.startsWith(text, i)) {
        i += text.length;
        return v;
      }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      raw.slice(i)
    );
    if (!token) fail2("invalid_json");
    i += token[0].length;
    const n = Number(token[0]);
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
      fail2("invalid_json");
    return /[.eE]/.test(token[0]) && !ordinaryNumbers ? new Fraction(n) : n;
  }
  const out = value();
  white();
  if (i !== raw.length) fail2("invalid_json");
  return out;
}

// ../402signal-source/sdk/route-guard/index.mjs
import {
  createHash,
  createPublicKey,
  verify as verifySignature
} from "node:crypto";
var TYPE = "402signal.route_decision.v4";
var MODEL = "proof_carrying_route_v1";
var HEX = /^[0-9a-f]{64}$/;
var LIMIT = 64 * 1024;
var NORMAL_MISSES = /* @__PURE__ */ new Set([
  "no_candidates",
  "no_402_envelope",
  "no_payto",
  "reachable_200",
  "quote_expired",
  "no_input_schema",
  "constraints_unmet",
  "unsafe_to_probe"
]);
var LEGACY_MISSES = /* @__PURE__ */ new Set([
  ...NORMAL_MISSES,
  "probe_timeout",
  "upstream_5xx",
  "ssrf",
  "probe_budget_exhausted",
  "probe_limit_reached",
  "invalid_need"
]);
function isUnsettledRouteMiss(options) {
  try {
    const { httpStatus, routeResponseJson, paymentResponseHeader } = options;
    if (![200, 503].includes(httpStatus) || paymentResponseHeader !== null) return false;
    const body = parse2(routeResponseJson, { ordinaryNumbers: true, limit: 256 * 1024 });
    const b = body.billing;
    if (body.live !== false || body.payable !== false || body.selected_payment !== null || !b || b.model !== "success_only_v1" || b.condition !== "live_eligible_route_found" || b.asset !== "USDC" || b.amount_atomic !== "3000" || b.display_amount !== "$0.003" || !["base", "solana", "algorand"].includes(b.rail) || b.settlement_attempted !== false || b.settled !== false || b.settlement_state !== "not_attempted") return false;
    if (httpStatus === 503) return LEGACY_MISSES.has(body.miss_reason);
    return NORMAL_MISSES.has(body.miss_reason) && ["error", "binding_error", "binding_error_reason"].every((k) => body[k] == null) && (!Object.hasOwn(body, "evaluation_complete") || body.evaluation_complete === true) && (!Object.hasOwn(body, "candidate_evaluation_complete") || body.candidate_evaluation_complete === true) && (!Object.hasOwn(body, "probe_budget_exhausted") || body.probe_budget_exhausted === false);
  } catch {
    return false;
  }
}
var sha = (...buffers) => createHash("sha256").update(Buffer.concat(buffers.map((b) => Buffer.from(b)))).digest();
var RouteGuardError = class extends Error {
  constructor(code) {
    super(code);
    this.name = "RouteGuardError";
    this.code = code;
  }
};
var fail = (code = "invalid_binding") => {
  throw new RouteGuardError(code);
};
var parse2 = (raw, options = {}) => parse(raw, { ...options, fail });
function canonical(value, ordinaryNumbers = false, depth = 0) {
  if (depth > 24) fail("invalid_json");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && (ordinaryNumbers || Number.isSafeInteger(value)))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map((v) => canonical(v, ordinaryNumbers, depth + 1)).join(",") + "]";
  if (value && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype)) {
    return "{" + Object.keys(value).sort().map(
      (k) => JSON.stringify(k) + ":" + canonical(value[k], ordinaryNumbers, depth + 1)
    ).join(",") + "}";
  }
  fail("invalid_json");
}
var exactKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || Object.keys(obj).length !== keys.length || keys.some((k) => !Object.hasOwn(obj, k)))
    fail();
};
var decode64 = (s, size) => {
  if (typeof s !== "string" || s.length > LIMIT || !/^[A-Za-z0-9+/]*={0,2}$/.test(s))
    fail("invalid_encoding");
  const b = Buffer.from(s, "base64");
  if (b.toString("base64") !== s || size !== void 0 && b.length !== size)
    fail("invalid_encoding");
  return b;
};
var hex32 = (s) => {
  if (typeof s !== "string" || !HEX.test(s)) fail();
  return Buffer.from(s, "hex");
};
function pinnedLogVkey(vkey) {
  if (typeof vkey !== "string" || !vkey.trim()) fail("untrusted_receipt");
  return vkey.trim();
}
function authenticate(tr, vkey) {
  vkey = pinnedLogVkey(vkey);
  const keyParts = /^([^+\s]+)\+([0-9a-f]{8})\+(.+)$/.exec(vkey);
  if (!keyParts) fail("untrusted_receipt");
  const [, origin, kidHex, key64] = keyParts;
  const key = decode64(key64, 33);
  if (key[0] !== 1 || sha(origin + "\n", key).subarray(0, 4).toString("hex") !== kidHex)
    fail("untrusted_receipt");
  const { receipt, reveal } = tr;
  exactKeys(reveal, [
    "type",
    "event_version",
    "ts",
    "nonce",
    "commitment",
    "evidence",
    "salt"
  ]);
  if (reveal.type !== TYPE || reveal.event_version !== TYPE)
    fail("unsupported_receipt");
  exactKeys(reveal.evidence, [
    "evidence_version",
    "routing_evidence_json",
    "request_json",
    "binding"
  ]);
  if (reveal.evidence.evidence_version !== 2) fail("unsupported_receipt");
  const committed = sha(
    TYPE + "\0",
    canonical(reveal.evidence),
    hex32(reveal.salt)
  );
  if (!committed.equals(hex32(reveal.commitment))) fail("commitment_mismatch");
  hex32(reveal.nonce);
  if (typeof reveal.ts !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/.test(reveal.ts))
    fail();
  const leaf = sha(
    Buffer.from([0]),
    canonical({
      type: TYPE,
      ts: reveal.ts,
      nonce: reveal.nonce,
      commitment: reveal.commitment
    })
  );
  if (!leaf.equals(hex32(receipt.leaf_hash))) fail("leaf_mismatch");
  if (typeof receipt.checkpoint !== "string" || receipt.checkpoint.length > LIMIT)
    fail("invalid_checkpoint");
  const note = /^([^\n]+)\n([1-9][0-9]*)\n([^\n]+)\n\n— ([^\s]+) ([^\s]+)\n$/.exec(
    receipt.checkpoint
  );
  if (!note || note[1] !== origin || note[4] !== origin)
    fail("untrusted_origin");
  const size = Number(note[2]);
  if (!Number.isSafeInteger(size)) fail("invalid_checkpoint");
  const root = decode64(note[3], 32), sig = decode64(note[5], 68);
  if (sig.subarray(0, 4).toString("hex") !== kidHex) fail("untrusted_receipt");
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(1)
    ]),
    format: "der",
    type: "spki"
  });
  if (!verifySignature(
    null,
    Buffer.from(`${origin}
${note[2]}
${note[3]}
`),
    publicKey,
    sig.subarray(4)
  ))
    fail("signature_mismatch");
  const index = receipt.index;
  if (!Number.isSafeInteger(index) || index < 0 || index >= size || !Array.isArray(receipt.inclusion_path) || receipt.inclusion_path.length > 53)
    fail("invalid_inclusion");
  const path = receipt.inclusion_path.map((p) => decode64(p, 32));
  const fold = (m, n) => {
    if (n === 1) {
      if (path.length) fail("invalid_inclusion");
      return leaf;
    }
    let k = 1;
    while (k * 2 < n) k *= 2;
    if (!path.length) fail("invalid_inclusion");
    const sibling = path.pop();
    return m < k ? sha(Buffer.from([1]), fold(m, k), sibling) : sha(Buffer.from([1]), sibling, fold(m - k, n - k));
  };
  if (!fold(index, size).equals(root)) fail("invalid_inclusion");
  return reveal.evidence;
}
function context(url, method, body) {
  if (typeof url !== "string" || url.length > 4096 || /[^\x21-\x7e]|[\\#]/.test(url))
    fail("unsupported_resource");
  let u;
  try {
    u = new URL(url);
  } catch {
    fail("unsupported_resource");
  }
  if (!url.startsWith("https://") || u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443")
    fail("unsupported_resource");
  if (!["GET", "POST"].includes(method) || !(body instanceof Uint8Array) || body.length > LIMIT || method === "GET" && body.length)
    fail("unsupported_resource");
  return { url, method, body_sha256: sha(body).toString("hex") };
}
var PAYMENT_REQUIRED_KEYS = [
  "x402Version",
  "accepts",
  "resource",
  "error",
  "extensions",
  "inputSchema"
];
var CHALLENGE_WRAPPERS = ["payment_required", "paymentRequired", "x402"];
var WRAPPER_ONLY_KEYS = /* @__PURE__ */ new Set(["catalog", "paymentRequirements"]);
var KNOWN_EXTENSIONS = /* @__PURE__ */ new Set([
  "bazaar",
  "builder-code",
  "payment-identifier"
]);
var RESOURCE_KEYS = /* @__PURE__ */ new Set([
  "url",
  "description",
  "mimeType",
  "serviceName",
  "tags",
  "iconUrl"
]);
var ACCEPT_KEYS = /* @__PURE__ */ new Set([
  "scheme",
  "network",
  "amount",
  "asset",
  "currency",
  "payTo",
  "maxTimeoutSeconds",
  "extra",
  "outputSchema"
]);
var ICON_URL_MAX = 2048;
function projectPaymentRequired(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return;
  if (!("accepts" in val || "x402Version" in val)) return;
  if ("paymentRequirements" in val && canonical(val.paymentRequirements) !== canonical(val.accepts))
    fail("ambiguous_challenge");
  const out = {};
  for (const key of Object.keys(val)) {
    if (!WRAPPER_ONLY_KEYS.has(key)) out[key] = val[key];
  }
  return out;
}
function bodyChallenge(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return;
  const found = [];
  const direct = projectPaymentRequired(val);
  if (direct) found.push(direct);
  for (const key of CHALLENGE_WRAPPERS) {
    if (key in val) {
      const projected = projectPaymentRequired(val[key]);
      if (projected) found.push(projected);
    }
  }
  if (!found.length) return;
  if (found.some((item) => canonical(item) !== canonical(found[0])))
    fail("ambiguous_challenge");
  return found[0];
}
function challengeFrom(input) {
  if (input.status !== 402) fail("not_402");
  const candidates = [];
  for (const value of [input.paymentRequired, input.xPaymentRequired]) {
    if (value !== void 0) {
      const extracted = bodyChallenge(
        parse2(
          new TextDecoder("utf-8", { fatal: true }).decode(decode64(value))
        )
      );
      if (!extracted) fail("ambiguous_challenge");
      candidates.push(extracted);
    }
  }
  if (input.bodyText) {
    const extracted = bodyChallenge(parse2(input.bodyText));
    if (extracted) candidates.push(extracted);
  }
  if (!candidates.length || candidates.some((c) => canonical(c) !== canonical(candidates[0])))
    fail("ambiguous_challenge");
  const env = candidates[0];
  if (env.x402Version !== 2 || Object.keys(env).some((k) => !PAYMENT_REQUIRED_KEYS.includes(k)) || Object.hasOwn(env, "inputSchema") && (!env.inputSchema || typeof env.inputSchema !== "object" || Array.isArray(env.inputSchema)))
    fail("unsupported_challenge");
  if (!Array.isArray(env.accepts) || !env.accepts.length || env.accepts.length > 32)
    fail("unsupported_challenge");
  if (env.accepts.some(
    (a) => !a || typeof a !== "object" || Array.isArray(a) || Object.hasOwn(a, "outputSchema") && (!a.outputSchema || typeof a.outputSchema !== "object" || Array.isArray(a.outputSchema))
  ))
    fail("unsupported_challenge");
  if (env.extensions !== void 0 && (!env.extensions || Array.isArray(env.extensions) || typeof env.extensions !== "object" || Object.keys(env.extensions).some((k) => !KNOWN_EXTENSIONS.has(k))))
    fail("unsupported_extension");
  if (env.resource != null && (typeof env.resource !== "object" || Array.isArray(env.resource) || Object.keys(env.resource).some((k) => !RESOURCE_KEYS.has(k))))
    fail("unsupported_resource");
  if (env.resource != null) {
    const metadata = env.resource;
    const boundedText = (value) => typeof value === "string" && value.length >= 1 && value.length <= 32 && !/[^ -~]/.test(value);
    if (Object.hasOwn(metadata, "serviceName") && !boundedText(metadata.serviceName) || Object.hasOwn(metadata, "tags") && (!Array.isArray(metadata.tags) || metadata.tags.length > 16 || metadata.tags.some((tag) => !boundedText(tag))))
      fail("unsupported_resource");
    if (Object.hasOwn(metadata, "iconUrl")) {
      if (typeof metadata.iconUrl !== "string" || metadata.iconUrl.length < 1 || metadata.iconUrl.length > ICON_URL_MAX)
        fail("unsupported_resource");
      context(metadata.iconUrl, "GET", new Uint8Array());
    }
  }
  return env;
}
function resourceMatchesContext(resource, actual) {
  if (resource == null || !Object.hasOwn(resource, "url")) return true;
  const advertised = resource.url;
  context(advertised, "GET", new Uint8Array());
  if (advertised === actual.url) return true;
  const queryAt = actual.url.indexOf("?");
  return actual.method === "GET" && actual.body_sha256 === sha(new Uint8Array()).toString("hex") && queryAt >= 0 && queryAt < actual.url.length - 1 && advertised === actual.url.slice(0, queryAt);
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
function verifyRoute(options) {
  try {
    const response = parse2(options.routeResponseJson, { limit: 256 * 1024 });
    const evidence = authenticate(
      response.pq_trust.transparency,
      options.trustedLogVkey
    );
    const expected = parse2(options.routeRequestJson, { ordinaryNumbers: true });
    const original = parse2(evidence.request_json, { ordinaryNumbers: true });
    if (canonical(expected, true) !== canonical(original, true))
      fail("request_mismatch");
    const decision = parse2(evidence.routing_evidence_json, {
      ordinaryNumbers: true
    });
    if (decision.evidence_version !== 1 || decision.decision?.outcome !== "winner" || decision.observation?.live !== true || decision.observation?.payable !== true)
      fail("invalid_evidence");
    const b = evidence.binding;
    exactKeys(b, [
      "model",
      "observed_at",
      "expires_at",
      "request",
      "quote_sha256",
      "selected_index"
    ]);
    exactKeys(b.request, ["url", "method", "body_sha256"]);
    const now = options.now ?? Math.floor(Date.now() / 1e3);
    if (b.model !== MODEL || !Number.isSafeInteger(b.observed_at) || b.observed_at < 0 || !Number.isSafeInteger(b.expires_at) || b.expires_at <= b.observed_at || b.expires_at > b.observed_at + 120)
      fail();
    if (!Number.isSafeInteger(now) || now < b.observed_at || now >= b.expires_at)
      fail("quote_expired");
    if (canonical(response.decision_binding) !== canonical(b))
      fail("binding_mismatch");
    if (decision.decision.winner_url !== b.request.url)
      fail("invalid_evidence");
    hex32(b.request.body_sha256);
    hex32(b.quote_sha256);
    const actual = context(
      options.request.url,
      options.request.method,
      options.request.body ?? new Uint8Array()
    );
    if (canonical(actual) !== canonical(b.request)) fail("resource_changed");
    const env = challengeFrom(options.challenge);
    if (sha(canonical(env)).toString("hex") !== b.quote_sha256)
      fail("quote_changed");
    if (!Number.isSafeInteger(b.selected_index) || b.selected_index < 0 || b.selected_index >= env.accepts.length)
      fail();
    const accepted = env.accepts[b.selected_index];
    if (!accepted || accepted.scheme !== "exact" || !Number.isSafeInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds <= 0 || Object.keys(accepted).some((k) => !ACCEPT_KEYS.has(k)) || !resourceMatchesContext(env.resource, actual))
      fail("unsupported_challenge");
    return freeze(
      JSON.parse(
        canonical({
          model: MODEL,
          request: actual,
          accepted,
          expires_at: b.expires_at,
          quote_sha256: b.quote_sha256
        })
      )
    );
  } catch (error) {
    if (error instanceof RouteGuardError) throw error;
    fail("untrusted_receipt");
  }
}
function withVerifiedRoute(options, authorize) {
  if (typeof authorize !== "function") fail("invalid_authorizer");
  const action = verifyRoute(options);
  return authorize(action);
}
function verifyReceipt(options) {
  try {
    const response = parse2(options.routeResponseJson, { limit: 256 * 1024 });
    const tr = response.pq_trust.transparency;
    const evidence = authenticate(tr, options.trustedLogVkey);
    const expected = parse2(options.routeRequestJson, { ordinaryNumbers: true });
    const original = parse2(evidence.request_json, { ordinaryNumbers: true });
    if (canonical(expected, true) !== canonical(original, true)) fail("request_mismatch");
    return freeze({
      proof: "signature_and_inclusion_verified",
      index: tr.receipt.index,
      checkpoint_size: Number(tr.receipt.checkpoint.split("\n")[1]),
      current_quote: "not_checked",
      payment_confirmation: "not_checked",
      anchor: "not_checked",
      delivery: "not_checked"
    });
  } catch (error) {
    if (error instanceof RouteGuardError) throw error;
    fail("untrusted_receipt");
  }
}
export {
  RouteGuardError,
  isUnsettledRouteMiss,
  verifyReceipt,
  verifyRoute,
  withVerifiedRoute
};
