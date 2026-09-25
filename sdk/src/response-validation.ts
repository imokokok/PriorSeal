const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

function invalid(path: string): never {
  throw new TypeError(`PriorSeal API returned an invalid response for ${path}`)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string' && value[key] !== ''
}

function safeJson(value: unknown, path: string, depth = 0): void {
  if (depth > 64) invalid(path)
  if (Array.isArray(value)) { for (const entry of value) safeJson(entry, path, depth + 1); return }
  if (!record(value)) { if (typeof value === 'number' && !Number.isFinite(value)) invalid(path); return }
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) invalid(path)
    safeJson(entry, path, depth + 1)
  }
}

function observation(value: unknown): boolean {
  return record(value) && hasString(value, 'status') && hasString(value, 'txHash')
}

function receipt(value: unknown): boolean {
  return record(value) && hasString(value, 'receiptId') && record(value.execution)
}

function job(value: unknown): boolean {
  return record(value) && hasString(value, 'jobId') && hasString(value, 'state') && (value.input === undefined || record(value.input))
}

function archiveItem(value: unknown): boolean {
  return record(value) && hasString(value, 'id') && hasString(value, 'kind') && hasString(value, 'artifactHash') && hasString(value, 'status') && Number.isSafeInteger(value.createdAt)
}

/** Validate untrusted wire data before a typed client or console consumes it. */
export function validatePriorSealResponse(path: string, value: unknown): void {
  safeJson(value, path)
  const route = path.split('?')[0]
  if (!record(value)) invalid(path)
  if (route === '/health/live' || route === '/health/ready') {
    if (!hasString(value, 'status')) invalid(path)
  } else if (route === '/v1/version') {
    if (!hasString(value, 'service') || !hasString(value, 'version') || !Array.isArray(value.protocol)) invalid(path)
  } else if (route === '/v1/capabilities') {
    if (value.schema !== 'priorseal.capabilities.v1' || !hasString(value, 'issuer') || !hasString(value, 'audience') || !Array.isArray(value.executionProfiles) || !Array.isArray(value.chains) || !Array.isArray(value.authorizers) || typeof value.workflowReady !== 'boolean') invalid(path)
  } else if (route === '/v1/intents') {
    if (!record(value.intent) || !hasString(value, 'intentHash') || !record(value.policy)) invalid(path)
  } else if (route === '/v1/authorizations/prepare') {
    if (!record(value.authorization) || !hasString(value.authorization, 'authorizationId') || !record(value.typedData)) invalid(path)
  } else if (route === '/v1/authorizations') {
    if (!record(value.authorization) || !record(value.acceptance) || value.acceptance.status !== 'ACCEPTED') invalid(path)
  } else if (route.startsWith('/v1/authorizations/')) {
    if (route.endsWith('/transparency')) {
      if (!record(value.checkpoint)) invalid(path)
    } else if (!record(value.authorization) || !record(value.acceptance)) invalid(path)
  } else if (route === '/v1/executions/observe') {
    if (!observation(value.observation) || (value.receipt != null && !receipt(value.receipt)) || (value.observationJob != null && !job(value.observationJob))) invalid(path)
  } else if (route.startsWith('/v1/observation-jobs/')) {
    if (!job(value)) invalid(path)
  } else if (route === '/v1/receipts/verify') {
    if (!record(value.result) || typeof value.result.valid !== 'boolean' || !hasString(value.result, 'code')) invalid(path)
  } else if (route.startsWith('/v1/receipts/')) {
    if (route.endsWith('/bundle')) {
      if (!receipt(value.receipt) || !record(value.keyRegistry)) invalid(path)
    } else if (!receipt(value)) invalid(path)
  } else if (route === '/.well-known/priorseal-keys.json') {
    if (!Array.isArray(value.keys)) invalid(path)
  } else if (route === '/v1/archive' || route === '/v1/archive/export') {
    if (Array.isArray(value.items)) {
      if (!value.items.every(archiveItem) || !hasString(value, 'projectId') || !hasString(value, 'environment')) invalid(path)
    } else if (!archiveItem(value)) invalid(path)
  } else if (route.startsWith('/v1/archive/')) {
    if (!archiveItem(value) || !('artifact' in value)) invalid(path)
  } else {
    invalid(path)
  }
}
