import type { AuthorizationRecord, Intent, LocalActivity, ObservationJob, Receipt, Execution } from '../types'

export type StoragePreference = 'granted' | 'denied'

const key = 'priorseal.local-session.v4'
const previousKeys = ['priorseal.local-session.v3', 'priorseal.local-session.v2', 'priorseal.local-session.v1']
const preferenceKey = 'priorseal.storage-preference.v1'
const preferenceMaxAge = 180 * 24 * 60 * 60 * 1000
export const storagePreferenceEvent = 'priorseal:storage-preference'
export const activityChangeEvent = 'priorseal:activity-change'
export const openStoragePreferencesEvent = 'priorseal:open-storage-preferences'

const empty = (): LocalActivity => ({ intents: [], authorizations: [], receipts: [], observations: [], observationJobs: [] })
let memoryActivity = empty()

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function chain(value: unknown): boolean { return (typeof value === 'number' || typeof value === 'string') && Number.isSafeInteger(Number(value)) && Number(value) > 0 }
function intent(value: unknown): value is Intent {
  return record(value) && text(value.intentId) && chain(value.chainId) && text(value.action) && text(value.asset) && text(value.amount) && text(value.sender) && text(value.recipient) && (value.nonce === undefined || text(value.nonce)) && Number.isSafeInteger(value.validUntil)
}
function observation(value: unknown): value is Execution {
  return record(value) && chain(value.chainId) && (value.txHash === undefined || text(value.txHash)) && text(value.status)
}
function authorization(value: unknown): value is AuthorizationRecord {
  if (!record(value) || !record(value.authorization) || !record(value.acceptance)) return false
  const signed = value.authorization
  return text(signed.authorizationId) && intent(signed.intent) && Number.isSafeInteger(signed.expiresAt) && record(signed.principal) && text(signed.principal.id) && record(signed.authorizer) && text(signed.authorizer.address) && record(signed.delegate) && text(signed.delegate.executor) && Number.isSafeInteger(value.acceptance.acceptedAt) && (value.status === undefined || text(value.status)) && (value.boundTxHash === undefined || value.boundTxHash === null || text(value.boundTxHash))
}
function receipt(value: unknown): value is Receipt {
  if (!record(value) || !text(value.receiptId) || !text(value.schema) || !text(value.issuer) || !text(value.keyId) || !text(value.outcome) || !Number.isSafeInteger(value.issuedAt) || !observation(value.execution) || !Array.isArray(value.reasonCodes) || !value.reasonCodes.every(text) || !record(value.binding) || typeof value.binding.bound !== 'boolean') return false
  if (value.compliance !== undefined && (!record(value.compliance) || !text(value.compliance.status))) return false
  if (value.authorizationEvidence === undefined) return true
  if (!record(value.authorizationEvidence)) return false
  const evidence = value.authorizationEvidence
  if (evidence.timestamp !== undefined && evidence.timestamp !== null && !record(evidence.timestamp)) return false
  if (evidence.transparency !== undefined && evidence.transparency !== null && (!record(evidence.transparency) || !record(evidence.transparency.checkpoint))) return false
  return authorization(evidence)
}
function job(value: unknown): value is ObservationJob {
  return record(value) && text(value.jobId) && text(value.state) && record(value.input) && text(value.input.txHash) && (value.input.chainId === undefined || chain(value.input.chainId)) && Number.isSafeInteger(value.attempts) && Number.isSafeInteger(value.nextAttemptAt) && (value.observation === null || value.observation === undefined || observation(value.observation)) && (value.result === null || value.result === undefined || (record(value.result) && observation(value.result.observation)))
}
function items<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard).slice(0, 50) : []
}

function normalize(value: unknown): LocalActivity {
  if (!record(value)) return empty()
  return {
    intents: items(value.intents, intent),
    authorizations: items(value.authorizations, authorization),
    receipts: items(value.receipts, receipt),
    observations: items(value.observations, observation),
    observationJobs: items(value.observationJobs, job),
  }
}

function readStoredActivity(): LocalActivity {
  try {
    const stored = localStorage.getItem(key) ?? previousKeys.map((candidate) => localStorage.getItem(candidate)).find(Boolean)
    if (!stored) return empty()
    const activity: unknown = JSON.parse(stored)
    return normalize(activity)
  } catch {
    return empty()
  }
}

function persist(activity: LocalActivity) {
  try { localStorage.setItem(key, JSON.stringify(normalize(activity))) } catch { /* Local activity is optional; quota/privacy settings must not break the console. */ }
}

function emit(name: string) {
  window.dispatchEvent(new Event(name))
}

