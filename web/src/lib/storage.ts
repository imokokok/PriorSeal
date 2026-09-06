import type { AuthorizationRecord, Intent, LocalActivity, Receipt, Execution } from '../types'

export type StoragePreference = 'granted' | 'denied'

const key = 'priorseal.local-session.v3'
const previousKey = 'priorseal.local-session.v2'
const legacyKey = 'priorseal.local-session.v1'
const preferenceKey = 'priorseal.storage-preference.v1'
const preferenceMaxAge = 180 * 24 * 60 * 60 * 1000
export const storagePreferenceEvent = 'priorseal:storage-preference'
export const activityChangeEvent = 'priorseal:activity-change'
export const openStoragePreferencesEvent = 'priorseal:open-storage-preferences'

const empty = (): LocalActivity => ({ intents: [], authorizations: [], receipts: [], observations: [] })
let memoryActivity = empty()

function valid(value: unknown): value is LocalActivity {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LocalActivity>
  return Array.isArray(item.intents) && Array.isArray(item.receipts) && Array.isArray(item.observations)
}

function normalize(activity: LocalActivity): LocalActivity {
  return {
    intents: activity.intents.slice(0, 50),
    authorizations: Array.isArray(activity.authorizations) ? activity.authorizations.slice(0, 50) : [],
    receipts: activity.receipts.filter((receipt) => typeof receipt?.receiptId === 'string').slice(0, 50),
    observations: activity.observations.slice(0, 50),
  }
}

function readStoredActivity(): LocalActivity {
  try {
    const stored = localStorage.getItem(key) ?? localStorage.getItem(previousKey) ?? localStorage.getItem(legacyKey)
    if (!stored) return empty()
    const activity = JSON.parse(stored)
    return valid(activity) ? normalize(activity) : empty()
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
  }
}

export function getStoragePreference(): StoragePreference | null {
  try {
    const stored = localStorage.getItem(preferenceKey)
    if (!stored) return null
    const record = JSON.parse(stored) as { choice?: unknown; updatedAt?: unknown }
    if ((record.choice !== 'granted' && record.choice !== 'denied') || typeof record.updatedAt !== 'number' || Date.now() - record.updatedAt > preferenceMaxAge) return null
    return record.choice
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
  return activity.intents.length + activity.authorizations.length + activity.receipts.length + activity.observations.length > 0
}

export function openStoragePreferences() {
  emit(openStoragePreferencesEvent)
}

export function getActivity(): LocalActivity {
  if (getStoragePreference() !== 'granted') return memoryActivity
  const activity = readStoredActivity()
  try {
    if (!localStorage.getItem(key) && (localStorage.getItem(previousKey) || localStorage.getItem(legacyKey))) persist(activity)
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
  export() { return JSON.stringify({ schema: 'priorseal.local-session.v3', exportedAt: new Date().toISOString(), activity: getActivity() }, null, 2) },
  clear() {
    memoryActivity = empty()
    try { localStorage.removeItem(key); localStorage.removeItem(previousKey); localStorage.removeItem(legacyKey) } catch { /* Storage is best effort. */ }
    emit(activityChangeEvent)
  },
  getActivity,
}
