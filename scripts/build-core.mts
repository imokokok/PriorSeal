import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const check = process.argv[2] === '--check';
if (!check && process.argv.length !== 2) throw new Error('Usage: node scripts/build-core.mjs [--check]');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = join(projectRoot, 'src');
// These published fixture runtimes are content-addressed evidence. Keep their
// original bytes pinned while compiling the TypeScript sources to separate
// .reference.mjs entry points for maintained examples and tests.
const frozenExamples = new Map<string, string>([
  ['examples/boundaryattest-paired-v0.2/jcs.reference.mts', '4760729fce5f5d7ddabb6b5e1f2c6818abe4e9fa5b48cfcecc18fa57433262cd'],
  ['examples/boundaryattest-paired-v0.2/verify.reference.mts', '2325c0e4e50f2ab91431d095b817d4a68fd6022a9a0a1a19609a00f93d1b67f4'],
  ['examples/insight-boundaryattest-three-object-v0.2/verify.reference.mts', '910c319837899d8646cd339c3f529e424568b518fad75af3863b55f8b5cf16aa'],
  ['examples/thoughtproof-sentinel-paired-v1/verify.reference.mts', '074ff61b3127da51eb59c67fdb6bf0d02730ffcdc4eef4d4ad9864f192334c12'],
  ['examples/thoughtproof-sentinel-paired-v2/verify.reference.mts', '749921c3436a498cf931071ff650d19e8f08470206ebf7a156fbc3a400693e20'],
  ['examples/thoughtproof-sentinel-paired-v2-final/verify.reference.mts', '57265552ea729bea37d5c6ce2c979e2455316c2dcb5e947620a80e504c7574bb'],
  ['examples/web3-agent-kit-base-swap-v1/verify.reference.mts', '906113559b1f471dc499f205ad6c3c42351114b45e980effac48ba19a6f8e408'],
  ['examples/web3-agent-kit-integration-spike-v1/verify.source.reference.mts', 'ff4cb1f14603c46bef693c5137e38dbff5917c167c6ef4498f4f34471c886c18'],
]);
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function findSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findSources(path);
    return entry.isFile() && entry.name.endsWith('.mts') && !entry.name.endsWith('.d.mts') ? [path] : [];
  });
}

const sources = [
  ...findSources(sourceRoot),
  ...findSources(join(projectRoot, 'scripts')),
  ...findSources(join(projectRoot, 'sdk', 'scripts')),
  ...findSources(join(projectRoot, 'examples')),
  ...findSources(join(projectRoot, 'test')),
].sort();
if (sources.length === 0) throw new Error('No TypeScript runtime sources found');
for (const source of frozenExamples.keys()) {
  if (!existsSync(join(projectRoot, source))) throw new Error(`Frozen TypeScript reference is missing: ${source}`);
}

function runtimePath(sourcePath: string): string {
  // Keep the SDK's existing rfc3161.mjs import and its narrow declaration file.
  // A same-name .mts would be pulled into the SDK's separate TypeScript rootDir.
  if (sourcePath === join(sourceRoot, 'domain', 'rfc3161-source.mts')) return join(sourceRoot, 'domain', 'rfc3161.mjs');
  return sourcePath.replace(/\.mts$/, '.mjs');
}

for (const sourcePath of sources) {
  const outputPath = runtimePath(sourcePath);
  const outputLabel = relative(projectRoot, outputPath).split(sep).join('/');
  const sourceLabel = relative(projectRoot, sourcePath).split(sep).join('/');
  const frozen = frozenExamples.get(sourceLabel);
  if (sourcePath.endsWith('.reference.mts') && !frozen) throw new Error(`Unregistered frozen TypeScript reference: ${sourceLabel}`);
  if (frozen) {
    const historicalRuntimePath = sourcePath.replace(/\.reference\.mts$/, '.mjs');
    if (!existsSync(historicalRuntimePath) || sha256(historicalRuntimePath) !== frozen) {
      console.error(`${sourceLabel}: historical runtime changed; publish a new fixture version`);
      process.exitCode = 1;
    }
  }
  const name = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1, -4);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  const notice = `// Generated from ${name}.mts by npm run core:build. Do not edit directly.\n`;
  const shebangEnd = compiled.startsWith('#!') ? compiled.indexOf('\n') + 1 : 0;
  const output = shebangEnd > 0
    ? `${compiled.slice(0, shebangEnd)}${notice}${compiled.slice(shebangEnd)}`
    : `${notice}${compiled}`;

  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
      console.error(`${outputLabel} is missing or stale; run npm run core:build`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(outputPath, output);
  }
}

// Historical WAK READMEs invoke this Python filename. Its only job is to
// replace itself with the TypeScript-backed Node packager; keep it generated.
const compatibilityLauncherPath = join(projectRoot, 'scripts', 'package-web3-agent-kit-integration-spike-v1.py');
const compatibilityLauncher = `#!/usr/bin/env python3
"""Compatibility launcher for the frozen WAK bundle documentation."""

import os
import sys
from pathlib import Path


SCRIPT = Path(__file__).with_suffix(".mjs")
os.execvp("node", ("node", str(SCRIPT), *sys.argv[1:]))
`;
if (check) {
  if (!existsSync(compatibilityLauncherPath) || readFileSync(compatibilityLauncherPath, 'utf8') !== compatibilityLauncher) {
    console.error('scripts/package-web3-agent-kit-integration-spike-v1.py is missing or stale; run npm run core:build');
    process.exitCode = 1;
  }
} else {
  writeFileSync(compatibilityLauncherPath, compatibilityLauncher);
}

if (check) {
  const outputs = new Set(sources.map(runtimePath));
  function findRuntimeFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findRuntimeFiles(path);
      return entry.isFile() && entry.name.endsWith('.mjs') ? [path] : [];
    });
  }
  for (const outputPath of findRuntimeFiles(sourceRoot)) {
    if (!outputs.has(outputPath)) {
      console.error(`src/${relative(sourceRoot, outputPath).split(sep).join('/')} has no TypeScript source`);
      process.exitCode = 1;
    }
  }
}
