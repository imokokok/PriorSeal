// Generated from x402-credit-packs.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function parseX402CreditPacks(value, x402) {
  if (value === void 0 || value === null || value === "") return void 0;
  if (!x402) throw new TypeError("PRIORSEAL_X402_CREDIT_PACKS_JSON requires x402 to be configured");
  const root = record(value, "PRIORSEAL_X402_CREDIT_PACKS_JSON");
  exactKeys(root, ["packs", "schema"], "PRIORSEAL_X402_CREDIT_PACKS_JSON");
  if (root.schema !== "priorseal.x402-credit-packs.v1" || !Array.isArray(root.packs) || root.packs.length < 1 || root.packs.length > 16) throw new TypeError("PRIORSEAL_X402_CREDIT_PACKS_JSON has an invalid shape");
  const seen = /* @__PURE__ */ new Set();
  const packs = root.packs.map((value2, index) => {
    const pack = record(value2, `x402 credit pack ${index}`);
    exactKeys(pack, ["credits", "packId", "priceUsd"], `x402 credit pack ${index}`);
    if (typeof pack.packId !== "string" || !IDENTIFIER.test(pack.packId) || seen.has(pack.packId) || typeof pack.credits !== "string" || !positiveUint(pack.credits) || typeof pack.priceUsd !== "string" || !positiveUsd(pack.priceUsd)) {
      throw new TypeError(`x402 credit pack ${index} is invalid`);
    }
    seen.add(pack.packId);
    const checkoutPath = `/v1/agent-credit-packs/${pack.packId}/checkout`;
    const route = x402.routes.find((candidate) => candidate.path === checkoutPath);
    if (!route || route.method !== "GET" || route.price !== `$${pack.priceUsd}`) throw new TypeError(`x402 credit pack ${pack.packId} requires an x402 GET route at ${checkoutPath} priced $${pack.priceUsd}`);
    return { packId: pack.packId, credits: pack.credits, priceUsd: pack.priceUsd, checkoutPath };
  });
  return { schema: "priorseal.x402-credit-packs.v1", packs, findByPath: (path) => packs.find((pack) => pack.checkoutPath === path) };
}
function x402CreditPurchaseId(paymentLedgerId) {
  if (!/^xpl_[0-9a-f]{32}$/.test(paymentLedgerId)) throw new TypeError("Invalid x402 payment ledger identifier");
  return `xcp_${hashJson({ paymentLedgerId }).slice(0, 32)}`;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new TypeError(`${label} has unknown or missing fields`);
}
function positiveUint(value) {
  return /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 9007199254740991n;
}
function positiveUsd(value) {
  return /^(?:0|[1-9][0-9]{0,4})\.[0-9]{1,6}$/.test(value) && BigInt(value.replace(".", "")) > 0n;
}
export {
  parseX402CreditPacks,
  x402CreditPurchaseId
};
