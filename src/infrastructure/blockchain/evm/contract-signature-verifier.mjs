import { PriorSealError } from '../../../domain/errors.mjs';
import { erc1271CallData } from '../../../domain/authorization.mjs';

const ERC1271_MAGIC_VALUE = '0x1626ba7e';

/**
 * Builds an ERC-1271 verifier that establishes endpoint chain identity before
 * trusting contract state. A reachable, correctly identified endpoint may
 * report an invalid signature; missing, wrong-chain, or failed sources are an
 * availability failure instead of evidence that the signature is invalid.
 */
export function createContractSignatureVerifier({ rpcClient, rpcUrls }) {
  if (!rpcClient?.call || typeof rpcUrls !== 'function') throw new TypeError('ERC-1271 verification requires an RPC client and URL resolver');
  return async ({ authorization, digest, signature }) => {
    const chain = Number(authorization.intent.chainId);
    const urls = rpcUrls(chain) ?? [];
    let completedContractChecks = 0;
    for (const url of urls) {
      try {
        const reportedChain = Number(BigInt(await rpcClient.call(url, 'eth_chainId', [])));
        if (reportedChain !== chain) continue;
        const result = await rpcClient.call(url, 'eth_call', [{ to: authorization.authorizer.address, data: erc1271CallData(digest, signature) }, 'latest']);
        completedContractChecks += 1;
        if (String(result).slice(0, 10).toLowerCase() === ERC1271_MAGIC_VALUE) return true;
      } catch { /* Try the next explicitly configured source. */ }
    }
    if (completedContractChecks === 0) throw new PriorSealError('AUTHORIZATION_VERIFIER_UNAVAILABLE', 'No correctly identified RPC endpoint could verify the contract signature');
    return false;
  };
}
