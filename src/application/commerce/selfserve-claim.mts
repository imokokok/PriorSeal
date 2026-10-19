import { createHash, createHmac } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { PriorSealError } from '../../domain/errors.mjs';
import type { AgentMeterAccountState, AgentMeterStore } from './agent-meter.mjs';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSFER_SELECTOR = 'a9059cbb';
const CREDENTIAL_DOMAIN = 'priorseal-selfserve-credential-v1';
const CLAIM_DOMAIN = 'priorseal-selfserve-claim-v1';
export const SELFSEEK_BASE_MAINNET_CHAIN_ID = 8453;
export const SELFSEEK_BASE_MAINNET_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_RAW_DECIMALS = 6n;

export type SelfserveClaimConfig = {
  schema: 'priorseal.selfserve-claim.v1';
  chainId: number;
  payTo: string;
  usdcAddress: string;
  minRawUnits: bigint;
  rawUnitsPerCredit: bigint;
  credentialKeyHex: string;
};

export type SelfserveClaimPublicConfig = {
  chainId: number;
  payTo: string;
  usdcAddress: string;
  minPayUsd: string;
  creditUnitUsd: string;
};

export type SelfserveClaimResult = {
  status: 'created' | 'credited';
  replay: boolean;
  accountId: string;
  account: AgentMeterAccountState;
  credential: string;
  credits: string;
  txHash: string;
};

export type SelfserveClaim = {
  config: SelfserveClaimPublicConfig;
  claim: (input: { txHash: string; signature: string }) => Promise<SelfserveClaimResult>;
};

export type SelfserveClaimDeps = {
  store: AgentMeterStore;
  rpc: { call: <T = unknown>(url: string, method: string, params: unknown[], signal?: AbortSignal) => Promise<T> };
  rpcUrls: (chainId: number | string) => string[];
  now?: () => number;
};

/** The message a payer must sign with the wallet that sent the funded transfer. */
export function selfserveClaimMessage(payTo: string, txHash: string): string {
  return `${CLAIM_DOMAIN}:${payTo.toLowerCase()}:${txHash.toLowerCase()}`;
}

/**
 * Self-serve funding claim: an agent that transferred USDC to the deployment
 * payTo proves ownership of the payer wallet with an EIP-191 signature over a
 * message that commits to the transaction hash, and receives a meter account
 * with payment-backed credits in one response.
 *
 * Idempotency needs no dedicated claim ledger: the account credential is
 * deterministically derived (HMAC over the accountId under a deployment
 * secret), so a retried claim returns the same credential, and the credit
 * operation reuses the same idempotency key convention as operator top-ups
 * (`usdcpay-<txHash>`), so the durable credit ledger rejects any double
 * crediting of the same transfer. Raw credentials are never persisted; only
 * their SHA-256 digest is stored. Only externally owned senders can claim:
 * contract wallets and bundler-relieved senders cannot produce the signature
 * for the transaction's `from` address.
 */
