#!/usr/bin/env node
// Generated from inspect.mts by npm run core:build. Do not edit directly.
import { createPublicClient, defineChain, http } from "viem";
import {
  erc8004IdentitySnapshotCommitment,
  parseERC8004AgentRef,
  verifyERC8004AgentIdentity
} from "priorseal-sdk";
const required = ["ERC8004_RPC_URL", "ERC8004_AGENT_REF", "ERC8004_EXECUTOR", "ERC8004_TRUSTED_IDENTITY_REGISTRIES"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
const rpcUrl = new URL(process.env.ERC8004_RPC_URL);
if (!["http:", "https:"].includes(rpcUrl.protocol)) throw new Error("ERC8004_RPC_URL must use HTTP or HTTPS");
const agentRef = parseERC8004AgentRef(process.env.ERC8004_AGENT_REF);
const trustedRegistryAddresses = process.env.ERC8004_TRUSTED_IDENTITY_REGISTRIES.split(",").map((value) => value.trim()).filter(Boolean);
const trustedRegistryCodeHashes = process.env.ERC8004_TRUSTED_REGISTRY_CODE_HASHES?.split(",").map((value) => value.trim()).filter(Boolean);
const chain = defineChain({
  id: agentRef.chainId,
  name: `EVM chain ${agentRef.chainId}`,
  nativeCurrency: { name: "Native currency", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl.toString()] } }
});
const client = createPublicClient({ chain, transport: http(rpcUrl.toString()) });
const result = await verifyERC8004AgentIdentity(client, agentRef, process.env.ERC8004_EXECUTOR, {
  trustedRegistryAddresses,
  ...trustedRegistryCodeHashes?.length ? { trustedRegistryCodeHashes } : {}
});
const output = {
  schema: "priorseal.erc8004.agent-inspection.v1",
  status: result.code,
  verified: result.verified,
  snapshot: result.snapshot,
  ...result.snapshot ? { identityCommitment: erc8004IdentitySnapshotCommitment(result.snapshot) } : {}
};
process.stdout.write(`${JSON.stringify(output, null, 2)}
`);
if (!result.verified) process.exitCode = 2;
