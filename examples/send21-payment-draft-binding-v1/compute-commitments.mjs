#!/usr/bin/env node
// Generated from compute-commitments.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const epochSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1e3);
function jcs(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("commitment inputs must be strings or safe integers");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => jcs(v)).join(",")}]`;
  const record = value;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(record[k])}`).join(",")}}`;
}
const recordedDraft = {
  id: "66238009-a717-4746-96c5-4b2b013d7f3a",
  network: "BaseSepolia",
  currency: "Usdc",
  receiverAddress: "0x54d4ddfD8A8C582Ae55450c573617D5bccF860F8",
  tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amountBaseUnits: 100793,
  // Derived field: MUST be constructed from the same base units
  // (ERC-20 transfer calldata URI). Kept in the core per v0.1 review.
  paymentUri: "ethereum:0x036CbD53842c5426634e7929541eC2318f3dCF7e@84532/transfer?address=0x54d4ddfD8A8C582Ae55450c573617D5bccF860F8&uint256=100793",
  createdAtEpoch: epochSeconds("2026-09-24T07:20:35.460551+00:00"),
  expiresAtEpoch: epochSeconds("2026-09-24T07:50:35.460552+00:00")
};
const draftCore = {
  id: recordedDraft.id,
  network: recordedDraft.network,
  currency: recordedDraft.currency,
  receiverAddress: recordedDraft.receiverAddress,
  tokenAddress: recordedDraft.tokenAddress,
  amountBaseUnits: recordedDraft.amountBaseUnits,
  paymentUri: recordedDraft.paymentUri,
  createdAtEpoch: recordedDraft.createdAtEpoch,
  expiresAtEpoch: recordedDraft.expiresAtEpoch
};
const quote = {
  draftId: recordedDraft.id,
  cryptoAmountBaseUnits: recordedDraft.amountBaseUnits,
  tokenAddress: recordedDraft.tokenAddress,
  lockedUntilEpoch: recordedDraft.expiresAtEpoch
};
const commitments = {
  "send21:draft_id": {
    algorithm: "sha256",
    commitment: `0x${sha256(recordedDraft.id)}`,
    note: "opaque SHA-256 over the UTF-8 draft id; the id itself is not revealed in the receipt"
  },
  "send21:draft_core_sha256": {
    algorithm: "sha256",
    canonicalization: "JCS (RFC 8785)",
    commitment: `0x${sha256(jcs(draftCore))}`,
    canonical_bytes: jcs(draftCore).length
  },
  "send21:quote_sha256": {
    algorithm: "sha256",
    canonicalization: "JCS (RFC 8785)",
    commitment: `0x${sha256(jcs(quote))}`,
    canonical_bytes: jcs(quote).length
  }
};
const pinned = {
  "send21:draft_id": "0x8630b82de87bf5286f7204695a782ab635097fa2326c19940252a397c6c84483",
  "send21:draft_core_sha256": "0xb23c978eab03071d5076f2de9eef1030f7edf6d1a64a4ae2b0f078eb8c9a37e7",
  "send21:quote_sha256": "0xba377e399d14f4ed1c924d655adbd50fc538957b4b77b644899bd41a0729d8ec"
};
if (process.argv.includes("--verify")) {
  const mismatches = Object.keys(pinned).filter((k) => commitments[k].commitment !== pinned[k]);
  if (mismatches.length > 0) {
    for (const k of mismatches) console.error(`MISMATCH ${k}: got ${commitments[k].commitment}, pinned ${pinned[k]}`);
    process.exit(1);
  }
  console.log("all commitments match the pinned v0.1 test vectors");
  process.exit(0);
}
console.log(JSON.stringify(commitments, null, 2) + "\n");
console.error("run with --verify to check against the pinned v0.1 test vectors");
