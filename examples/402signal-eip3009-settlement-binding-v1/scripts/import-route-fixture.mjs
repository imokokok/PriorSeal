// Generated from import-route-fixture.mts by npm run core:build. Do not edit directly.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = process.argv[2];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUpstreamCase(value) {
  if (!isRecord(value) || value.rail !== "base" || typeof value.method !== "string" || typeof value.body !== "string" || typeof value.now !== "number" || !isRecord(value.response) || typeof value.response.url !== "string" || !isRecord(value.response.pq_trust) || !isRecord(value.response.pq_trust.transparency) || !isRecord(value.response.pq_trust.transparency.receipt) || typeof value.response.pq_trust.transparency.receipt.leaf_hash !== "string") return false;
  return "request" in value && "challenge" in value;
}
if (!source) {
  throw new Error("usage: node scripts/import-route-fixture.mjs /path/to/route-binding-v1.json");
}
const upstream = JSON.parse(readFileSync(source, "utf8"));
if (!isRecord(upstream) || !Array.isArray(upstream.cases)) throw new Error("unexpected 402Signal fixture");
const base = upstream.cases.find(isUpstreamCase);
if (!base || upstream.trusted_vkey !== "402signal.com/pq/log+6cc295a4+AQOhB7/zzhC+HXDdGOdLwJln5NYwm6UNXx3chmQSVTG4") {
  throw new Error("unexpected 402Signal fixture or pinned test key");
}
const rawDirectory = resolve(root, "fixture", "raw");
mkdirSync(rawDirectory, { recursive: true });
const writeJson = (name, value) => {
  writeFileSync(resolve(rawDirectory, name), `${JSON.stringify(value, null, 2)}
`);
};
writeJson("route-request.json", base.request);
writeJson("route-response.json", base.response);
writeJson("seller-challenge.json", base.challenge);
writeJson("route-context.json", {
  schema: "priorseal.402signal-route-context.v1",
  upstream: {
    repository: "https://github.com/402signalhq/402signal",
    commit: "ca6e2f1ee806bec6621487338ba6ed3f1ac09352",
    source: "tests/fixtures/route-binding-v1.json",
    sourceSha256: "cb40034ae6ada72a6267ff426591b36ea7d5afcf28002f9ebc4ac959bd2f00b3",
    routeGuardVersion: "0.7.3",
    routeGuardIndexSha256: "c3ee556e0e9a66f24e9579a536f929f2d4ab3bb75d47200a7e7ece470f1247e3",
    routeGuardInternalJsonSha256: "3620a93d28bed6ee1992f085345deb5321f8966e2febf6c6a8a991109917105b"
  },
  trustedLogVkey: upstream.trusted_vkey,
  sellerRequest: {
    url: base.response.url,
    method: base.method,
    bodyBase64: Buffer.from(base.body).toString("base64")
  },
  evaluationNow: base.now,
  expectedLeafHash: base.response.pq_trust.transparency.receipt.leaf_hash
});
console.log(`Imported the 402Signal Base vector into ${rawDirectory}`);
