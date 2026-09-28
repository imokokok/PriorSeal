import { hashJson } from '../../domain/hashing.mjs';
import { executeAuthorizedExactCall, reconcileAuthorizedExactCall, type AuthorizationStore, type ContractSignatureVerifier, type RecoveryObservation } from '../execution/authorized-exact-call.mjs';
import type { RwaAttempt, RwaTransaction } from '../../infrastructure/persistence/rwa-attempt-store.mjs';
import type { RwaAttemptStore } from '../../infrastructure/persistence/rwa-attempt-model.mjs';
import type { withRwaExecutionPair, PriorSealClient } from 'priorseal-sdk';

type ExactTransaction = Parameters<typeof withRwaExecutionPair>[1];
type Input = {
  audience: string;
  authorizationId: string;
  intent: Parameters<typeof withRwaExecutionPair>[0]['intent'];
  transaction: ExactTransaction;
  acceptanceKey: Parameters<typeof executeAuthorizedExactCall>[0]['acceptanceKey'];
  adapter: { kind: 'uniswap-v3-single'; approval: unknown };
};
type ChainReader = {
  getChainId(): Promise<number>;
  getBytecode(input: { address: `0x${string}` }): Promise<`0x${string}` | undefined>;
};
type Dependencies = {
  authorizationStore: AuthorizationStore;
  attempts: RwaAttemptStore;
  chainReader: ChainReader;
  submit: (transaction: ExactTransaction, assertBeforeBroadcast: () => Promise<void>) => Promise<string>;
  clock?: () => number;
  verifyContractSignature?: ContractSignatureVerifier;
};

/** Stable DeFi signer entry with explicit reviewed adapters. The first adapter
 * is the original Uniswap V3 ERC-20 exactInputSingle profile. Arbitrary calldata
 * and unknown selectors are never admitted by this function.
 */
export async function executeDefiAuthorized(input: Input, deps: Dependencies) {
  const p = structuredClone(input);
  if (p.adapter?.kind !== 'uniswap-v3-single') throw new Error('DEFI_ADAPTER_UNSUPPORTED');
  const { parseV3SwapApproval, assertV3SwapAuthorization } = await import('priorseal-sdk');
  const approval = parseV3SwapApproval(p.adapter.approval);
  const executionDigest = `0x${hashJson({ schema: 'priorseal.defi-execution.v1', adapter: p.adapter.kind, approval })}`;
  return executeAuthorizedExactCall({
    audience: p.audience, authorizationId: p.authorizationId, intent: p.intent,
    transaction: p.transaction, acceptanceKey: p.acceptanceKey, executionDigest,
  }, {
    ...deps,
    checkProfile: async (transaction, now) => {
      const rpcChain = await deps.chainReader.getChainId();
      if (rpcChain !== approval.chainId) throw new Error('DEFI_RPC_CHAIN_MISMATCH');
      const bytecode = await deps.chainReader.getBytecode({ address: approval.router as `0x${string}` });
      assertV3SwapAuthorization({ approval, transaction, intent: p.intent, routerBytecode: bytecode, now });
    },
  });
}

/** Query never signs or broadcasts. The returned status may remain UNCERTAIN. */
export async function getDefiAttempt(authorizationId: string, attempts: RwaAttemptStore): Promise<RwaAttempt | null> {
  return attempts.get(authorizationId);
}

/** Recover from a trusted finalized chain observation; never resubmit or free
 * the signer nonce. Observers must independently verify the chain and finality.
 */
export async function reconcileDefiAttempt(authorizationId: string, deps: { attempts: RwaAttemptStore; authorizationStore: AuthorizationStore; observe: (attempt: RwaAttempt) => Promise<RecoveryObservation | null>; clock?: () => number }) {
  return reconcileAuthorizedExactCall(authorizationId, deps);
}

/** One Node-facing lifecycle surface. Signing stays in the caller's wallet;
 * authorization acceptance stays in the PriorSeal service. Its execute method
 * alone holds the durable claim and uses the configured local-account submitter.
 */
export function createDefiExecutionGateway(client: Pick<PriorSealClient, 'prepareAuthorization' | 'acceptAuthorization'>, deps: Dependencies) {
  if (!client || typeof client.prepareAuthorization !== 'function' || typeof client.acceptAuthorization !== 'function') throw new TypeError('DEFI_AUTHORIZATION_CLIENT_REQUIRED');
  return {
    async prepare(input: { approval: unknown; transaction: ExactTransaction; intentId: string; validUntil: number; constraints?: Parameters<typeof import('priorseal-sdk').buildV3SwapIntent>[0]['constraints']; contextCommitments?: Parameters<typeof import('priorseal-sdk').buildV3SwapIntent>[0]['contextCommitments']; authorization: Omit<Parameters<PriorSealClient['prepareAuthorization']>[0], 'intent'> }) {
      const { parseV3SwapApproval, assertV3SwapRouterCode, buildV3SwapIntent } = await import('priorseal-sdk');
      const approval = parseV3SwapApproval(input.approval);
      if (await deps.chainReader.getChainId() !== approval.chainId) throw new Error('DEFI_RPC_CHAIN_MISMATCH');
      assertV3SwapRouterCode(approval, await deps.chainReader.getBytecode({ address: approval.router as `0x${string}` }));
      const intent = buildV3SwapIntent({ approval, transaction: input.transaction, intentId: input.intentId, validUntil: input.validUntil, constraints: input.constraints, contextCommitments: input.contextCommitments, now: (deps.clock ?? (() => Math.floor(Date.now() / 1000)))() });
      return client.prepareAuthorization({ ...input.authorization, intent });
    },
    authorize(signed: Parameters<PriorSealClient['acceptAuthorization']>[0]) { return client.acceptAuthorization(signed); },
    execute(input: Input) { return executeDefiAuthorized(input, deps); },
    status(authorizationId: string) { return getDefiAttempt(authorizationId, deps.attempts); },
    recover(authorizationId: string, observe: (attempt: RwaAttempt) => Promise<RecoveryObservation | null>) {
      return reconcileDefiAttempt(authorizationId, { attempts: deps.attempts, authorizationStore: deps.authorizationStore, observe, clock: deps.clock });
    },
  };
}

export type { ChainReader as DefiChainReader, Input as DefiExecutionInput, Dependencies as DefiExecutionDependencies, RwaTransaction as DefiTransaction };
