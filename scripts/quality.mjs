import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
function walk(directory) { for (const entry of readdirSync(directory)) { if (['node_modules', 'dist', '.git'].includes(entry)) continue; const path = join(directory, entry); if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.mjs')) files.push(path); } }
function run(command, args) { execFileSync(command, args, { stdio: 'inherit' }); }
for (const directory of ['src', 'test', 'examples']) walk(directory);
const mode = process.argv[2];
if (mode === 'lint') { for (const file of files) run(process.execPath, ['--check', file]); process.exit(0); }
if (mode === 'format') { run('git', ['diff', '--check']); process.exit(0); }
if (mode === 'typecheck') { run('./node_modules/.bin/tsc', ['-p', 'sdk/tsconfig.json', '--pretty', 'false']); run('./node_modules/.bin/tsc', ['-b', 'web/tsconfig.json', '--pretty', 'false']); process.exit(0); }
throw new Error('Usage: node scripts/quality.mjs <lint|format|typecheck>');
