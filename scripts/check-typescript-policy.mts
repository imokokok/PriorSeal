import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const errors: string[] = [];

const reviewedJavaScriptTools = new Set([
  'scripts/build-core.mjs',
  'scripts/build-web3-agent-kit-integration-spike-v1.mjs',
  'scripts/generate-insight-boundaryattest-three-object-vectors.mjs',
  'scripts/generate-interai-track1-preflight-candidate.mjs',
  'scripts/generate-thoughtproof-sentinel-m2-final-pairs.mjs',
  'scripts/generate-thoughtproof-sentinel-m2-vectors.mjs',
  'scripts/generate-thoughtproof-sentinel-paired-vectors.mjs',
  'scripts/generate-web3-agent-kit-base-swap-v2-vectors.mjs',
  'scripts/generate-web3-agent-kit-base-swap-vectors.mjs',
  'scripts/generate-web3-agent-kit-integration-spike-v1.mjs',
]);

const reviewedPortableJavaScript = new Set([
  'examples/402signal-eip3009-settlement-binding-v1/scripts/build.mjs',
  'examples/402signal-eip3009-settlement-binding-v1/scripts/generate-signed-fixtures.mjs',
  'examples/402signal-eip3009-settlement-binding-v1/scripts/import-route-fixture.mjs',
  'examples/402signal-eip3009-settlement-binding-v1/src/verify-source.mjs',
  'examples/402signal-eip3009-settlement-binding-v1/vendor/route-guard-v0.7.3.mjs',
  'examples/402signal-eip3009-settlement-binding-v1/verify.mjs',
  'examples/aps-priorseal-decision-binding-v1/adapter.mjs',
  'examples/aps-priorseal-decision-binding-v1/adapter.test.mjs',
  'examples/aps-priorseal-decision-binding-v1/aps-inputs/verify-from-package-root.mjs',
  'examples/aps-priorseal-decision-binding-v1/generate-priorseal.mjs',
  'examples/aps-priorseal-decision-binding-v1/trust.mjs',
  'examples/aps-priorseal-decision-binding-v1/verify.mjs',
  'examples/boundaryattest-paired-v0.2/jcs.mjs',
  'examples/boundaryattest-paired-v0.2/verify.mjs',
  'examples/create-signed-receipt.mjs',
  'examples/headless-market-state-pair-v1/verify.mjs',
  'examples/insight-boundaryattest-three-object-v0.2/jcs.mjs',
  'examples/insight-boundaryattest-three-object-v0.2/verify.mjs',
  'examples/rwa-v1/verify.mjs',
  'examples/rwa-v2/verify.mjs',
  'examples/thoughtproof-sentinel-paired-v1/verify.mjs',
  'examples/thoughtproof-sentinel-paired-v2/verify.mjs',
  'examples/thoughtproof-sentinel-paired-v2-final/verify.mjs',
  'examples/verify-signed-receipt.mjs',
  'examples/web3-agent-kit-base-sepolia-live-v1/verify.mjs',
  'examples/web3-agent-kit-base-swap-v1/verify.mjs',
  'examples/web3-agent-kit-base-swap-v2/verify.mjs',
  'examples/web3-agent-kit-context-binding-v1/verify.mjs',
  'examples/web3-agent-kit-integration-spike-v1/verify.mjs',
  'examples/web3-agent-kit-integration-spike-v1/verify.source.mjs',
  'examples/web3-agent-kit-integration-spike-v1.0.1/verify.mjs',
  'examples/web3-agent-kit-integration-spike-v1.0.1/verify.source.mjs',
]);

const reviewedLegacyJavaScriptTests = new Set([
  'test/bootstrap/cloudflare-bindings.test.mjs',
  'test/bootstrap/production-schema.test.mjs',
  'test/examples/402signal-eip3009-settlement-binding.test.mjs',
  'test/interfaces/http-server.test.mjs',
  'test/sdk/boundaryattest-paired.test.mjs',
  'test/sdk/headless-market-state.test.mjs',
  'test/sdk/insight-boundaryattest-three-object.test.mjs',
  'test/sdk/insight-protocol-trust.test.mjs',
  'test/sdk/review-manifest-joint.test.mjs',
  'test/sdk/rwa-golden.test.mjs',
  'test/sdk/rwa-hardening.test.mjs',
  'test/sdk/rwa-production-gates.test.mjs',
  'test/sdk/rwa-receipt.test.mjs',
  'test/sdk/rwa-source-lock.test.mjs',
  'test/sdk/thoughtproof-sentinel-m2-final-paired.test.mjs',
  'test/sdk/thoughtproof-sentinel-m2-paired.test.mjs',
  'test/sdk/thoughtproof-sentinel-paired.test.mjs',
  'test/sdk/web3-agent-kit-base-swap.test.mjs',
  'test/sdk/web3-agent-kit-integration-spike.test.mjs',
]);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ['node_modules', 'dist', '.git'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function label(path: string): string {
  return relative(projectRoot, path).split(sep).join('/');
}

for (const directory of ['sdk/src', 'web/src']) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|mjs|cjs)$/.test(path)) errors.push(`${label(path)}: production source must be TypeScript`);
  }
}

for (const path of files(join(projectRoot, 'src'))) {
  if (!path.endsWith('.mjs')) continue;
  const source = path === join(projectRoot, 'src', 'domain', 'rfc3161.mjs')
    ? path.replace(/rfc3161\.mjs$/, 'rfc3161-source.mts')
    : path.replace(/\.mjs$/, '.mts');
  if (!existsSync(source)) errors.push(`${label(path)}: runtime JavaScript has no TypeScript source`);
}

for (const directory of ['scripts', 'sdk/scripts']) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|cjs)$/.test(path)) errors.push(`${label(path)}: new maintenance code must use .mts`);
    if (!path.endsWith('.mjs')) continue;
    const source = path.replace(/\.mjs$/, '.mts');
    if (!existsSync(source) && !reviewedJavaScriptTools.has(label(path))) {
      errors.push(`${label(path)}: new operational scripts must use a checked TypeScript source`);
    }
  }
}

for (const [directory, reviewed, description] of [
  ['examples', reviewedPortableJavaScript, 'portable example'],
  ['test', reviewedLegacyJavaScriptTests, 'legacy test'],
] as const) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|cjs)$/.test(path)) errors.push(`${label(path)}: new ${description} code must use TypeScript`);
    if (!path.endsWith('.mjs') || existsSync(path.replace(/\.mjs$/, '.mts'))) continue;
    if (!reviewed.has(label(path))) errors.push(`${label(path)}: JavaScript ${description} is not a reviewed exception`);
  }
}

for (const [reviewed, description] of [
  [reviewedJavaScriptTools, 'tool'],
  [reviewedPortableJavaScript, 'portable example'],
  [reviewedLegacyJavaScriptTests, 'legacy test'],
] as const) {
  for (const exception of reviewed) {
    const path = join(projectRoot, exception);
    if (!existsSync(path)) errors.push(`${exception}: reviewed JavaScript ${description} no longer exists`);
    else if (existsSync(path.replace(/\.mjs$/, '.mts'))) errors.push(`${exception}: remove stale JavaScript ${description} exception after TypeScript migration`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
