// Generated from check-web-performance.mts by npm run core:build. Do not edit directly.
import { readFile, readdir, stat } from "node:fs/promises";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";
const root = new URL("../web/dist/", import.meta.url);
const assets = new URL("assets/", root);
const files = await readdir(assets);
async function measurement(pattern, label, limits) {
  const matches = files.filter((file2) => pattern.test(file2));
  if (matches.length !== 1) throw new Error(`${label}: expected one matching asset, found ${matches.length}`);
  const file = matches[0];
  const body = await readFile(new URL(`assets/${file}`, root));
  const values = { raw: body.length, gzip: gzipSync(body, { level: 9 }).length };
  const failures2 = Object.entries(limits).filter(([kind, limit]) => values[kind] > limit);
  return { label, file, ...values, failures: failures2 };
}
const checks = await Promise.all([
  measurement(/^index-.*\.js$/, "application entry", { raw: 25e4, gzip: 8e4 }),
  measurement(/^LandingPage-.*\.js$/, "landing route", { raw: 2e4, gzip: 6e3 }),
  measurement(/^brand-.*\.js$/, "brand shared chunk", { raw: 2e3, gzip: 1e3 }),
  measurement(/^App-.*\.js$/, "console route", { raw: 92e3, gzip: 26500 }),
  measurement(/^verifier-.*\.js$/, "offline verifier", { raw: 52e4, gzip: 13e4 })
]);
const cssFiles = files.filter((file) => file.endsWith(".css"));
const cssBodies = await Promise.all(cssFiles.map((file) => readFile(new URL(`assets/${file}`, root))));
const cssRaw = cssBodies.reduce((total, body) => total + body.length, 0);
const cssGzip = cssBodies.reduce((total, body) => total + gzipSync(body, { level: 9 }).length, 0);
const hero = files.find((file) => /^priorseal-museum-800-.*\.jpg$/.test(file));
if (!hero) throw new Error("mobile hero: asset not found");
const heroBytes = (await stat(new URL(`assets/${hero}`, root))).size;
const initial = checks.filter(({ label }) => ["application entry", "landing route", "brand shared chunk"].includes(label));
const fontFiles = files.filter((file) => file.endsWith(".woff2"));
const fontBytes = (await Promise.all(fontFiles.map((file) => stat(new URL(`assets/${file}`, root))))).reduce((total, item) => total + item.size, 0);
const mobileInitialBytes = initial.reduce((total, item) => total + item.gzip, 0) + cssGzip + fontBytes + heroBytes;
const failures = checks.flatMap((check) => check.failures.map(([kind, limit]) => `${check.label} ${kind} is ${check[kind]} bytes (budget ${limit})`));
if (cssRaw > 6e4) failures.push(`CSS raw is ${cssRaw} bytes (budget 60000)`);
if (cssGzip > 15e3) failures.push(`CSS gzip is ${cssGzip} bytes (budget 15000)`);
if (heroBytes > 23e4) failures.push(`mobile hero is ${heroBytes} bytes (budget 230000)`);
if (mobileInitialBytes > 43e4) failures.push(`estimated mobile initial transfer is ${mobileInitialBytes} bytes (budget 430000)`);
for (const check of checks) console.log(`${check.label.padEnd(20)} ${basename(check.file).padEnd(36)} raw ${String(check.raw).padStart(7)}  gzip ${String(check.gzip).padStart(7)}`);
console.log(`${"all CSS".padEnd(20)} ${String(cssFiles.length).padEnd(36)} raw ${String(cssRaw).padStart(7)}  gzip ${String(cssGzip).padStart(7)}`);
console.log(`${"mobile hero".padEnd(20)} ${hero.padEnd(36)} raw ${String(heroBytes).padStart(7)}`);
console.log(`${"mobile initial".padEnd(20)} ${"estimated transfer".padEnd(36)}      ${String(mobileInitialBytes).padStart(7)}`);
if (failures.length) throw new Error(`Web performance budget exceeded:
- ${failures.join("\n- ")}`);
