import { PriorSealClient } from './client.js'

export type SelfserveClaimCapabilities = {
  configured: true
  method: 'POST'
  path: string
  chainId: number
  asset: string
  payTo: string
  minPayUsd: string
  creditUnitUsd: string
}

export type SelfServeTopupPayer = {
  /** Send exactly `request.amountUsdc` of `request.asset` to `request.payTo` on `request.chainId` and resolve with the funded transaction hash. */
  transfer: (request: { payTo: string; asset: string; chainId: number; amountUsdc: string }) => Promise<{ txHash: string }>
  /** Sign the EIP-191 claim message with the same wallet that sent the transfer. */
  signMessage: (message: string) => Promise<string>
}

export type SelfServeTopupResult = {
  accountId: string
  account: { accountId: string; provisionedCredits: string; remainingCredits: string; status: string }
  credential: string
  credits: string
  txHash: string
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

/** The exact message format the deployment expects; commit it to a test vector so drift fails loudly. */
export function selfServeClaimMessage(payTo: string, txHash: string): string {
  return `priorseal-selfserve-claim-v1:${payTo.toLowerCase()}:${txHash.toLowerCase()}`
}

/**
 * One-call self-serve funding: transfer USDC to the deployment payTo, prove
 * payer-wallet ownership with an EIP-191 signature, and receive a meter
 * account with payment-backed credits plus its one-time credential.
 *
 * The transfer callback is called exactly once and its transaction hash is
 * reused across claim retries; the signature is bound to that hash, so a
 * retried claim can never be claimed by a different wallet.
 */
export async function selfServeTopup(input: {
  client: PriorSealClient
  payer: SelfServeTopupPayer
  amountUsdc: string
  /** Claim attempts while the transfer propagates to the deployment RPC. */
  retries?: number
  retryDelayMs?: number
  signal?: AbortSignal
}): Promise<SelfServeTopupResult> {
  const { client, payer, amountUsdc, retries = 3, retryDelayMs = 1_000, signal } = input
  if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(amountUsdc) || Number(amountUsdc) <= 0) throw new TypeError('amountUsdc must be a positive decimal with at most 6 fraction digits')
  const capabilities = await client.capabilities({ signal })
  const claim = capabilities.payments?.selfserveClaim
  if (!claim || !claim.configured) throw new Error('This deployment does not enable self-serve funding claims')
  if (Number(amountUsdc) < Number(claim.minPayUsd)) throw new Error(`amountUsdc ${amountUsdc} is below the deployment minimum ${claim.minPayUsd}`)
  const { txHash } = await payer.transfer({ payTo: claim.payTo, asset: claim.asset, chainId: claim.chainId, amountUsdc })
  if (!TX_HASH.test(txHash)) throw new TypeError('payer.transfer must resolve with a 32-byte transaction hash')
  const signature = await payer.signMessage(selfServeClaimMessage(claim.payTo, txHash))
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error('Self-serve topup aborted')
    try {
      const result = await client.selfServeClaim({ txHash, signature }, { signal })
      return { accountId: result.account.accountId, account: result.account, credential: result.credential, credits: result.credits, txHash: result.txHash }
    } catch (error) {
      lastError = error
      const code = (error as { code?: string }).code
      // The transfer may not be visible to the deployment RPC yet; only an
      // unseen transaction is worth retrying. Every other outcome is final.
      if (code !== 'CLAIM_TX_NOT_FOUND' || attempt === retries) break
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, retryDelayMs)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('Self-serve topup aborted')) }, { once: true })
      })
    }
  }
  throw lastError
}
