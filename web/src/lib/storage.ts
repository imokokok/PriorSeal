import type { Intent, LocalActivity, Receipt, Execution } from '../types'

const key = 'runproof.local-session.v1'
const empty = (): LocalActivity => ({ intents: [], receipts: [], observations: [] })
export function getActivity(): LocalActivity { try { return JSON.parse(localStorage.getItem(key) ?? '') as LocalActivity } catch { return empty() } }
function save(activity: LocalActivity) { localStorage.setItem(key, JSON.stringify(activity)) }
function newest<T>(items: T[], item: T, predicate: (candidate: T) => boolean) { return [item, ...items.filter((candidate) => !predicate(candidate))].slice(0, 50) }
export const session = {
  saveIntent(intent: Intent) { const activity = getActivity(); save({ ...activity, intents: newest(activity.intents, intent, (x) => x.intentId === intent.intentId) }) },
  saveReceipt(receipt: Receipt) { const activity = getActivity(); save({ ...activity, receipts: newest(activity.receipts, receipt, (x) => x.receiptId === receipt.receiptId) }) },
  saveObservation(observation: Execution) { const activity = getActivity(); save({ ...activity, observations: newest(activity.observations, observation, (x) => x.txHash === observation.txHash) }) },
  getActivity
}
