import type { AuthorizationCheckpoint } from './types.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function account(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function chainId(value: unknown): boolean {
  return (typeof value === 'number' || typeof value === 'string') && Number.isSafeInteger(Number(value)) && Number(value) > 0
}

/** Check imported recovery state before it can be passed to the wallet flow. */
export function parseAuthorizationCheckpoint(value: unknown): AuthorizationCheckpoint {
  if (!record(value) || value.schema !== 'priorseal.authorization-checkpoint.v1' || !['PREPARED', 'SIGNED', 'ACCEPTED'].includes(String(value.stage)) || !account(value.account) || !nonempty(value.acceptIdempotencyKey)) throw new TypeError('Invalid authorization checkpoint')
  if (!record(value.request) || !record(value.prepared)) throw new TypeError('Invalid authorization checkpoint request')
  const request = value.request
  if (!record(request.intent) || !record(request.principal) || !record(request.delegate) || !nonempty(request.principal.id) || !['user', 'organization'].includes(String(request.principal.type)) || !nonempty(request.delegate.agentId) || !account(request.delegate.executor) || (request.account !== undefined && !account(request.account))) throw new TypeError('Invalid authorization checkpoint request')
  const intent = request.intent
  if (!nonempty(intent.intentId) || !chainId(intent.chainId) || !account(intent.sender) || !account(intent.recipient) || !nonempty(intent.action) || !nonempty(intent.asset) || !nonempty(intent.amount) || (intent.nonce !== undefined && !nonempty(intent.nonce)) || !Number.isSafeInteger(intent.validUntil)) throw new TypeError('Invalid authorization checkpoint intent')
  const prepared = value.prepared
  if (!record(prepared.authorization) || !record(prepared.typedData) || !record(prepared.typedData.message)) throw new TypeError('Invalid authorization checkpoint preparation')
  const authorization = prepared.authorization
  if (!nonempty(authorization.authorizationId) || !nonempty(authorization.intentHash) || !nonempty(authorization.audience) || !nonempty(authorization.authorizationNonce) || !Number.isSafeInteger(authorization.issuedAt) || !Number.isSafeInteger(authorization.notBefore) || !Number.isSafeInteger(authorization.expiresAt) || !record(authorization.intent) || !record(authorization.principal) || !record(authorization.authorizer) || !record(authorization.delegate)) throw new TypeError('Invalid authorization checkpoint preparation')
  if ((value.stage === 'PREPARED' && value.signature !== undefined) || (value.stage !== 'PREPARED' && (typeof value.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)))) throw new TypeError('Invalid authorization checkpoint signature state')
  return value as AuthorizationCheckpoint
}
