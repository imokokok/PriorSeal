import { sha256Hex } from '../../../domain/hashing.mjs';
import type { IntegrationReadinessInspection } from '../../../domain/integration-readiness.mjs';
import { SUPPORTED_CHAINS } from './chains.mjs';
import { createRpcClient } from './rpc-client.mjs';

type ReadinessProbeInput = { chainId: number; subjectAddress: string; signal?: AbortSignal };

/**
 * Uses only eth_chainId and eth_getCode. It never signs, sends, estimates, or
 * simulates a state-changing transaction. Failures become a signed negative
 * readiness fact so callers receive the product they paid for without turning
 * an upstream outage into a settlement attempt for an error response.
 */
export function createIntegrationReadinessInspector({
  rpcClient = createRpcClient(),
  rpcUrls,
}: {
  rpcClient?: ReturnType<typeof createRpcClient>;
  rpcUrls: (chainId: number) => string[];
}) {
  return async ({ chainId, subjectAddress, signal }: ReadinessProbeInput): Promise<IntegrationReadinessInspection> => {
    const supported = Boolean((SUPPORTED_CHAINS as Record<number, unknown>)[chainId]) && chainId !== 0;
    const urls = supported ? rpcUrls(chainId) : [];
    if (!supported || urls.length === 0) {
      return {
        chain: { support: supported ? 'SUPPORTED' : 'UNSUPPORTED', rpc: 'NOT_CONFIGURED', observedChainId: null, source: null },
        subject: { kind: 'NOT_OBSERVED', codeHash: null, codeBytes: null },
      };
    }
    try {
      const reportedChainId = Number(BigInt(await rpcClient.call<string>(urls[0], 'eth_chainId', [], signal)));
      if (!Number.isSafeInteger(reportedChainId) || reportedChainId !== chainId) {
        return {
          chain: { support: 'SUPPORTED', rpc: 'CHAIN_ID_MISMATCH', observedChainId: Number.isSafeInteger(reportedChainId) ? reportedChainId : null, source: 'evm-json-rpc' },
          subject: { kind: 'NOT_OBSERVED', codeHash: null, codeBytes: null },
        };
      }
      const code = (await rpcClient.call<string>(urls[0], 'eth_getCode', [subjectAddress, 'latest'], signal)).toLowerCase();
      const codeBytes = (code.length - 2) / 2;
      return {
        chain: { support: 'SUPPORTED', rpc: 'AVAILABLE', observedChainId: reportedChainId, source: 'evm-json-rpc' },
        subject: { kind: codeBytes === 0 ? 'EOA' : 'CONTRACT', codeHash: `0x${sha256Hex(code)}`, codeBytes },
      };
    } catch {
      return {
        chain: { support: 'SUPPORTED', rpc: 'UNAVAILABLE', observedChainId: null, source: 'evm-json-rpc' },
        subject: { kind: 'NOT_OBSERVED', codeHash: null, codeBytes: null },
      };
    }
  };
}
