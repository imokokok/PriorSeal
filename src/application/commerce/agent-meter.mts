import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type AgentMeterAccount = {
  accountId: string;
  credentialHash: string;
  provisionedCredits: string;
  status: 'active' | 'revoked';
};

export type AgentMeterRoute = {
  routeId: string;
  method: 'GET' | 'POST';
  path: string;
  credits: string;
  priceUsd: string;
};

export type AgentMeterConfig = {
  schema: 'priorseal.agent-meter.v1';
  creditUnitUsd: string;
  operatorCredentialHash: string;
  accounts: AgentMeterAccount[];
  routes: AgentMeterRoute[];
};

export type AgentUsageReservation = {
  usageId: string;
  accountId: string;
  routeId: string;
  requestKey: string;
  credits: string;
  reservedAt: number;
  state: 'RESERVED' | 'CONSUMED' | 'RELEASED';
};

export type AgentCreditOperation = {
  operationId: string;
  accountId: string;
  requestKey: string;
  credits: string;
  reference: string | null;
  creditedAt: number;
};

type AgentMeterAccountState = { accountId: string; provisionedCredits: string; remainingCredits: string; status: AgentMeterAccount['status'] };

export type AgentMeterStore = {
  provisionAgentMeterAccount: (input: AgentMeterAccount) => Promise<void>;
  createAgentMeterAccount: (input: AgentMeterAccount) => Promise<boolean>;
  findAgentMeterAccountByCredentialHash: (credentialHash: string) => Promise<AgentMeterAccount | null>;
  getAgentMeterAccount: (accountId: string) => Promise<AgentMeterAccountState | null | undefined>;
  creditAgentMeterAccount: (input: AgentCreditOperation) => Promise<{ replay: boolean; operation: AgentCreditOperation; account: AgentMeterAccountState } | null | undefined>;
  revokeAgentMeterAccount: (accountId: string) => Promise<AgentMeterAccountState | null | undefined>;
  listAgentMeterUsage: (accountId: string, limit: number) => Promise<AgentUsageReservation[]>;
  reserveAgentUsage: (input: Omit<AgentUsageReservation, 'usageId' | 'state'>) => Promise<{ kind: 'reserved'; reservation: AgentUsageReservation } | { kind: 'replayed'; reservation: AgentUsageReservation } | { kind: 'insufficient' }>;
  settleAgentUsage: (usageId: string, outcome: 'CONSUMED' | 'RELEASED') => Promise<AgentUsageReservation | null>;
};

export type AgentMeter = {
  authorize: (input: { method: string | undefined; pathname: string; credential: string | undefined; requestKey: string | undefined; now: number }) => Promise<{ accountId: string; reservation: AgentUsageReservation } | null>;
  settle: (reservation: AgentUsageReservation, outcome: 'CONSUMED' | 'RELEASED') => Promise<AgentUsageReservation | null>;
  routes: AgentMeterRoute[];
  config: Pick<AgentMeterConfig, 'creditUnitUsd'>;
  operator: {
    authenticate: (credential: string | undefined) => boolean;
    issue: (input: { operatorCredential: string | undefined; accountId: string; provisionedCredits: string }) => Promise<{ account: AgentMeterAccountState; credential: string }>;
    credit: (input: { operatorCredential: string | undefined; accountId: string; credits: string; requestKey: string | undefined; reference: string | null; now: number }) => Promise<{ replay: boolean; operation: AgentCreditOperation; account: AgentMeterAccountState }>;
    revoke: (input: { operatorCredential: string | undefined; accountId: string }) => Promise<AgentMeterAccountState>;
  };
  inspect: (credential: string | undefined) => Promise<AgentMeterAccountState>;
  usage: (credential: string | undefined, limit: number) => Promise<AgentUsageReservation[]>;
};

/**
 * Parses the operator-managed, payment-rail-neutral entitlement definition.
 * Credentials are supplied only as SHA-256 digests; the raw agent secret never
 * enters configuration, logs, or the usage ledger.
 */
