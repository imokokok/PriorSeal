// Generated from agent-meter.mts by npm run core:build. Do not edit directly.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
function parseAgentMeterConfig(value) {
  if (value === void 0 || value === null || value === "") return void 0;
  const root = record(value, "PRIORSEAL_AGENT_METER_JSON");
  exactKeys(root, ["accounts", "creditUnitUsd", "operatorCredentialHash", "routes", "schema"], "PRIORSEAL_AGENT_METER_JSON");
  if (typeof root.creditUnitUsd !== "string" || !positiveUsd(root.creditUnitUsd)) throw new TypeError("PRIORSEAL_AGENT_METER_JSON has an invalid shape");
  const creditUnitUsd = root.creditUnitUsd;
  if (root.schema !== "priorseal.agent-meter.v1" || typeof root.operatorCredentialHash !== "string" || !SHA256.test(root.operatorCredentialHash) || !Array.isArray(root.accounts) || !Array.isArray(root.routes) || root.accounts.length > 1e3 || root.routes.length > 64) throw new TypeError("PRIORSEAL_AGENT_METER_JSON has an invalid shape");
  const accountIds = /* @__PURE__ */ new Set(), credentialHashes = /* @__PURE__ */ new Set(), routeIds = /* @__PURE__ */ new Set();
  const accounts = root.accounts.map((entry, index) => {
    const item = record(entry, `agent meter account ${index}`);
    exactKeys(item, ["accountId", "credentialHash", "provisionedCredits", "status"], `agent meter account ${index}`);
    if (typeof item.accountId !== "string" || !IDENTIFIER.test(item.accountId) || accountIds.has(item.accountId)) throw new TypeError(`agent meter account ${index} has an invalid or duplicate accountId`);
    if (typeof item.credentialHash !== "string" || !SHA256.test(item.credentialHash) || credentialHashes.has(item.credentialHash)) throw new TypeError(`agent meter account ${index} has an invalid or duplicate credentialHash`);
    if (typeof item.provisionedCredits !== "string" || !positiveUint(item.provisionedCredits)) throw new TypeError(`agent meter account ${index} has an invalid provisionedCredits`);
    if (item.status !== "active" && item.status !== "revoked") throw new TypeError(`agent meter account ${index} has an invalid status`);
    accountIds.add(item.accountId);
    credentialHashes.add(item.credentialHash);
    return { accountId: item.accountId, credentialHash: item.credentialHash, provisionedCredits: item.provisionedCredits, status: item.status };
  });
  const routes = root.routes.map((entry, index) => {
    const item = record(entry, `agent meter route ${index}`);
    exactKeys(item, ["credits", "method", "path", "routeId"], `agent meter route ${index}`);
    if (typeof item.routeId !== "string" || !IDENTIFIER.test(item.routeId) || routeIds.has(item.routeId)) throw new TypeError(`agent meter route ${index} has an invalid or duplicate routeId`);
    if (item.method !== "GET" && item.method !== "POST" || typeof item.path !== "string" || !validRoutePath(item.path) || typeof item.credits !== "string" || !positiveUint(item.credits)) throw new TypeError(`agent meter route ${index} is invalid`);
    routeIds.add(item.routeId);
    return { routeId: item.routeId, method: item.method, path: item.path, credits: item.credits, priceUsd: creditPriceUsd(creditUnitUsd, item.credits) };
  });
  return { schema: "priorseal.agent-meter.v1", creditUnitUsd, operatorCredentialHash: root.operatorCredentialHash, accounts, routes };
}
function agentCredentialHash(secret) {
  if (typeof secret !== "string" || secret.length < 24 || secret.length > 4096) throw new TypeError("Agent credential must contain 24 to 4096 characters");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
function credentialDigestOrNull(secret) {
  try {
    return secret ? agentCredentialHash(secret) : null;
  } catch {
    return null;
  }
}
function createAgentMeter(config, store) {
  if (!config) return null;
  if (!store) throw new TypeError("Agent metering requires a durable store");
  const byCredentialHash = new Map(config.accounts.map((account) => [account.credentialHash, account]));
  const accountFor = async (credential) => {
    if (!credential) throw commercialError("AGENT_CREDENTIAL_INVALID", "The Agent service credential is invalid or revoked");
    const digest = credentialDigestOrNull(credential);
    if (!digest) throw commercialError("AGENT_CREDENTIAL_INVALID", "The Agent service credential is invalid or revoked");
    const configured = byCredentialHash.get(digest);
    if (configured) {
      await store.provisionAgentMeterAccount(configured);
      const state = await store.getAgentMeterAccount(configured.accountId);
      return state ? { ...configured, status: state.status } : configured;
    }
    return store.findAgentMeterAccountByCredentialHash(digest);
  };
  const requireOperator = (credential) => {
    const digest = credentialDigestOrNull(credential);
    if (!digest || !timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(config.operatorCredentialHash, "hex"))) throw commercialError("AGENT_OPERATOR_CREDENTIAL_INVALID", "The operator credential is invalid");
  };
  const requireAccount = async (credential) => {
    const account = await accountFor(credential);
    if (!account || account.status !== "active") throw commercialError("AGENT_CREDENTIAL_INVALID", "The Agent service credential is invalid or revoked");
    return account;
  };
  return {
    config: { creditUnitUsd: config.creditUnitUsd },
    routes: config.routes.map((route) => ({ ...route })),
    async authorize({ method, pathname, credential, requestKey, now }) {
      const route = config.routes.find((candidate) => candidate.method === method && routeMatches(candidate.path, pathname));
      if (!route) return null;
      if (!credential || !requestKey || !IDENTIFIER.test(requestKey)) throw commercialError("AGENT_CREDENTIAL_REQUIRED", "A metered Agent call requires x-priorseal-agent-key and idempotency-key headers");
      const account = await requireAccount(credential);
      const result = await store.reserveAgentUsage({ accountId: account.accountId, routeId: route.routeId, requestKey, credits: route.credits, reservedAt: now });
      if (result.kind === "insufficient") throw commercialError("AGENT_CREDITS_EXHAUSTED", "The Agent service account has insufficient credits");
      return { accountId: account.accountId, reservation: result.reservation };
    },
    settle(reservation, outcome) {
      return store.settleAgentUsage(reservation.usageId, outcome);
    },
    async inspect(credential) {
      const account = await requireAccount(credential);
      const state = await store.getAgentMeterAccount(account.accountId);
      if (!state) throw commercialError("AGENT_CREDENTIAL_INVALID", "The Agent service account is unavailable");
      return state;
    },
    async usage(credential, limit) {
      const account = await requireAccount(credential);
      return store.listAgentMeterUsage(account.accountId, limit);
    },
    operator: {
      authenticate(credential) {
        try {
          requireOperator(credential);
          return true;
        } catch {
          return false;
        }
      },
      async issue({ operatorCredential, accountId, provisionedCredits }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId) || !positiveUint(provisionedCredits)) throw commercialError("AGENT_ACCOUNT_INVALID", "Invalid Agent account request");
        const credential = `psa_${randomBytes(32).toString("base64url")}`;
        const account = { accountId, credentialHash: agentCredentialHash(credential), provisionedCredits, status: "active" };
        if (!await store.createAgentMeterAccount(account)) throw commercialError("AGENT_ACCOUNT_EXISTS", "Agent service account already exists");
        const state = await store.getAgentMeterAccount(accountId);
        if (!state) throw new Error("Agent account was not provisioned");
        return { account: state, credential };
      },
      async credit({ operatorCredential, accountId, credits, requestKey, reference, now }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId) || !positiveUint(credits) || reference !== null && (!IDENTIFIER.test(reference) || reference.length > 128)) throw commercialError("AGENT_ACCOUNT_INVALID", "Invalid Agent credit request");
        if (!requestKey || !IDENTIFIER.test(requestKey)) throw commercialError("AGENT_IDEMPOTENCY_REQUIRED", "An Agent credit operation requires an idempotency-key header");
        const operation = { operationId: `aco_${hashOperation({ accountId, requestKey }).slice(0, 32)}`, accountId, requestKey, credits, reference, creditedAt: now };
        const result = await store.creditAgentMeterAccount(operation);
        if (!result) throw commercialError("AGENT_ACCOUNT_NOT_FOUND", "Agent service account was not found");
        return result;
      },
      async revoke({ operatorCredential, accountId }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId)) throw commercialError("AGENT_ACCOUNT_INVALID", "Invalid Agent account identifier");
        const state = await store.revokeAgentMeterAccount(accountId);
        if (!state) throw commercialError("AGENT_ACCOUNT_NOT_FOUND", "Agent service account was not found");
        return state;
      }
    }
  };
}
function routeMatches(pattern, pathname) {
  const expected = pattern.split("/"), actual = pathname.split("/");
  return expected.length === actual.length && expected.every((part, index) => part.startsWith(":") ? actual[index].length > 0 : part === actual[index]);
}
function validRoutePath(path) {
  return path.startsWith("/") && !path.includes("//") && path.split("/").slice(1).every((segment) => IDENTIFIER.test(segment) || /^:[A-Za-z][A-Za-z0-9]*$/.test(segment));
}
function positiveUint(value) {
  return /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 9007199254740991n;
}
function positiveUsd(value) {
  return /^(?:0|[1-9][0-9]{0,4})\.[0-9]{1,6}$/.test(value) && BigInt(value.replace(".", "")) > 0n;
}
function creditPriceUsd(unit, credits) {
  const [whole, fraction] = unit.split(".");
  const scale = fraction.length;
  const amount = (BigInt(`${whole}${fraction}`) * BigInt(credits)).toString().padStart(scale + 1, "0");
  const decimals = amount.slice(-scale).replace(/0+$/, "");
  return decimals ? `${amount.slice(0, -scale)}.${decimals}` : amount.slice(0, -scale);
}
function hashOperation(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new TypeError(`${label} has unknown or missing fields`);
}
function commercialError(code, message) {
  return Object.assign(new Error(message), { code });
}
export {
  agentCredentialHash,
  createAgentMeter,
  parseAgentMeterConfig
};
