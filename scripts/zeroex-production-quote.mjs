// Generated from zeroex-production-quote.mts by npm run core:build:operations. Do not edit directly.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createZeroExRouterClient,
  parseZeroExResponseSignatureConfiguration
} from "../sdk/dist/index.js";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const PILOT_TAKER = "BfVX9jcEALijnEuGPcGTjqjBgTFLTFMt6F7NrMHzGWf4";
const FEE_RECIPIENT_TOKEN_ACCOUNT = "FYj2K9vJqCgGq5FHWg3HQTdTSXtripR1k6ZsWfSCNqrq";
const QUOTE_TIMEOUT_MS = 2e4;
const RESPONSE_SIGNATURE_KEYS = parseZeroExResponseSignatureConfiguration({
  trustedKeys: [{
    kty: "OKP",
    crv: "Ed25519",
    kid: "0x-signing-key-prod-24092026",
    x: "19P3C981JsyQsqwVho8Tlabx51rslvdruSH59mGuWn0"
  }]
});
async function runZeroExProductionQuote({ environment = process.env, fetcher = fetch, now = () => Date.now(), log = console.log } = {}) {
  if (environment.PRIORSEAL_ENVIRONMENT !== "production") throw new TypeError("Set PRIORSEAL_ENVIRONMENT=production before requesting the 0x production route baseline");
  if (environment.PRIORSEAL_ZEROEX_ENABLED?.trim().toLowerCase() === "true") throw new TypeError("This quote-only baseline tool refuses to run while PRIORSEAL_ZEROEX_ENABLED is true");
  const apiKey = requiredSecret(environment.ZEROEX_API_KEY, "ZEROEX_API_KEY");
  const router = createZeroExRouterClient({
    apiKey,
    fetch: fetcher,
    now,
    computeBudget: { computeUnitLimit: 2e5, computeUnitPriceMicroLamports: "100" },
    responseSignature: RESPONSE_SIGNATURE_KEYS,
    commercialFee: {
      profileId: "priorseal-internal-usdc-10bps",
      tenantId: "priorseal-internal-pilot",
      inputMint: USDC_MINT,
      feePpm: 1e3,
      recipientTokenAccount: FEE_RECIPIENT_TOKEN_ACCOUNT,
      side: "sell"
    }
  });
  const build = (await router.build({
    inputMint: USDC_MINT,
    outputMint: WRAPPED_SOL_MINT,
    amount: "2000000",
    taker: PILOT_TAKER,
    slippageBps: 50
  }, { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) })).zeroExBuild;
  const instructionProgramIds = build.instructions.map((instruction) => instruction.programId);
  const routeDexProgramIds = build.routePlan.map((leg) => leg.dexProgramId);
  const programIds = [.../* @__PURE__ */ new Set([...build.computeBudgetInstructions.map((instruction) => instruction.programId), ...instructionProgramIds, ...routeDexProgramIds])].sort();
  const addressLookupTables = [...build.addressLookupTableAddresses].sort();
  const route = build.routePlan.map((leg) => ({ dexLabel: leg.dexLabel, dexProgramId: leg.dexProgramId, ppb: leg.ppb })).sort((left, right) => `${left.dexProgramId}:${left.dexLabel}:${left.ppb}`.localeCompare(`${right.dexProgramId}:${right.dexLabel}:${right.ppb}`));
  const evidence = {
    schema: "priorseal.zeroex-route-baseline.v1",
    mode: "quote-only",
    responseSignatureVerified: true,
    transactionBroadcast: false,
    authorizationCreated: false,
    signerMaterialUsed: false,
    requested: {
      inputMint: USDC_MINT,
      outputMint: WRAPPED_SOL_MINT,
      amountAtomic: "2000000",
      slippageBps: 50,
      taker: PILOT_TAKER,
      commercialFee: build.commercial.fee
    },
    response: {
      zid: build.zid,
      amountOutAtomic: build.amountOut,
      minimumOutputAmountAtomic: build.minimumOutputAmount,
      programIds,
      addressLookupTables,
      route
    }
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  log(JSON.stringify({ ...evidence, fingerprint: `sha256:${fingerprint}`, capturedAt: new Date(now()).toISOString() }));
}
function requiredSecret(value, name) {
  const secret = value?.trim();
  if (!secret) throw new TypeError(`${name} is required`);
  return secret;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runZeroExProductionQuote();
}
export {
  runZeroExProductionQuote
};
