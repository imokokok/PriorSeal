import type { Intent, LocalActivity, Receipt, Execution } from '../types'

const key = 'runproof.local-session.v2'
const legacyKey = 'runproof.local-session.v1'
const empty = (): LocalActivity => ({ intents: [], receipts: [], observations: [] })
function valid(value: unknown): value is LocalActivity { if (!value || typeof value !== 'object') return false; const item = value as Partial<LocalActivity>; return Array.isArray(item.intents) && Array.isArray(item.receipts) && Array.isArray(item.observations) }
export function getActivity(): LocalActivity {
  try {
    const stored = localStorage.getItem(key) ?? localStorage.getItem(legacyKey); if (!stored) return empty()
    const activity = JSON.parse(stored); if (!valid(activity)) return empty()
    const normalized = { intents: activity.intents.slice(0, 50), receipts: activity.receipts.filter((receipt) => typeof receipt?.receiptId === 'string').slice(0, 50), observations: activity.observations.slice(0, 50) }
    if (!localStorage.getItem(key)) save(normalized); return normalized
  } catch { return empty() }
}
function save(activity: LocalActivity) { try { localStorage.setItem(key, JSON.stringify(activity)) } catch { /* Local activity is optional; quota/privacy settings must not break the console. */ } }
function newest<T>(items: T[], item: T, predicate: (candidate: T) => boolean) { return [item, ...items.filter((candidate) => !predicate(candidate))].slice(0, 50) }
export const session = {
  saveIntent(intent: Intent) { const activity = getActivity(); save({ ...activity, intents: newest(activity.intents, intent, (x) => x.intentId === intent.intentId) }) },
  saveReceipt(receipt: Receipt) { const activity = getActivity(); save({ ...activity, receipts: newest(activity.receipts, receipt, (x) => x.receiptId === receipt.receiptId) }) },
  saveObservation(observation: Execution) { const activity = getActivity(); save({ ...activity, observations: newest(activity.observations, observation, (x) => x.txHash === observation.txHash) }) },
  export() { return JSON.stringify({ schema: 'runproof.local-session.v2', exportedAt: new Date().toISOString(), activity: getActivity() }, null, 2) },
  clear() { try { localStorage.removeItem(key); localStorage.removeItem(legacyKey) } catch { /* Storage is best effort. */ } },
  getActivity
}
