export const EXECUTION_SCHEMA = 'priorseal.execution-observation.v1';
export const EXECUTION_STATUSES = ['PENDING', 'CONFIRMED', 'REVERTED', 'REORGED', 'NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'] as const;

export type ExecutionInput = {
  chainId?: number | string;
  txHash?: string | null;
  status?: string;
  blockNumber?: number | null;
  blockHash?: string | null;
  executedAt?: number | null;
  observedAt?: number | null;
  action?: string | null;
  nonce?: string | null;
  sender?: string | null;
  recipient?: string | null;
  target?: string | null;
  calldataHash?: string | null;
  asset?: string | null;
  amount?: string | null;
  transfers?: unknown[] | null;
  transferMatchUnique?: boolean;
  nativeValue?: string | null;
  tokenValue?: string | null;
  gasUsed?: string | null;
  fee?: string | null;
  executionDataAvailable?: boolean;
  observationSource?: string;
  finalityState?: string;
  confirmations?: number;
};

export function normalizeExecution(input: ExecutionInput) {
  return { schema: EXECUTION_SCHEMA, chainId: input.chainId, txHash: input.txHash?.toLowerCase(), status: input.status, blockNumber: input.blockNumber ?? null, blockHash: input.blockHash ?? null, executedAt: input.executedAt ?? null, observedAt: input.observedAt ?? Math.floor(Date.now() / 1000), action: input.action ?? null, nonce: input.nonce ?? null, sender: input.sender?.toLowerCase() ?? null, recipient: input.recipient?.toLowerCase() ?? null, target: input.target?.toLowerCase() ?? null, calldataHash: input.calldataHash?.toLowerCase() ?? null, asset: input.asset ?? null, amount: input.amount ?? null, transfers: input.transfers ?? [], transferMatchUnique: input.transferMatchUnique ?? false, nativeValue: input.nativeValue ?? null, tokenValue: input.tokenValue ?? null, gasUsed: input.gasUsed ?? null, fee: input.fee ?? null, executionDataAvailable: input.executionDataAvailable ?? true, observationSource: input.observationSource ?? 'unknown', finalityState: input.finalityState ?? 'UNKNOWN', confirmations: input.confirmations ?? 0 };
}

type ReorgObservation = Pick<ExecutionInput, 'txHash' | 'blockHash' | 'status'>;

export function detectReorg(previous: ReorgObservation | null | undefined, current: ReorgObservation | null | undefined): boolean {
  if (!previous || !current || previous.txHash !== current.txHash) return false;
  if (previous.blockHash && current.status === 'NOT_FOUND') return true;
  return Boolean(previous.blockHash && current.blockHash && previous.blockHash !== current.blockHash);
}