export function parseAgentMeterConfig(value: unknown): AgentMeterConfig | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const root = record(value, 'PRIORSEAL_AGENT_METER_JSON');
  exactKeys(root, ['accounts', 'creditUnitUsd', 'operatorCredentialHash', 'routes', 'schema'], 'PRIORSEAL_AGENT_METER_JSON');
  if (typeof root.creditUnitUsd !== 'string' || !positiveUsd(root.creditUnitUsd)) throw new TypeError('PRIORSEAL_AGENT_METER_JSON has an invalid shape');
  const creditUnitUsd = root.creditUnitUsd;
  if (root.schema !== 'priorseal.agent-meter.v1' || typeof root.operatorCredentialHash !== 'string' || !SHA256.test(root.operatorCredentialHash) || !Array.isArray(root.accounts) || !Array.isArray(root.routes) || root.accounts.length > 1_000 || root.routes.length > 64) throw new TypeError('PRIORSEAL_AGENT_METER_JSON has an invalid shape');
  const accountIds = new Set<string>(), credentialHashes = new Set<string>(), routeIds = new Set<string>();
  const accounts = root.accounts.map((entry, index) => {
    const item = record(entry, `agent meter account ${index}`); exactKeys(item, ['accountId', 'credentialHash', 'provisionedCredits', 'status'], `agent meter account ${index}`);
    if (typeof item.accountId !== 'string' || !IDENTIFIER.test(item.accountId) || accountIds.has(item.accountId)) throw new TypeError(`agent meter account ${index} has an invalid or duplicate accountId`);
    if (typeof item.credentialHash !== 'string' || !SHA256.test(item.credentialHash) || credentialHashes.has(item.credentialHash)) throw new TypeError(`agent meter account ${index} has an invalid or duplicate credentialHash`);
    if (typeof item.provisionedCredits !== 'string' || !positiveUint(item.provisionedCredits)) throw new TypeError(`agent meter account ${index} has an invalid provisionedCredits`);
    if (item.status !== 'active' && item.status !== 'revoked') throw new TypeError(`agent meter account ${index} has an invalid status`);
    accountIds.add(item.accountId); credentialHashes.add(item.credentialHash);
    return { accountId: item.accountId, credentialHash: item.credentialHash, provisionedCredits: item.provisionedCredits, status: item.status as AgentMeterAccount['status'] };
  });
  const routes = root.routes.map((entry, index) => {
    const item = record(entry, `agent meter route ${index}`); exactKeys(item, ['credits', 'method', 'path', 'routeId'], `agent meter route ${index}`);
    if (typeof item.routeId !== 'string' || !IDENTIFIER.test(item.routeId) || routeIds.has(item.routeId)) throw new TypeError(`agent meter route ${index} has an invalid or duplicate routeId`);
    if ((item.method !== 'GET' && item.method !== 'POST') || typeof item.path !== 'string' || !validRoutePath(item.path) || typeof item.credits !== 'string' || !positiveUint(item.credits)) throw new TypeError(`agent meter route ${index} is invalid`);
    routeIds.add(item.routeId);
    return { routeId: item.routeId, method: item.method as AgentMeterRoute['method'], path: item.path, credits: item.credits, priceUsd: creditPriceUsd(creditUnitUsd, item.credits) };
  });
  return { schema: 'priorseal.agent-meter.v1', creditUnitUsd, operatorCredentialHash: root.operatorCredentialHash, accounts, routes };
}

