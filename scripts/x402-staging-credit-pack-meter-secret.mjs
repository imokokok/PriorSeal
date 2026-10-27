// Generated from x402-staging-credit-pack-meter-secret.mts by npm run core:build:operations. Do not edit directly.
import { createHash } from "node:crypto";
const rawKey = process.env.X402_E2E_PRIVATE_KEY?.trim();
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  throw new TypeError("X402_E2E_PRIVATE_KEY must be a dedicated 32-byte 0x-prefixed Base Sepolia test-wallet key");
}
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const agentCredential = `psa_staging_credit_pack_${digest(`agent:${rawKey}`)}`;
const config = {
  schema: "priorseal.agent-meter.v1",
  creditUnitUsd: "0.01",
  operatorCredentialHash: digest(`operator:${rawKey}`),
  accounts: [{
    accountId: "staging:credit-pack-rehearsal",
    credentialHash: digest(agentCredential),
    provisionedCredits: "1",
    status: "active"
  }],
  routes: [
    { routeId: "authorization-acceptance", method: "POST", path: "/v1/authorizations", credits: "3" },
    { routeId: "execution-observation", method: "POST", path: "/v1/executions/observe", credits: "9" }
  ]
};
process.stdout.write(JSON.stringify({ PRIORSEAL_AGENT_METER_JSON: JSON.stringify(config) }));
