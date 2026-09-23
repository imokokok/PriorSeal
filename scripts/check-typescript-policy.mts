import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const errors: string[] = [];

const reviewedJavaScriptTools = new Set([
  'build-core.mjs',
  'build-web3-agent-kit-integration-spike-v1.mjs',
  'check-web-performance.mjs',
  'compile-contracts.mjs',
  'generate-insight-boundaryattest-three-object-vectors.mjs',
  'generate-interai-track1-preflight-candidate.mjs',
  'generate-thoughtproof-sentinel-m2-final-pairs.mjs',
  'generate-thoughtproof-sentinel-m2-vectors.mjs',
  'generate-thoughtproof-sentinel-paired-vectors.mjs',
  'generate-web3-agent-kit-base-swap-v2-vectors.mjs',
  'generate-web3-agent-kit-base-swap-vectors.mjs',
  'generate-web3-agent-kit-integration-spike-v1.mjs',
  'preview-web.mjs',
  'quality.mjs',
]);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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

for (const path of files(join(projectRoot, 'scripts'))) {
  if (/\.(?:js|jsx|cjs)$/.test(path)) errors.push(`${label(path)}: new maintenance code must use .mts`);
  if (!path.endsWith('.mjs')) continue;
  const source = path.replace(/\.mjs$/, '.mts');
  const scriptPath = relative(join(projectRoot, 'scripts'), path).split(sep).join('/');
  if (!existsSync(source) && !reviewedJavaScriptTools.has(scriptPath)) {
    errors.push(`${label(path)}: new operational scripts must use a checked TypeScript source`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
