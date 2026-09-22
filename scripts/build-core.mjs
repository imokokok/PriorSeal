import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const check = process.argv[2] === '--check';
if (!check && process.argv.length !== 2) throw new Error('Usage: node scripts/build-core.mjs [--check]');

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

function findSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findSources(path);
    return entry.isFile() && entry.name.endsWith('.mts') && !entry.name.endsWith('.d.mts') ? [path] : [];
  });
}

const sources = findSources(sourceRoot).sort();
if (sources.length === 0) throw new Error('No TypeScript core sources found in src/');

for (const sourcePath of sources) {
  const outputPath = sourcePath.replace(/\.mts$/, '.mjs');
  const outputLabel = `src/${relative(sourceRoot, outputPath).split(sep).join('/')}`;
  const name = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1, -4);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  const output = `// Generated from ${name}.mts by npm run core:build. Do not edit directly.\n${compiled}`;

  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
      console.error(`${outputLabel} is missing or stale; run npm run core:build`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(outputPath, output);
  }
}
