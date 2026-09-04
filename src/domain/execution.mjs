export const EXECUTION_SCHEMA = 'runproof.execution-observation.v1';
export const EXECUTION_STATUSES = ['PENDING', 'CONFIRMED', 'REVERTED', 'NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'];
export function normalizeExecution(input) {
  return { schema: EXECUTION_SCHEMA, chainId: input.chainId, txHash: input.txHash?.toLowerCase(), status: input.status, blockNumber: input.blockNumber ?? null, blockHash: input.blockHash ?? null, observedAt: input.observedAt ?? Math.floor(Date.now() / 1000), nonce: input.nonce ?? null, sender: input.sender?.toLowerCase() ?? null, recipient: input.recipient?.toLowerCase() ?? null, asset: input.asset ?? null, amount: input.amount ?? null, transfers: input.transfers ?? [], nativeValue: input.nativeValue ?? null, tokenValue: input.tokenValue ?? null, gasUsed: input.gasUsed ?? null, fee: input.fee ?? null, executionDataAvailable: input.executionDataAvailable ?? true, observationSource: input.observationSource ?? 'unknown', finalityState: input.finalityState ?? 'UNKNOWN', confirmations: input.confirmations ?? 0 };
}
export function detectReorg(previous, current) {
  if (!previous || !current || previous.txHash !== current.txHash) return false;
  return Boolean(previous.blockHash && current.blockHash && previous.blockHash !== current.blockHash);
}
