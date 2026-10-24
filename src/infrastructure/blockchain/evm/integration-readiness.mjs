// Generated from integration-readiness.mts by npm run core:build. Do not edit directly.
import { sha256Hex } from "../../../domain/hashing.mjs";
import { SUPPORTED_CHAINS } from "./chains.mjs";
import { createRpcClient } from "./rpc-client.mjs";
function createIntegrationReadinessInspector({
  rpcClient = createRpcClient(),
  rpcUrls
}) {
  return async ({ chainId, subjectAddress, signal }) => {
    const supported = Boolean(SUPPORTED_CHAINS[chainId]) && chainId !== 0;
    const urls = supported ? rpcUrls(chainId) : [];
    if (!supported || urls.length === 0) {
      return {
        chain: { support: supported ? "SUPPORTED" : "UNSUPPORTED", rpc: "NOT_CONFIGURED", observedChainId: null, source: null },
        subject: { kind: "NOT_OBSERVED", codeHash: null, codeBytes: null }
      };
    }
    try {
      const reportedChainId = Number(BigInt(await rpcClient.call(urls[0], "eth_chainId", [], signal)));
      if (!Number.isSafeInteger(reportedChainId) || reportedChainId !== chainId) {
        return {
          chain: { support: "SUPPORTED", rpc: "CHAIN_ID_MISMATCH", observedChainId: Number.isSafeInteger(reportedChainId) ? reportedChainId : null, source: "evm-json-rpc" },
          subject: { kind: "NOT_OBSERVED", codeHash: null, codeBytes: null }
        };
      }
      const code = (await rpcClient.call(urls[0], "eth_getCode", [subjectAddress, "latest"], signal)).toLowerCase();
      const codeBytes = (code.length - 2) / 2;
      return {
        chain: { support: "SUPPORTED", rpc: "AVAILABLE", observedChainId: reportedChainId, source: "evm-json-rpc" },
        subject: { kind: codeBytes === 0 ? "EOA" : "CONTRACT", codeHash: `0x${sha256Hex(code)}`, codeBytes }
      };
    } catch {
      return {
        chain: { support: "SUPPORTED", rpc: "UNAVAILABLE", observedChainId: null, source: "evm-json-rpc" },
        subject: { kind: "NOT_OBSERVED", codeHash: null, codeBytes: null }
      };
    }
  };
}
export {
  createIntegrationReadinessInspector
};
