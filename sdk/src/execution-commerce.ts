import { keccak256, toBytes } from 'viem'

import type { ContextCommitment } from './types.js'

/**
 * A generic, portable commitment for commercial terms that accompany an
 * execution.  It deliberately records terms rather than a payment outcome:
 * venue settlement remains independently observable and reconcilable.
 */
export const EXECUTION_COMMERCE_SCHEMA = 'execution.commerce.v1' as const
export const EXECUTION_COMMERCE_NAMESPACE = 'execution.commerce.v1' as const

export type ExecutionCommerceTerms = {
  schema: typeof EXECUTION_COMMERCE_SCHEMA
  productId: 'verified-execution'
  metering: { preflight: 'C1' | 'C2' | 'C3' | 'C4'; observation: 'C1' | 'C2' | 'C3' | 'C4'; evidenceExport: 'C1' | 'C2' | 'C3' | 'C4' }
  venueFee: {
    kind: 'venue-native'
    venue: string
    beneficiary: string
    unit: 'tenths-of-basis-point'
    rate: number
    maximumRate: number
    approval: 'USER_SIGNATURE_REQUIRED_OR_UNVERIFIED'
    settlement: 'VENUE_RECONCILIATION_REQUIRED'
  } | null
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const METERING = new Set(['C1', 'C2', 'C3', 'C4'])

export function normalizeExecutionCommerceTerms(value: ExecutionCommerceTerms): ExecutionCommerceTerms {
  if (!value || value.schema !== EXECUTION_COMMERCE_SCHEMA || value.productId !== 'verified-execution' || !value.metering || !METERING.has(value.metering.preflight) || !METERING.has(value.metering.observation) || !METERING.has(value.metering.evidenceExport)) throw new TypeError('execution commerce terms are invalid')
  if (value.venueFee === null) return { ...value, metering: { ...value.metering }, venueFee: null }
  const fee = value.venueFee
  if (fee.kind !== 'venue-native' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(fee.venue) || !ADDRESS.test(fee.beneficiary) || fee.unit !== 'tenths-of-basis-point' || !Number.isSafeInteger(fee.rate) || !Number.isSafeInteger(fee.maximumRate) || fee.rate < 1 || fee.maximumRate < fee.rate || fee.approval !== 'USER_SIGNATURE_REQUIRED_OR_UNVERIFIED' || fee.settlement !== 'VENUE_RECONCILIATION_REQUIRED') throw new TypeError('execution venue fee terms are invalid')
  return { ...value, metering: { ...value.metering }, venueFee: { ...fee, beneficiary: fee.beneficiary.toLowerCase() } }
}

/** A canonical, signed-intent-safe commitment to the displayed commercial terms. */
export function executionCommerceCommitment(value: ExecutionCommerceTerms): ContextCommitment {
  const terms = normalizeExecutionCommerceTerms(value)
  return {
    namespace: EXECUTION_COMMERCE_NAMESPACE,
    algorithm: 'keccak256',
    digest: keccak256(toBytes(canonicalJson(terms))),
  }
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new TypeError('execution commerce terms are too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('execution commerce terms are not canonical JSON')
  const keys = Object.keys(value).sort()
  if (keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('execution commerce terms contain an unsafe key')
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`
}
