export function createMemoryStore() { const intents = new Map(), receipts = new Map(), observations = new Map(); return {
  async saveIntent(intent) { const existing = intents.get(intent.intentId); if (existing && existing.intentHash !== intent.intentHash) throw new Error('DUPLICATE_INTENT'); intents.set(intent.intentId, intent); return intent; },
  async getIntent(id) { return intents.get(id); }, async saveObservation(value) { observations.set(`${value.chainId}:${value.txHash}`, value); return value; },
  async saveReceipt(value) { receipts.set(value.receiptId, value); return value; }, async getReceipt(id) { return receipts.get(id); },
}; }
