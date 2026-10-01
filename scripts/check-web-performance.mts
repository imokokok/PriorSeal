import { readFile, readdir, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('../web/dist/', import.meta.url);
const assets = new URL('assets/', root);
const files = await readdir(assets);

type BudgetKind = 'raw' | 'gzip';
type BudgetLimits = Partial<Record<BudgetKind, number>>;

async function measurement(pattern: RegExp, label: string, limits: BudgetLimits) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) throw new Error(`${label}: expected one matching asset, found ${matches.length}`);
  const file = matches[0];
  const body = await readFile(new URL(`assets/${file}`, root));
  const values = { raw: body.length, gzip: gzipSync(body, { level: 9 }).length };
  const failures = (Object.entries(limits) as [BudgetKind, number][]).filter(([kind, limit]) => values[kind] > limit);
  return { label, file, ...values, failures };
}

const checks = await Promise.all([
  measurement(/^index-.*\.js$/, 'application entry', { raw: 250_000, gzip: 80_000 }),
  measurement(/^LandingPage-.*\.js$/, 'landing route', { raw: 20_000, gzip: 6_000 }),
  measurement(/^brand-.*\.js$/, 'brand shared chunk', { raw: 2_000, gzip: 1_000 }),
  measurement(/^App-.*\.js$/, 'console route', { raw: 96_000, gzip: 28_000 }),
  measurement(/^verifier-.*\.js$/, 'offline verifier', { raw: 520_000, gzip: 130_000 }),
  measurement(/^index-.*\.css$/, 'shared CSS', { raw: 40_000, gzip: 9_000 }),
  measurement(/^LandingPage-.*\.css$/, 'landing CSS', { raw: 38_000, gzip: 8_000 }),
  measurement(/^App-.*\.css$/, 'console CSS', { raw: 30_000, gzip: 6_000 }),
  measurement(/^KeysPage-.*\.css$/, 'key registry CSS', { raw: 5_000, gzip: 1_500 }),
  measurement(/^SdkPage-.*\.css$/, 'SDK page CSS', { raw: 4_500, gzip: 1_500 }),
  measurement(/^ApiReferencePage-.*\.css$/, 'API page CSS', { raw: 4_500, gzip: 1_500 }),
  measurement(/^ExactCallPage-.*\.css$/, 'exact-call CSS', { raw: 5_500, gzip: 1_700 }),
  measurement(/^ArchivePage-.*\.css$/, 'archive page CSS', { raw: 6_500, gzip: 1_900 }),
  measurement(/^PrivacyPage-.*\.css$/, 'privacy page CSS', { raw: 5_200, gzip: 1_700 }),
]);

const initial = checks.filter(({ label }) => ['application entry', 'landing route', 'brand shared chunk', 'shared CSS', 'landing CSS'].includes(label));
const fontFiles = files.filter((file) => file.endsWith('.woff2'));
const fontBytes = (await Promise.all(fontFiles.map((file) => stat(new URL(`assets/${file}`, root))))).reduce((total, item) => total + item.size, 0);
const mobileInitialBytes = initial.reduce((total, item) => total + item.gzip, 0) + fontBytes;

const failures = checks.flatMap((check) => check.failures.map(([kind, limit]) => `${check.label} ${kind} is ${check[kind]} bytes (budget ${limit})`));
if (mobileInitialBytes > 430_000) failures.push(`estimated mobile initial transfer is ${mobileInitialBytes} bytes (budget 430000)`);

for (const check of checks) console.log(`${check.label.padEnd(20)} ${basename(check.file).padEnd(36)} raw ${String(check.raw).padStart(7)}  gzip ${String(check.gzip).padStart(7)}`);
console.log(`${'mobile initial'.padEnd(20)} ${'estimated transfer'.padEnd(36)}      ${String(mobileInitialBytes).padStart(7)}`);
if (failures.length) throw new Error(`Web performance budget exceeded:\n- ${failures.join('\n- ')}`);