function dedupe<T>(primary: T[], secondary: T[], identifier: (item: T) => string) {
  const seen = new Set<string>()
  return [...primary, ...secondary].filter((item) => {
    const id = identifier(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, 50)
}

function mergeActivity(primary: LocalActivity, secondary: LocalActivity): LocalActivity {
  return {
    intents: dedupe(primary.intents, secondary.intents, (item) => item.intentId),
    authorizations: dedupe(primary.authorizations, secondary.authorizations, (item) => item.authorization.authorizationId),
    receipts: dedupe(primary.receipts, secondary.receipts, (item) => item.receiptId),
    observations: dedupe(primary.observations, secondary.observations, (item) => [item.chainId, item.txHash, item.blockHash, item.observedAt].join(':')),
    observationJobs: dedupe(primary.observationJobs, secondary.observationJobs, (item) => item.jobId),
  }
}

export function getStoragePreference(): StoragePreference | null {
  try {
    const stored = localStorage.getItem(preferenceKey)
    if (!stored) return null
    const value: unknown = JSON.parse(stored)
    if (!record(value) || (value.choice !== 'granted' && value.choice !== 'denied') || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || Date.now() - value.updatedAt > preferenceMaxAge) return null
    return value.choice
  } catch {
    return null
  }
}

export function setStoragePreference(choice: StoragePreference) {
  if (choice === 'denied' && getStoragePreference() === 'granted') memoryActivity = readStoredActivity()
  try { localStorage.setItem(preferenceKey, JSON.stringify({ choice, updatedAt: Date.now() })) } catch { /* The preference is best effort when browser storage is unavailable. */ }
  if (choice === 'granted') {
    const stored = readStoredActivity()
    const merged = mergeActivity(memoryActivity, stored)
    memoryActivity = empty()
    persist(merged)
  }
  emit(storagePreferenceEvent)
  emit(activityChangeEvent)
}
export function hasStoredActivity() {
  const activity = readStoredActivity()
  let hasProfiles = false
  try { const profiles: unknown = JSON.parse(localStorage.getItem('priorseal.trust-profiles.v1') ?? '[]'); hasProfiles = Array.isArray(profiles) && profiles.length > 0 } catch { /* Ignore invalid optional profile storage. */ }
  return hasProfiles || activity.intents.length + activity.authorizations.length + activity.receipts.length + activity.observations.length > 0
}

export function openStoragePreferences() {
  emit(openStoragePreferencesEvent)
}

export function getActivity(): LocalActivity {
  if (getStoragePreference() !== 'granted') return memoryActivity
  const activity = readStoredActivity()
  try {
    if (!localStorage.getItem(key) && previousKeys.some((candidate) => localStorage.getItem(candidate))) persist(activity)
  } catch { /* Migration is best effort. */ }
  return activity
}

function save(activity: LocalActivity) {
  const normalized = normalize(activity)
  if (getStoragePreference() === 'granted') persist(normalized)
  else memoryActivity = normalized
  emit(activityChangeEvent)
}

function newest<T>(items: T[], item: T, predicate: (candidate: T) => boolean) {
  return [item, ...items.filter((candidate) => !predicate(candidate))].slice(0, 50)
}

export const session = {
  saveIntent(intent: Intent) { const activity = getActivity(); save({ ...activity, intents: newest(activity.intents, intent, (item) => item.intentId === intent.intentId) }) },
  saveAuthorization(record: AuthorizationRecord) { const activity = getActivity(); save({ ...activity, authorizations: newest(activity.authorizations, record, (item) => item.authorization.authorizationId === record.authorization.authorizationId) }) },
  saveReceipt(receipt: Receipt) { const activity = getActivity(); if (activity.receipts.some((item) => item.receiptId === receipt.receiptId)) return; save({ ...activity, receipts: newest(activity.receipts, receipt, (item) => item.receiptId === receipt.receiptId) }) },
  saveObservation(observation: Execution) { const activity = getActivity(); save({ ...activity, observations: newest(activity.observations, observation, (item) => item.chainId === observation.chainId && item.txHash === observation.txHash && item.blockHash === observation.blockHash && item.observedAt === observation.observedAt) }) },
  saveObservationJob(job: ObservationJob) { const activity = getActivity(); save({ ...activity, observationJobs: newest(activity.observationJobs, job, (item) => item.jobId === job.jobId) }) },
  export() { return JSON.stringify({ schema: 'priorseal.local-session.v4', exportedAt: new Date().toISOString(), activity: getActivity() }, null, 2) },
  clear() {
    memoryActivity = empty()
    emit('priorseal:trust-clear')
    try { localStorage.removeItem(key); localStorage.removeItem('priorseal.trust-profiles.v1'); previousKeys.forEach((candidate) => localStorage.removeItem(candidate)) } catch { /* Storage is best effort. */ }
    emit(activityChangeEvent)
  },
  getActivity,
}
