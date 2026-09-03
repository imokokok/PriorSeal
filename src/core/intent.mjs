import { hashJson } from './hashing.mjs';
import { RunProofError } from './errors.mjs';

export const INTENT_SCHEMA = 'runproof.intent.v1';
const required = ['intentId', 'chainId', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil'];
export function buildIntent(input) {
  if (!input || required.some((key) => input[key] === undefined || input[key] === null)) throw new RunProofError('INVALID_INTENT', `Missing intent field: ${required.find((key) => input?.[key] == null)}`);
  const chainId = typeof input.chainId === 'string' && /^eip155:\d+$/.test(input.chainId) ? input.chainId : Number(input.chainId);
  if (!(Number.isInteger(chainId) && chainId > 0) && !(typeof chainId === 'string')) throw new RunProofError('INVALID_CHAIN_ID', 'chainId must be a positive integer or eip155:<id>');
  const intent = { schema: INTENT_SCHEMA, intentId: String(input.intentId), chainId, ...(input.chainIds ? { chainIds: [...input.chainIds] } : {}), action: String(input.action), asset: String(input.asset), amount: String(input.amount), sender: String(input.sender).toLowerCase(), recipient: String(input.recipient).toLowerCase(), validUntil: Number(input.validUntil), nonce: String(input.nonce ?? '0'), ...(input.constraints ? { constraints: input.constraints } : {}) };
  if (!Number.isSafeInteger(intent.validUntil) || intent.validUntil <= 0) throw new RunProofError('INVALID_TIME', 'validUntil must be a positive unix timestamp');
  return { ...intent, intentHash: hashJson(intent) };
}
