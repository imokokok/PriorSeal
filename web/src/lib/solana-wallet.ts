import { Transaction, VersionedTransaction } from '@solana/web3.js'

export type BrowserSolanaWallet = {
  publicKey?: { toBase58(): string }
  isPhantom?: boolean
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>
  signMessage(message: Uint8Array): Promise<Uint8Array | { signature: Uint8Array }>
  signTransaction(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>
}

type SolanaWindow = Window & {
  solana?: BrowserSolanaWallet
  phantom?: { solana?: BrowserSolanaWallet }
}

export function installedSolanaWallet(): BrowserSolanaWallet | null {
  const browser = window as SolanaWindow
  return browser.phantom?.solana ?? browser.solana ?? null
}

export function walletAddress(wallet: BrowserSolanaWallet): string {
  const address = wallet.publicKey?.toBase58()
  if (!address) throw new Error('The Solana wallet did not return a public key.')
  return address
}

export function decodeTransaction(transactionBase64: string): Transaction | VersionedTransaction {
  const bytes = base64Bytes(transactionBase64)
  try {
    return VersionedTransaction.deserialize(bytes)
  } catch {
    return Transaction.from(bytes)
  }
}

/** The message bytes must survive wallet signing unchanged. */
export function messageBytes(transaction: Transaction | VersionedTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction ? transaction.message.serialize() : transaction.serializeMessage()
}

export async function serializeTransaction(transaction: Transaction | VersionedTransaction): Promise<Uint8Array> {
  return transaction instanceof VersionedTransaction ? transaction.serialize() : transaction.serialize()
}

export function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export function base64(value: Uint8Array): string {
  let text = ''
  for (const byte of value) text += String.fromCharCode(byte)
  return btoa(text)
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let different = 0
  for (let index = 0; index < left.length; index += 1) different |= left[index]! ^ right[index]!
  return different === 0
}

export async function sendExactSolanaTransaction(rpcUrl: string, transactionBase64: string): Promise<string> {
  const endpoint = new URL(rpcUrl)
  if (endpoint.protocol !== 'https:') throw new Error('Use an HTTPS Solana RPC endpoint.')
  const id = crypto.randomUUID()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'sendTransaction',
      params: [transactionBase64, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 0 }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) throw new Error('The Solana RPC did not return a valid submission response.')
  const result = body as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { message?: unknown } }
  if (result.jsonrpc !== '2.0' || result.id !== id) throw new Error('The Solana RPC response did not match this submission.')
  if (result.error) throw new Error(typeof result.error.message === 'string' ? `Solana RPC rejected the exact transaction: ${result.error.message.slice(0, 240)}` : 'Solana RPC rejected the exact transaction.')
  if (typeof result.result !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result.result)) throw new Error('The Solana RPC did not return a valid transaction signature.')
  return result.result
}
