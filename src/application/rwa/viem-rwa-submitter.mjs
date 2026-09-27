// Generated from viem-rwa-submitter.mts by npm run core:build. Do not edit directly.
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { createRwaReservation } from "../../infrastructure/persistence/rwa-attempt-model.mjs";
function createRwaViemSubmitter(client) {
  const account = client.account, chain = client.chain;
  if (!account || account.type !== "local" || !chain || !Number.isSafeInteger(chain.id) || chain.id <= 0) throw new Error("RWA_LOCAL_ACCOUNT_AND_CHAIN_REQUIRED");
  if (!["http", "custom"].includes(client.transport?.type)) throw new Error("RWA_SINGLE_TRANSPORT_REQUIRED");
  return async (transaction, assertBeforeBroadcast) => {
    if (typeof assertBeforeBroadcast !== "function") throw new Error("RWA_BROADCAST_GUARD_REQUIRED");
    const tx = createRwaReservation({ authorizationId: "auth_" + "00".repeat(16), transaction, executionDigest: "0x" + "00".repeat(32), now: 1 }).transaction;
    if (tx.from !== account.address.toLowerCase() || tx.chainId !== chain.id || !Number.isSafeInteger(Number(tx.nonce))) throw new Error("RWA_SIGNER_SCOPE_MISMATCH");
    const rpcChain = await client.request({ method: "eth_chainId" });
    if (typeof rpcChain !== "string" || !/^0x[0-9a-fA-F]+$/.test(rpcChain) || BigInt(rpcChain) !== BigInt(tx.chainId)) throw new Error("RWA_RPC_CHAIN_MISMATCH");
    const prepared = await client.prepareTransactionRequest({ account, chain, to: tx.to, data: tx.data, nonce: Number(tx.nonce), value: BigInt(tx.value) });
    await assertBeforeBroadcast();
    const serialized = await client.signTransaction({ ...prepared, account, chain });
    const decoded = parseTransaction(serialized), sender = await recoverTransactionAddress({ serializedTransaction: serialized });
    if (sender.toLowerCase() !== tx.from || decoded.chainId !== tx.chainId || decoded.to?.toLowerCase() !== tx.to || decoded.data?.toLowerCase() !== tx.data.toLowerCase() || decoded.nonce !== Number(tx.nonce) || (decoded.value ?? 0n) !== BigInt(tx.value)) throw new Error("RWA_SIGNED_TRANSACTION_MISMATCH");
    await assertBeforeBroadcast();
    const response = await client.request({ method: "eth_sendRawTransaction", params: [serialized] }, { retryCount: 0 });
    if (typeof response !== "string" || !/^0x[0-9a-f]{64}$/.test(response) || response !== keccak256(serialized)) throw new Error("RWA_SUBMISSION_RESPONSE_INVALID");
    return response;
  };
}
export {
  createRwaViemSubmitter
};
