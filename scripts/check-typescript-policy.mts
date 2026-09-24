import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const errors: string[] = [];

const reviewedJavaScriptTools = new Set<string>();

// build-core.mts emits this byte-stable shim for published WAK README commands.
const generatedCompatibilityLaunchers = new Set([
  'scripts/package-web3-agent-kit-integration-spike-v1.py',
]);

// Each exception has a checked TypeScript source. Null is the pinned third-party file.
const reviewedPortableJavaScript = new Map<string, string | null>([
  ['examples/402signal-eip3009-settlement-binding-v1/vendor/route-guard-v0.7.3.mjs', null],
  ['examples/402signal-eip3009-settlement-binding-v1/verify.mjs', 'examples/402signal-eip3009-settlement-binding-v1/src/verify-source.mts'],
  ['examples/boundaryattest-paired-v0.2/jcs.mjs', 'examples/boundaryattest-paired-v0.2/jcs.reference.mts'],
  ['examples/boundaryattest-paired-v0.2/verify.mjs', 'examples/boundaryattest-paired-v0.2/verify.reference.mts'],
  ['examples/insight-boundaryattest-three-object-v0.2/verify.mjs', 'examples/insight-boundaryattest-three-object-v0.2/verify.reference.mts'],
  ['examples/thoughtproof-sentinel-paired-v1/verify.mjs', 'examples/thoughtproof-sentinel-paired-v1/verify.reference.mts'],
  ['examples/thoughtproof-sentinel-paired-v2/verify.mjs', 'examples/thoughtproof-sentinel-paired-v2/verify.reference.mts'],
  ['examples/thoughtproof-sentinel-paired-v2-final/verify.mjs', 'examples/thoughtproof-sentinel-paired-v2-final/verify.reference.mts'],
  ['examples/web3-agent-kit-base-swap-v1/verify.mjs', 'examples/web3-agent-kit-base-swap-v1/verify.reference.mts'],
  ['examples/web3-agent-kit-integration-spike-v1/verify.mjs', 'examples/web3-agent-kit-integration-spike-v1/verify.source.reference.mts'],
  ['examples/web3-agent-kit-integration-spike-v1/verify.source.mjs', 'examples/web3-agent-kit-integration-spike-v1/verify.source.reference.mts'],
  ['examples/web3-agent-kit-integration-spike-v1.0.1/verify.mjs', 'examples/web3-agent-kit-integration-spike-v1.0.1/verify.source.mts'],
]);

const reviewedLegacyJavaScriptTests = new Set<string>();

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
    if (path.endsWith('.py') && !generatedCompatibilityLaunchers.has(label(path))) {
      errors.push(`${label(path)}: new maintenance code must use .mts`);
    }
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
  [generatedCompatibilityLaunchers, 'generated compatibility launcher'],
  [reviewedPortableJavaScript, 'portable example'],
  [reviewedLegacyJavaScriptTests, 'legacy test'],
] as const) {
  for (const exception of reviewed.keys()) {
    const path = join(projectRoot, exception);
    if (!existsSync(path)) errors.push(`${exception}: reviewed ${description} exception no longer exists`);
    else if (path.endsWith('.mjs') && existsSync(path.replace(/\.mjs$/, '.mts'))) {
      errors.push(`${exception}: remove stale JavaScript ${description} exception after TypeScript migration`);
    }
  }
}

for (const [runtime, source] of reviewedPortableJavaScript) {
  if (source !== null && !existsSync(join(projectRoot, source))) {
    errors.push(`${runtime}: reviewed TypeScript source ${source} is missing`);
  }
}

// Generated worker-configuration.d.ts is checked by Wrangler; authored
// TypeScript must keep its untrusted boundaries explicit instead of using any.
for (const directory of ['src', 'sdk/src', 'web/src', 'scripts', 'sdk/scripts', 'examples', 'test']) {
  for (const path of files(join(projectRoot, directory))) {
    if (!/\.(?:ts|tsx|mts)$/.test(path)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node): void {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        errors.push(`${label(path)}:${line + 1}: authored TypeScript must not use explicit any`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