/** Hash an agent secret before adding it to the operator secret configuration. */
export function agentCredentialHash(secret: string): string {
  if (typeof secret !== 'string' || secret.length < 24 || secret.length > 4_096) throw new TypeError('Agent credential must contain 24 to 4096 characters');
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function credentialDigestOrNull(secret: string | undefined): string | null {
  try { return secret ? agentCredentialHash(secret) : null; } catch { return null; }
}

export function createAgentMeter(config: AgentMeterConfig | undefined, store: AgentMeterStore): AgentMeter | null {
  if (!config) return null;
  if (!store) throw new TypeError('Agent metering requires a durable store');
  const byCredentialHash = new Map(config.accounts.map(account => [account.credentialHash, account]));
  const accountFor = async (credential: string | undefined) => {
    if (!credential) throw commercialError('AGENT_CREDENTIAL_INVALID', 'The Agent service credential is invalid or revoked');
    const digest = credentialDigestOrNull(credential);
    if (!digest) throw commercialError('AGENT_CREDENTIAL_INVALID', 'The Agent service credential is invalid or revoked');
    const configured = byCredentialHash.get(digest);
    if (configured) {
      // Configuration is bootstrap-only. Once persisted, lifecycle actions such
      // as revocation must not be overwritten by a subsequent request.
      await store.provisionAgentMeterAccount(configured);
      const state = await store.getAgentMeterAccount(configured.accountId);
      return state ? { ...configured, status: state.status } : configured;
    }
    return store.findAgentMeterAccountByCredentialHash(digest);
  };
  const requireOperator = (credential: string | undefined) => {
    const digest = credentialDigestOrNull(credential);
    if (!digest || !timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(config.operatorCredentialHash, 'hex'))) throw commercialError('AGENT_OPERATOR_CREDENTIAL_INVALID', 'The operator credential is invalid');
  };
  const requireAccount = async (credential: string | undefined) => {
    const account = await accountFor(credential);
    if (!account || account.status !== 'active') throw commercialError('AGENT_CREDENTIAL_INVALID', 'The Agent service credential is invalid or revoked');
    return account;
  };
  return {
    config: { creditUnitUsd: config.creditUnitUsd },
    routes: config.routes.map(route => ({ ...route })),
    async authorize({ method, pathname, credential, requestKey, now }) {
      const route = config.routes.find(candidate => candidate.method === method && routeMatches(candidate.path, pathname));
      if (!route) return null;
      if (!credential || !requestKey || !IDENTIFIER.test(requestKey)) throw commercialError('AGENT_CREDENTIAL_REQUIRED', 'A metered Agent call requires x-priorseal-agent-key and idempotency-key headers');
      const account = await requireAccount(credential);
      const result = await store.reserveAgentUsage({ accountId: account.accountId, routeId: route.routeId, requestKey, credits: route.credits, reservedAt: now });
      if (result.kind === 'insufficient') throw commercialError('AGENT_CREDITS_EXHAUSTED', 'The Agent service account has insufficient credits');
      return { accountId: account.accountId, reservation: result.reservation };
    },
    settle(reservation, outcome) { return store.settleAgentUsage(reservation.usageId, outcome); },
    async inspect(credential) {
      const account = await requireAccount(credential);
      const state = await store.getAgentMeterAccount(account.accountId);
      if (!state) throw commercialError('AGENT_CREDENTIAL_INVALID', 'The Agent service account is unavailable');
      return state;
    },
    async usage(credential, limit) {
      const account = await requireAccount(credential);
      return store.listAgentMeterUsage(account.accountId, limit);
    },
    operator: {
      authenticate(credential) { try { requireOperator(credential); return true; } catch { return false; } },
      async issue({ operatorCredential, accountId, provisionedCredits }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId) || !positiveUint(provisionedCredits)) throw commercialError('AGENT_ACCOUNT_INVALID', 'Invalid Agent account request');
        const credential = `psa_${randomBytes(32).toString('base64url')}`;
        const account: AgentMeterAccount = { accountId, credentialHash: agentCredentialHash(credential), provisionedCredits, status: 'active' };
        if (!await store.createAgentMeterAccount(account)) throw commercialError('AGENT_ACCOUNT_EXISTS', 'Agent service account already exists');
        const state = await store.getAgentMeterAccount(accountId);
        if (!state) throw new Error('Agent account was not provisioned');
        return { account: state, credential };
      },
      async credit({ operatorCredential, accountId, credits, requestKey, reference, now }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId) || !positiveUint(credits) || (reference !== null && (!IDENTIFIER.test(reference) || reference.length > 128))) throw commercialError('AGENT_ACCOUNT_INVALID', 'Invalid Agent credit request');
        if (!requestKey || !IDENTIFIER.test(requestKey)) throw commercialError('AGENT_IDEMPOTENCY_REQUIRED', 'An Agent credit operation requires an idempotency-key header');
        const operation: AgentCreditOperation = { operationId: `aco_${hashOperation({ accountId, requestKey }).slice(0, 32)}`, accountId, requestKey, credits, reference, creditedAt: now };
        const result = await store.creditAgentMeterAccount(operation);
        if (!result) throw commercialError('AGENT_ACCOUNT_NOT_FOUND', 'Agent service account was not found');
        return result;
      },
      async revoke({ operatorCredential, accountId }) {
        requireOperator(operatorCredential);
        if (!IDENTIFIER.test(accountId)) throw commercialError('AGENT_ACCOUNT_INVALID', 'Invalid Agent account identifier');
        const state = await store.revokeAgentMeterAccount(accountId);
        if (!state) throw commercialError('AGENT_ACCOUNT_NOT_FOUND', 'Agent service account was not found');
        return state;
      },
    },
  };
}

function routeMatches(pattern: string, pathname: string): boolean {
  const expected = pattern.split('/'), actual = pathname.split('/');
  return expected.length === actual.length && expected.every((part, index) => part.startsWith(':') ? actual[index].length > 0 : part === actual[index]);
}
function validRoutePath(path: string) { return path.startsWith('/') && !path.includes('//') && path.split('/').slice(1).every(segment => IDENTIFIER.test(segment) || /^:[A-Za-z][A-Za-z0-9]*$/.test(segment)); }
function positiveUint(value: string) { return /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 9_007_199_254_740_991n; }
function positiveUsd(value: string) { return /^(?:0|[1-9][0-9]{0,4})\.[0-9]{1,6}$/.test(value) && BigInt(value.replace('.', '')) > 0n; }
function creditPriceUsd(unit: string, credits: string) {
  const [whole, fraction] = unit.split('.');
  const scale = fraction.length;
  const amount = (BigInt(`${whole}${fraction}`) * BigInt(credits)).toString().padStart(scale + 1, '0');
  const decimals = amount.slice(-scale).replace(/0+$/, '');
  return decimals ? `${amount.slice(0, -scale)}.${decimals}` : amount.slice(0, -scale);
}
function hashOperation(value: unknown) { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, keys: string[], label: string) { if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw new TypeError(`${label} has unknown or missing fields`); }
function commercialError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