export function createSelfserveClaim(config: SelfserveClaimConfig, { store, rpc, rpcUrls, now = () => Date.now() }: SelfserveClaimDeps): SelfserveClaim {
  const credentialKey = Buffer.from(config.credentialKeyHex, 'hex');
  const credentialFor = (accountId: string) => `psa_${createHmac('sha256', credentialKey).update(`${CREDENTIAL_DOMAIN}:${accountId}`, 'utf8').digest('base64url')}`;
  const minPayUsd = formatUsd(config.minRawUnits);
  return {
    config: { chainId: config.chainId, payTo: config.payTo, usdcAddress: config.usdcAddress, minPayUsd, creditUnitUsd: creditUnitUsdLabel(config.rawUnitsPerCredit) },
    async claim({ txHash, signature }) {
      if (typeof txHash !== 'string' || !TX_HASH.test(txHash)) throw new PriorSealError('CLAIM_INVALID_REQUEST', 'A self-serve claim requires a 32-byte transaction hash');
      if (typeof signature !== 'string' || !SIGNATURE.test(signature)) throw new PriorSealError('CLAIM_INVALID_REQUEST', 'A self-serve claim requires a 65-byte EIP-191 signature');
      const normalizedTx = txHash.toLowerCase();
      const message = selfserveClaimMessage(config.payTo, normalizedTx);
      let payer: string;
      try {
        const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
        payer = recovered.toLowerCase();
      } catch {
        throw new PriorSealError('CLAIM_SIGNATURE_INVALID', 'The claim signature does not verify under the claimed transaction hash');
      }
      const transaction = await readClaimedTransaction(normalizedTx);
      if (transaction.to !== config.usdcAddress) throw new PriorSealError('CLAIM_TX_NOT_ACCEPTED', 'The claimed transaction must be a USDC transfer on Base mainnet');
      const calldata = transferCalldataOrThrow(transaction.input);
      if (decodeTransferRecipient(calldata) !== config.payTo) throw new PriorSealError('CLAIM_TX_NOT_ACCEPTED', 'The claimed transfer must pay the deployment payTo address');
      if (transaction.from !== payer) throw new PriorSealError('CLAIM_TX_SENDER_MISMATCH', 'The claimed transaction was not sent by the signing wallet');
      await assertTransferSucceeded(normalizedTx);
      const amountRaw = decodeTransferAmount(calldata);
      if (amountRaw < config.minRawUnits) throw new PriorSealError('CLAIM_BELOW_MINIMUM', `The claimed transfer is below the ${minPayUsd} USD minimum`);
      const credits = amountRaw / config.rawUnitsPerCredit;
      if (credits < 1n) throw new PriorSealError('CLAIM_BELOW_MINIMUM', `The claimed transfer converts to less than one credit at ${creditUnitUsdLabel(config.rawUnitsPerCredit)} USD per credit`);
      const accountId = `selfserve-${payer.slice(2, 10)}`;
      const credential = credentialFor(accountId);
      const credentialDigest = createHash('sha256').update(credential, 'utf8').digest('hex');
      // A freshly created account seeds at zero; every credit, including the
      // first payment, is granted through one idempotent credit operation, so
      // the durable ledger alone proves exactly what each transfer funded.
      const createAccount = !await store.getAgentMeterAccount(accountId);
      if (createAccount) {
        const created = await store.createAgentMeterAccount({ accountId, credentialHash: credentialDigest, provisionedCredits: '0', status: 'active' });
        if (!created && !await store.findAgentMeterAccountByCredentialHash(credentialDigest)) {
          throw new PriorSealError('CLAIM_ACCOUNT_PREEXISTING', 'An account already exists for this payer with an operator-issued credential; contact the operator to receive it');
        }
      } else if (!await store.findAgentMeterAccountByCredentialHash(credentialDigest)) {
        // A pre-existing account for this payer was issued by the operator with
        // a random credential; its secret cannot be reconstructed here.
        throw new PriorSealError('CLAIM_ACCOUNT_PREEXISTING', 'An account already exists for this payer with an operator-issued credential; contact the operator to receive it');
      }
      const state = await requireAccount(accountId);
      if (state.status !== 'active') throw new PriorSealError('CLAIM_ACCOUNT_REVOKED', 'The self-serve account for this payer has been revoked');
      const operation = { operationId: creditOperationId(accountId, normalizedTx), accountId, requestKey: `usdcpay-${normalizedTx}`, credits: String(credits), reference: `selfserve-claim-${normalizedTx.slice(2, 18)}`, creditedAt: now() };
      const credited = await store.creditAgentMeterAccount(operation);
      if (!credited) throw new PriorSealError('CLAIM_ACCOUNT_REVOKED', 'The self-serve account for this payer is unavailable');
      return { status: createAccount && !credited.replay ? 'created' : 'credited', replay: credited.replay, accountId, account: credited.account, credential, credits: String(credits), txHash: normalizedTx };
    },
  };

  async function readClaimedTransaction(txHash: string): Promise<{ to: string; from: string; input: string | null }> {
    const tx = await rpcAgainstChain<{ to: string | null; from: string | null; input: string | null } | null>('eth_getTransactionByHash', [txHash]);
    if (!tx || !tx.to || !tx.from || !ADDRESS.test(tx.to) || !ADDRESS.test(tx.from)) {
      throw new PriorSealError('CLAIM_TX_NOT_FOUND', 'The claimed transaction does not exist on Base mainnet');
    }
    return { to: tx.to.toLowerCase(), from: tx.from.toLowerCase(), input: tx.input };
  }

  function transferCalldataOrThrow(input: string | null): string {
    // An exact ERC-20 transfer calldata is the 4-byte selector plus two 32-byte words.
    if (!input || !input.startsWith(`0x${TRANSFER_SELECTOR}`) || input.length !== 10 + 128) {
      throw new PriorSealError('CLAIM_TX_NOT_ACCEPTED', 'The claimed transaction must be a USDC transfer on Base mainnet');
    }
    return input;
  }

  function decodeTransferRecipient(input: string): string {
    const recipient = `0x${input.slice(10, 74).slice(24)}`;
    if (!ADDRESS.test(recipient) || /^0x0{40}$/.test(recipient)) throw new PriorSealError('CLAIM_TX_NOT_ACCEPTED', 'The claimed transfer recipient is invalid');
    return recipient.toLowerCase();
  }

  function decodeTransferAmount(input: string): bigint {
    try { return BigInt(`0x${input.slice(74, 138)}`); } catch { return 0n; }
  }

  async function assertTransferSucceeded(txHash: string): Promise<void> {
    const receipt = await rpcAgainstChain<{ status: string } | null>('eth_getTransactionReceipt', [txHash]);
    if (!receipt || receipt.status !== '0x1') throw new PriorSealError('CLAIM_TX_FAILED', 'The claimed transaction has not succeeded on Base mainnet');
  }

  async function rpcAgainstChain<T>(method: string, params: unknown[]): Promise<T> {
    const urls = rpcUrls(config.chainId);
    if (!urls.length) throw new PriorSealError('CLAIM_CHAIN_UNAVAILABLE', 'No Base mainnet RPC endpoint is configured');
    let lastError: unknown;
    for (const url of urls) {
      try { return await rpc.call<T>(url, method, params); } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new PriorSealError('CLAIM_CHAIN_UNAVAILABLE', 'Base mainnet RPC endpoint failed');
  }

  async function requireAccount(accountId: string): Promise<AgentMeterAccountState> {
    const state = await store.getAgentMeterAccount(accountId);
    if (!state) throw new PriorSealError('CLAIM_ACCOUNT_PREEXISTING', 'The self-serve account state is unavailable');
    return state;
  }
}

function creditOperationId(accountId: string, txHash: string): string {
  return `aco_${createHash('sha256').update(JSON.stringify({ accountId, requestKey: `usdcpay-${txHash}` }), 'utf8').digest('hex').slice(0, 32)}`;
}

function creditUnitUsdLabel(rawUnitsPerCredit: bigint): string {
  // rawUnitsPerCredit = 10^(6 - fractionDigits) for a decimal USD unit label.
  const digits = USDC_RAW_DECIMALS - BigInt(rawUnitsPerCredit.toString().length - 1);
  return digits > 0n ? `0.${'0'.repeat(Number(digits) - 1)}1` : '1';
}

function formatUsd(rawUnits: bigint): string {
  const scale = 10n ** USDC_RAW_DECIMALS;
  const whole = rawUnits / scale;
  let fraction = (rawUnits % scale).toString().padStart(6, '0').replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `${whole}.${fraction}`;
}
