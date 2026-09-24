#!/usr/bin/env node
// Generated from package-web3-agent-kit-integration-spike-v1.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "README.md",
  "fixture/baseline.json",
  "fixture/cases.json",
  "fixture/manifest.json",
  "fixture/trust-roots.json",
  "verify.mjs"
];
const DOS_EPOCH_DATE = 33;
const UNIX_FILE_MODE = 420 << 16;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  }
  return value >>> 0;
});
function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/package-web3-agent-kit-integration-spike-v1.mjs [--version v1|v1.0.1] [--output PATH]");
  process.exit(2);
}
function parseArguments(arguments_) {
  const options = { version: "v1" };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--version") {
      if (value !== "v1" && value !== "v1.0.1") usage(`Unsupported version: ${value ?? "<missing>"}`);
      options.version = value;
      index += 1;
    } else if (argument === "--output") {
      if (!value) usage("Missing value for --output");
      options.output = value;
      index += 1;
    } else {
      usage(`Unknown argument: ${argument}`);
    }
  }
  return options;
}
function manifestFiles(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Manifest must be an object");
  }
  const files = Reflect.get(value, "files");
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error("Manifest files must be an object");
  }
  const entries = Object.entries(files);
  if (entries.some(([name, digest]) => !name || typeof digest !== "string")) {
    throw new Error("Manifest files must map names to digests");
  }
  return Object.fromEntries(entries);
}
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
function crc32(content) {
  let value = 4294967295;
  for (const byte of content) value = CRC32_TABLE[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 4294967295) >>> 0;
}
function assertZip32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) {
    throw new Error(`${label} exceeds the deterministic ZIP32 format`);
  }
}
function localHeader(entry) {
  assertZip32(entry.content.length, entry.name.toString("utf8"));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(67324752, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_EPOCH_DATE, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.content.length, 18);
  header.writeUInt32LE(entry.content.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}
function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(33639248, 0);
  header.writeUInt16LE(788, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_EPOCH_DATE, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.content.length, 20);
  header.writeUInt32LE(entry.content.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(UNIX_FILE_MODE, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}
function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  if (entryCount > 65535) throw new Error("Too many files for the deterministic ZIP32 format");
  assertZip32(centralSize, "Central directory");
  assertZip32(centralOffset, "Archive");
  const record = Buffer.alloc(22);
  record.writeUInt32LE(101010256, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}
function createStoredZip(files) {
  const localParts = [];
  const entries = [];
  let offset = 0;
  for (const [name, content] of files) {
    const entry = { name: Buffer.from(name, "utf8"), content, crc32: crc32(content), offset };
    const header = localHeader(entry);
    localParts.push(header, entry.name, content);
    entries.push(entry);
    offset += header.length + entry.name.length + content.length;
  }
  const centralParts = entries.flatMap((entry) => [centralHeader(entry), entry.name]);
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  return Buffer.concat([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(entries.length, centralSize, offset)
  ]);
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const suffix = options.version === "v1" ? "v1" : "v1.0.1";
  const bundle = resolve(ROOT, `examples/web3-agent-kit-integration-spike-${suffix}`);
  const output = options.output ?? resolve(ROOT, `wak-insight-priorseal-conformance-${suffix}.zip`);
  const manifest = manifestFiles(JSON.parse(await readFile(resolve(bundle, "fixture/manifest.json"), "utf8")));
  const archiveFiles = [];
  for (const name of FILES) {
    const content = await readFile(resolve(bundle, name));
    if (name !== "fixture/manifest.json" && manifest[name] !== sha256(content)) {
      throw new Error(`manifest mismatch: ${name}`);
    }
    archiveFiles.push([name, content]);
  }
  const archive = createStoredZip(archiveFiles);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, archive);
  console.log(JSON.stringify({
    status: "PACKAGED",
    version: options.version,
    path: output,
    sha256: sha256(archive)
  }));
}
await main();
