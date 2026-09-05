import type { KeyEntry, Receipt, VerificationResult } from '../types'

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])

function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not valid canonical JSON')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number is not valid canonical JSON')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => {
    if (forbidden.has(key)) throw new TypeError('unsafe canonical JSON key')
    return `${JSON.stringify(key)}:${canonicalize(object[key])}`
  }).join(',')}}`
}

function decodeBase64(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function publicKeyBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  if (!encoded) throw new TypeError('Public key PEM is empty')
  return decodeBase64(encoded)
}

async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyReceiptOffline(receipt: Receipt, key: KeyEntry, now = Math.floor(Date.now() / 1000)): Promise<VerificationResult> {
  const fail = (code: string): VerificationResult => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId })
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return fail('INVALID_RECEIPT')
    if (!receipt.signature) return fail('MISSING_SIGNATURE')
    if (receipt.schema !== 'runproof.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA')
    if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM')
    if (receipt.domain !== 'runproof/execution-receipt/v1') return fail('INVALID_DOMAIN')
    if (!key || key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY')
    if (key.algorithm !== 'Ed25519' || key.status === 'revoked' || key.issuer !== receipt.issuer) return fail('INVALID_KEY')
    if (key.validFrom != null && receipt.issuedAt < key.validFrom) return fail('KEY_NOT_YET_VALID')
    if (key.validUntil != null && receipt.issuedAt > key.validUntil) return fail('KEY_EXPIRED')
    if (receipt.issuedAt > now) return fail('NOT_YET_VALID')
    if (receipt.executionHash !== await hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH')
    const { signature, ...unsigned } = receipt
    const imported = await crypto.subtle.importKey('spki', publicKeyBytes(key.publicKey), { name: 'Ed25519' }, false, ['verify'])
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, imported, decodeBase64(signature), new TextEncoder().encode(canonicalize(unsigned)))
    return valid ? { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId } : fail('INVALID_SIGNATURE')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') return fail('UNSUPPORTED_CRYPTO')
    return fail('INVALID_RECEIPT')
  }
}
