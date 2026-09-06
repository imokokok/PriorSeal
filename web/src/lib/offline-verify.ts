import type { TimestampProofResult } from 'priorseal-sdk/verifier'
import type { Receipt } from '../types'

export type { TimestampProofResult } from 'priorseal-sdk/verifier'

export async function verifyTimestampProofOffline(receipt: Receipt): Promise<TimestampProofResult> {
  const { verifyTimestampProofLocally } = await import('priorseal-sdk/verifier')
  return verifyTimestampProofLocally(receipt)
}
