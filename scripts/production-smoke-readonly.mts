import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { hashJson } from '../src/domain/hashing.mjs';

type GetOptions = { token?: string; statuses?: number[]; text?: boolean };
type SmokeOptions = { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; log?: (message: string) => void };
type ArchiveCredential = { token: string; projectId: string; environment: string; role: string };
type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, label: string): JsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return value as JsonObject;
}
function optionalRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}
function string(value: unknown, label: string): string {
  assert(typeof value === 'string', `${label} must be a string`);
  return value;
}
function credential(value: unknown): ArchiveCredential {
  const item = record(value, 'Archive smoke credential');
  const token = string(item.token, 'Archive smoke token');
  const projectId = string(item.projectId, 'Archive smoke projectId');
  const environment = string(item.environment, 'Archive smoke environment');
  const role = string(item.role, 'Archive smoke role');
  assert(/^[A-Za-z0-9._~-]{32,256}$/.test(token) && ['writer', 'reviewer'].includes(role), 'An archive smoke credential has an invalid token or expected scope');
  return { token, projectId, environment, role };
}
const exactCallProfile = 'priorseal.execution-profile.exact-call.v1';

/** Only GET requests are issued. Credentials and returned evidence are never logged. */
export async function runReadOnlySmoke({ env = process.env, fetcher = fetch, log = console.log }: SmokeOptions = {}) {
  const baseUrl = new URL(env.PRIORSEAL_BASE_URL ?? 'https://priorseal.xyz');
  assert(!baseUrl.username && !baseUrl.password, 'The base URL must not contain credentials');
  assert(baseUrl.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'Use HTTPS outside local development');
  const expectedVersion = env.PRIORSEAL_EXPECTED_VERSION?.trim();
  assert(/^[0-9a-f]{40}$/.test(expectedVersion ?? ''), 'PRIORSEAL_EXPECTED_VERSION must be the exact 40-character release Git SHA');
  const expectedAudience = env.PRIORSEAL_EXPECTED_AUDIENCE ?? 'priorseal.xyz';
  const expectedIssuer = env.PRIORSEAL_EXPECTED_ISSUER ?? 'priorseal.xyz';
  const requiredChains = (env.PRIORSEAL_EXPECTED_CHAINS ?? '1,8453,42161').split(',').filter(Boolean).map(Number);
  assert(requiredChains.length && requiredChains.every((chain) => Number.isSafeInteger(chain) && chain > 0), 'PRIORSEAL_EXPECTED_CHAINS must contain positive chain IDs');
  const requireArchive = env.PRIORSEAL_REQUIRE_ARCHIVE === '1';
  const expectedProofMode = env.PRIORSEAL_EXPECTED_PROOF_MODE ?? 'rfc3161';
  let getCount = 0;

  async function get(path: string, { token, statuses = [200], text = false }: GetOptions = {}): Promise<{ response: Response; body: unknown }> {
    const url = new URL(path, baseUrl);
    assert(url.origin === baseUrl.origin, 'Refusing to send a smoke request or credential to another origin');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      getCount += 1;
      const response = await fetcher(url, { method: 'GET', headers: { Accept: text ? 'text/html, application/javascript' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
        const header = response.headers.get('retry-after');
        const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : (attempt + 1) * 1000;
        assert(delay <= 60_000, `GET ${url.pathname} requested a retry delay longer than one minute`);
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, Math.max(1000, delay)));
        continue;
      }
      assert(statuses.includes(response.status), `GET ${url.pathname} returned HTTP ${response.status}; expected ${statuses.join('/')}`);
      const body: unknown = text ? await response.text() : await response.json();
      return { response, body };
    }
    throw new Error(`GET ${url.pathname} did not complete`);
  }

  const live = record((await get('/health/live')).body, 'Liveness response');
  const ready = record((await get('/health/ready')).body, 'Readiness response');
  const versionResponse = await get('/v1/version');
  const version = record(versionResponse.body, 'Version response');
  const registry = record((await get('/.well-known/priorseal-keys.json')).body, 'Key registry');
  const capabilities = record((await get('/v1/capabilities')).body, 'Capabilities response');
  assert(live.status === 'ok', 'Liveness check failed');
  assert(ready.status === 'ready' && ready.storage === 'd1', 'D1 readiness check failed');
  assert(version.service === 'priorseal' && version.version === expectedVersion, 'Production version does not match the exact requested SHA');
  assert(!versionResponse.response.headers.has('x-render-origin-server') && !versionResponse.response.headers.has('rndr-id'), 'A request reached the previous origin');
  assert(registry.issuer === expectedIssuer && Array.isArray(registry.keys) && registry.keys.some((key) => optionalRecord(key)?.issuer === expectedIssuer && optionalRecord(key)?.status === 'active'), 'Expected issuer has no published active key');
  assert(capabilities.schema === 'priorseal.capabilities.v1', 'Capabilities schema is unavailable');
  assert(capabilities.issuer === expectedIssuer && capabilities.audience === expectedAudience, 'Capabilities issuer or audience does not match the deployment');
  assert(Array.isArray(capabilities.executionProfiles) && capabilities.executionProfiles.includes(exactCallProfile), 'The deployed policy does not expose exact-call authorization');
  assert(Array.isArray(capabilities.authorizers) && capabilities.authorizers.includes('eip712'), 'The deployment does not expose EIP-712 authorization');
  assert(capabilities.proofMode === expectedProofMode, 'Unexpected pre-execution proof mode');
  const dependencies = optionalRecord(capabilities.dependencies);
  assert(capabilities.workflowReady === true && dependencies?.issuer === 'configured' && dependencies.storage === 'available', 'Required workflow configuration or storage is unavailable');
  for (const chainId of requiredChains) assert(Array.isArray(capabilities.chains) && capabilities.chains.includes(chainId) && Array.isArray(capabilities.chainReadiness) && capabilities.chainReadiness.some((entry) => optionalRecord(entry)?.chainId === chainId && optionalRecord(entry)?.rpc === 'configured'), `Required chain eip155:${chainId} is not configured`);
  if (env.PRIORSEAL_EXPECTED_POLICY_FILE) assert(capabilities.policyHash === `0x${hashJson(JSON.parse(await readFile(env.PRIORSEAL_EXPECTED_POLICY_FILE, 'utf8')) as unknown)}`, 'Deployed policy hash does not match the reviewed policy file');

  const htmlPath = env.PRIORSEAL_EXPECTED_HTML_FILE ?? fileURLToPath(new URL('../web/dist/index.html', import.meta.url));
  const localHtml = await readFile(htmlPath, 'utf8');
  const entry = localHtml.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/i)?.[1];
  if (!entry?.startsWith('/assets/') || !entry.endsWith('.js')) throw new Error('Build the current console before checking its deployed asset identity');
  const pagePaths = ['/', '/app', '/app/intents/exact-call', '/app/verify', '/app/archive', '/app/quickstart'];
  for (const path of pagePaths) {
    const page = await get(path, { text: true });
    assert(typeof page.body === 'string' && /text\/html/i.test(page.response.headers.get('content-type') ?? '') && /PriorSeal/i.test(page.body) && page.body.includes(entry), `Static page ${path} does not reference the current build`);
  }
  const javascript = await get(entry, { text: true });
  assert(typeof javascript.body === 'string' && /(?:javascript|ecmascript)/i.test(javascript.response.headers.get('content-type') ?? '') && !/^\s*<!doctype/i.test(javascript.body), 'The current JavaScript asset is not being served correctly');
  const routeAssets = (await readdir(join(dirname(htmlPath), 'assets'))).filter((name) => /^(?:App|ExactCallPage|ArchivePage|VerifyPage|OnboardingPage)-[^/]+\.js$/.test(name));
  assert(['App-', 'ExactCallPage-', 'ArchivePage-', 'VerifyPage-', 'OnboardingPage-'].every((prefix) => routeAssets.some((name) => name.startsWith(prefix))), 'The local release build is missing a required console route chunk');
  for (const name of routeAssets) {
    const asset = await get(`/assets/${name}`, { text: true });
    assert(typeof asset.body === 'string' && /(?:javascript|ecmascript)/i.test(asset.response.headers.get('content-type') ?? '') && asset.body === await readFile(join(dirname(htmlPath), 'assets', name), 'utf8'), `Deployed route asset ${name} does not match the current release build`);
  }
  const archive = optionalRecord(capabilities.archive);
  const unauthenticated = await get('/v1/archive?limit=1', { statuses: archive?.enabled === true ? [401] : [404] });
  assert(/no-store/i.test(unauthenticated.response.headers.get('cache-control') ?? ''), 'Archive authentication responses must not be cached');
  assert(!requireArchive || archive?.enabled === true, 'The private project archive has not been enabled');

  const archiveChecks = [];
  const scopedSamples = [];
  if (env.PRIORSEAL_ARCHIVE_SMOKE_CREDENTIALS_FILE) {
    const info = await stat(env.PRIORSEAL_ARCHIVE_SMOKE_CREDENTIALS_FILE);
    assert(info.isFile() && !(info.mode & 0o077) && info.size <= 64 * 1024, 'Archive smoke credentials must be a private file of at most 64 KiB (mode 0600)');
    const secret = record(JSON.parse(await readFile(env.PRIORSEAL_ARCHIVE_SMOKE_CREDENTIALS_FILE, 'utf8')) as unknown, 'Archive smoke credentials');
    assert(Array.isArray(secret.credentials) && secret.credentials.length > 0 && secret.credentials.length <= 8, 'Archive smoke credentials must contain one to eight scoped credentials');
    const credentials = secret.credentials.map(credential);
    for (const credential of credentials) {
      const listed = await get('/v1/archive?limit=1', { token: credential.token });
      const exported = await get('/v1/archive/export?limit=1', { token: credential.token });
      for (const checked of [listed, exported]) {
        const page = record(checked.body, 'Archive page');
        assert(page.schema === 'priorseal.archive-page.v1' && page.projectId === credential.projectId && page.environment === credential.environment && page.role === credential.role, 'Archive read did not match the credential scope');
        assert(page.scope === 'uploaded_evidence' && page.retention === 'until_operator_deletion', 'Production archive must report durable uploaded-evidence scope');
        assert(Array.isArray(page.items) && Number.isSafeInteger(page.snapshot), 'Archive page or stable snapshot is missing');
        assert(/private/i.test(checked.response.headers.get('cache-control') ?? '') && /no-store/i.test(checked.response.headers.get('cache-control') ?? ''), 'Authenticated archive reads must be private and non-cacheable');
      }
      const exportPage = record(exported.body, 'Archive export');
      assert(Array.isArray(exportPage.items), 'Archive export items are missing');
      const sample = exportPage.items[0] === undefined ? null : record(exportPage.items[0], 'Archive artifact');
      if (sample) {
        assert(sample.artifact && sample.verification === 'NOT_VERIFIED_BY_ARCHIVE' && sample.artifactHash === hashJson(sample.artifact), 'Archive export artifact hash or verification boundary is inconsistent');
        const id = string(sample.id, 'Archive artifact id');
        const retrieved = record((await get(`/v1/archive/${encodeURIComponent(id)}`, { token: credential.token })).body, 'Archive artifact retrieval');
        assert(retrieved.artifactHash === sample.artifactHash && hashJson(retrieved.artifact) === sample.artifactHash, 'Archive artifact retrieval does not match its exported hash');
        scopedSamples.push({ credential, id });
      }
      archiveChecks.push({ projectId: credential.projectId, environment: credential.environment, role: credential.role, list: 'PASSED', export: 'PASSED', existingArtifactHash: sample ? 'PASSED' : 'NO_EXISTING_ARTIFACT', writePermissions: 'NOT_TESTED_READ_ONLY' });
    }
    for (const sample of scopedSamples) {
      const other = credentials.find((credential) => credential.projectId !== sample.credential.projectId || credential.environment !== sample.credential.environment);
      if (!other) continue;
      await get(`/v1/archive/${encodeURIComponent(sample.id)}`, { token: other.token, statuses: [404] });
      archiveChecks.push({ crossProjectExistingArtifactRead: 'DENIED' });
    }
  } else assert(!requireArchive, 'Archive is required but no private smoke credentials file was provided');

  const result = { ok: true, mode: 'READ_ONLY_GET', baseUrl: baseUrl.origin, version: version.version, audience: capabilities.audience, policyHash: capabilities.policyHash, exactCall: true, configuredChains: requiredChains, proofMode: capabilities.proofMode, capabilityScope: 'CONFIGURATION_AND_STORAGE_ONLY_NOT_LIVE_RPC_OR_TSA_PROOF', staticPages: pagePaths, currentEntryAsset: entry, verifiedRouteAssets: routeAssets, archiveEnabled: archive?.enabled === true, archiveChecks, getRequests: getCount, writesPerformed: 0, walletOrTransactionSignatures: 0 };
  log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runReadOnlySmoke();
