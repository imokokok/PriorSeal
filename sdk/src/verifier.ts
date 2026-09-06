import type { KeyEntry, KeyRegistry, Receipt, VerificationResult } from './types.js'
import {
  verifyReceiptOffline as verifyWithTrustedKey,
  verifyTimestampProofOffline as verifyTimestamp,
} from './verifier-core.js'

export type TimestampProofResult = { status: 'VALID' | 'INVALID' | 'MISSING' | 'NOT_REQUIRED'; code: string }

export function verifyReceiptOffline(receipt: Receipt, key: KeyEntry, now?: number): Promise<VerificationResult> {
  return verifyWithTrustedKey(receipt, key, now)
}

export function verifyTimestampProofOffline(receipt: Receipt): Promise<TimestampProofResult> {
  return verifyTimestamp(receipt)
}

export type ExternalVerificationRequirement =
  | { type: 'ERC1271'; chainId: number; address: string }
  | { type: 'EVM_ANCHOR'; chainId: number; contract: string; txHash: string; blockNumber: number }

export type LocalVerificationResult = VerificationResult & {
  verificationScope: 'LOCAL_COMPLETE' | 'EXTERNAL_CHECK_REQUIRED'
  requiredExternalChecks: ExternalVerificationRequirement[]
}

export type LocalVerifierOptions = {
  trustedKeys?: KeyEntry | readonly KeyEntry[] | KeyRegistry
  now?: number
}

export async function verifyReceiptLocally(receipt: Receipt, options: LocalVerifierOptions = {}): Promise<LocalVerificationResult> {
  const requiredExternalChecks = externalRequirements(receipt)
  const key = resolveTrustedKey(receipt, options.trustedKeys)
  const result = key
    ? await verifyWithTrustedKey(receipt, key, options.now ?? Math.floor(Date.now() / 1000))
    : { valid: false, code: 'UNKNOWN_KEY', outcome: receipt?.outcome, receiptId: receipt?.receiptId }
  return {
    ...result,
    verificationScope: requiredExternalChecks.length ? 'EXTERNAL_CHECK_REQUIRED' : 'LOCAL_COMPLETE',
    requiredExternalChecks,
  }
}

export function verifyTimestampProofLocally(receipt: Receipt): Promise<TimestampProofResult> {
  return verifyTimestampProofOffline(receipt)
}

function resolveTrustedKey(receipt: Receipt, source?: KeyEntry | readonly KeyEntry[] | KeyRegistry) {
  const keys: readonly KeyEntry[] = !source
    ? []
    : Array.isArray(source)
      ? source as readonly KeyEntry[]
      : 'keys' in source
        ? source.keys as readonly KeyEntry[]
        : [source as KeyEntry]
  return keys.find((key) => key.keyId === receipt?.keyId && key.issuer === receipt?.issuer)
}

function externalRequirements(receipt: Receipt): ExternalVerificationRequirement[] {
  const requirements: ExternalVerificationRequirement[] = []
  const authorization = receipt?.authorizationEvidence?.authorization
  if (authorization?.authorizer.type === 'eip1271') {
    requirements.push({
      type: 'ERC1271',
      chainId: Number(authorization.intent.chainId),
      address: authorization.authorizer.address,
    })
  }
  const anchor = receipt?.authorizationEvidence?.transparency?.checkpoint.anchor
  if (anchor) {
    requirements.push({
      type: 'EVM_ANCHOR',
      chainId: anchor.chainId,
      contract: anchor.contract,
      txHash: anchor.txHash,
      blockNumber: anchor.blockNumber,
    })
  }
  return requirements
}
