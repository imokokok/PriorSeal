import {
  getAddress,
  hashTypedData,
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';

/**
 * HyperCore is not an EVM settlement network.  These identifiers are an
 * explicitly versioned application protocol until a public x402 registry
 * assigns an interoperable HyperCore identifier.
 */
export const HYPERCORE_X402_MAINNET = 'hyperliquid:mainnet' as const;
export const HYPERCORE_X402_TESTNET = 'hyperliquid:testnet' as const;
export const HYPERCORE_X402_NETWORKS = [HYPERCORE_X402_MAINNET, HYPERCORE_X402_TESTNET] as const;
export type HypercoreX402Network = (typeof HYPERCORE_X402_NETWORKS)[number];

export const HYPERCORE_USD_SEND_METHOD = 'hypercore-usd-send' as const;
export const HYPERCORE_USD_SEND_PRIMARY_TYPE = 'HyperliquidTransaction:UsdSend' as const;
export const HYPERCORE_SIGNING_NAME = 'HyperliquidSignTransaction' as const;
export const HYPERCORE_SIGNING_VERSION = '1' as const;
export const HYPERCORE_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** The Core USDC transfer action is deliberately kept as a small allowlist. */
export type HypercoreUsdSendAction = {
  type: 'usdSend';
  hyperliquidChain: 'Mainnet' | 'Testnet';
  signatureChainId: string;
  destination: Address;
  amount: string;
  time: number;
};

export type HypercoreSignature = { r: Hex; s: Hex; v: number };

export type HypercorePaymentRequirement = {
  scheme: 'exact';
  network: HypercoreX402Network;
  amount: string;
  asset: 'USDC';
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: {
    assetTransferMethod: typeof HYPERCORE_USD_SEND_METHOD;
    protocolVersion: '1';
    quoteId: string;
  };
};

export type HypercorePaymentPayload = {
  x402Version: 2;
  accepted: HypercorePaymentRequirement;
  payload: {
    quoteId: string;
    action: HypercoreUsdSendAction;
    signature: HypercoreSignature;
    nonce: number;
  };
};

export type VerifiedHypercorePayment = {
  payer: Address;
  paymentId: Hex;
  actionKey: string;
  action: HypercoreUsdSendAction;
  signature: HypercoreSignature;
};

const USD_SEND_TYPES = {
  [HYPERCORE_USD_SEND_PRIMARY_TYPE]: [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
} as const;

const DECIMAL_USD = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
const HEX = /^0x[0-9a-fA-F]+$/;
const QUOTE_ID = /^[A-Za-z0-9_-]{22,128}$/;

export class HypercorePaymentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'HypercorePaymentError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new HypercorePaymentError('invalid_payload', `${label} has unsupported fields`);
  }
}

function parseAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new HypercorePaymentError('invalid_payload', `${label} must be a 20-byte hexadecimal address`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new HypercorePaymentError('invalid_payload', `${label} has an invalid checksum`);
  }
}

export function parseHypercoreUsdAmount(value: unknown, label = 'amount'): string {
  if (typeof value !== 'string' || !DECIMAL_USD.test(value) || value === '0' || value === '0.0') {
    throw new HypercorePaymentError('invalid_amount', `${label} must be a positive canonical USD decimal with at most 8 places`);
  }
  // A trailing zero makes two different byte representations of the same
  // economic amount. Require one canonical spelling before comparing quotes.
  if (value.includes('.') && value.endsWith('0')) {
    throw new HypercorePaymentError('invalid_amount', `${label} must not contain trailing fractional zeroes`);
  }
  return value;
}

function parseSafeTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HypercorePaymentError('invalid_payload', `${label} must be a non-negative safe integer timestamp`);
  }
  return value;
}

function parseSignatureChainId(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,13}$/.test(value)) {
    throw new HypercorePaymentError('invalid_payload', 'signatureChainId must be a hexadecimal uint53');
  }
  const numeric = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new HypercorePaymentError('invalid_payload', 'signatureChainId must be a positive safe integer');
  }
  return `0x${numeric.toString(16)}`;
}

function parseSignature(value: unknown): HypercoreSignature {
  if (!isRecord(value)) throw new HypercorePaymentError('invalid_signature', 'signature must be an object');
  assertExactKeys(value, ['r', 's', 'v'], 'signature');
  const r = value.r;
  const s = value.s;
  const v = value.v;
  if (typeof r !== 'string' || typeof s !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(r) || !/^0x[0-9a-fA-F]{64}$/.test(s)) {
    throw new HypercorePaymentError('invalid_signature', 'signature r and s must be 32-byte hexadecimal values');
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || ![0, 1, 27, 28].includes(v)) {
    throw new HypercorePaymentError('invalid_signature', 'signature v must be 0, 1, 27, or 28');
  }
  return { r: r.toLowerCase() as Hex, s: s.toLowerCase() as Hex, v };
}

function parseNetwork(value: unknown): HypercoreX402Network {
  if (value === HYPERCORE_X402_MAINNET || value === HYPERCORE_X402_TESTNET) return value;
  throw new HypercorePaymentError('invalid_network', 'unsupported HyperCore payment network');
}

function expectedHyperliquidChain(network: HypercoreX402Network): 'Mainnet' | 'Testnet' {
  return network === HYPERCORE_X402_MAINNET ? 'Mainnet' : 'Testnet';
}

export function parseHypercorePaymentRequirement(value: unknown): HypercorePaymentRequirement {
  if (!isRecord(value)) throw new HypercorePaymentError('invalid_requirement', 'payment requirement must be an object');
  assertExactKeys(value, ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'], 'payment requirement');
  if (value.scheme !== 'exact' || value.asset !== 'USDC') {
    throw new HypercorePaymentError('invalid_requirement', 'only exact Core USDC requirements are supported');
  }
  const network = parseNetwork(value.network);
  const amount = parseHypercoreUsdAmount(value.amount, 'requirement amount');
  const payTo = parseAddress(value.payTo, 'payTo');
  if (typeof value.maxTimeoutSeconds !== 'number' || !Number.isInteger(value.maxTimeoutSeconds) || value.maxTimeoutSeconds < 1 || value.maxTimeoutSeconds > 60) {
    throw new HypercorePaymentError('invalid_requirement', 'maxTimeoutSeconds must be an integer between 1 and 60');
  }
  if (!isRecord(value.extra)) throw new HypercorePaymentError('invalid_requirement', 'requirement extra must be an object');
  assertExactKeys(value.extra, ['assetTransferMethod', 'protocolVersion', 'quoteId'], 'requirement extra');
  if (value.extra.assetTransferMethod !== HYPERCORE_USD_SEND_METHOD || value.extra.protocolVersion !== '1' || typeof value.extra.quoteId !== 'string' || !QUOTE_ID.test(value.extra.quoteId)) {
    throw new HypercorePaymentError('invalid_requirement', 'requirement extra is not a HyperCore USDC quote');
  }
  return {
    scheme: 'exact', network, amount, asset: 'USDC', payTo, maxTimeoutSeconds: value.maxTimeoutSeconds,
    extra: { assetTransferMethod: HYPERCORE_USD_SEND_METHOD, protocolVersion: '1', quoteId: value.extra.quoteId },
  };
}

export function parseHypercorePaymentPayload(value: unknown): HypercorePaymentPayload {
  if (!isRecord(value)) throw new HypercorePaymentError('invalid_payload', 'payment payload must be an object');
  assertExactKeys(value, ['x402Version', 'accepted', 'payload'], 'payment payload');
  if (value.x402Version !== 2) throw new HypercorePaymentError('invalid_payload', 'only x402 version 2 is supported');
  const accepted = parseHypercorePaymentRequirement(value.accepted);
  if (!isRecord(value.payload)) throw new HypercorePaymentError('invalid_payload', 'payment payload body must be an object');
  assertExactKeys(value.payload, ['quoteId', 'action', 'signature', 'nonce'], 'payment payload body');
  if (typeof value.payload.quoteId !== 'string' || value.payload.quoteId !== accepted.extra.quoteId || !QUOTE_ID.test(value.payload.quoteId)) {
    throw new HypercorePaymentError('invalid_payload', 'payment quoteId must match the accepted requirement');
  }
  if (!isRecord(value.payload.action)) throw new HypercorePaymentError('invalid_payload', 'action must be an object');
  assertExactKeys(value.payload.action, ['type', 'hyperliquidChain', 'signatureChainId', 'destination', 'amount', 'time'], 'usdSend action');
  if (value.payload.action.type !== 'usdSend') throw new HypercorePaymentError('invalid_payload', 'action type must be usdSend');
  const action: HypercoreUsdSendAction = {
    type: 'usdSend',
    hyperliquidChain: value.payload.action.hyperliquidChain === 'Mainnet' || value.payload.action.hyperliquidChain === 'Testnet'
      ? value.payload.action.hyperliquidChain
      : (() => { throw new HypercorePaymentError('invalid_payload', 'hyperliquidChain must be Mainnet or Testnet'); })(),
    signatureChainId: parseSignatureChainId(value.payload.action.signatureChainId),
    destination: parseAddress(value.payload.action.destination, 'action destination'),
    amount: parseHypercoreUsdAmount(value.payload.action.amount, 'action amount'),
    time: parseSafeTimestamp(value.payload.action.time, 'action time'),
  };
  const nonce = parseSafeTimestamp(value.payload.nonce, 'nonce');
  if (nonce !== action.time) throw new HypercorePaymentError('invalid_payload', 'nonce must equal action time');
  return {
    x402Version: 2,
    accepted,
    payload: { quoteId: value.payload.quoteId, action, signature: parseSignature(value.payload.signature), nonce },
  };
}

export function createHypercorePaymentRequirement(input: {
  network: HypercoreX402Network;
  amount: string;
  payTo: string;
  quoteId: string;
  maxTimeoutSeconds?: number;
}): HypercorePaymentRequirement {
  const quoteId = input.quoteId;
  if (!QUOTE_ID.test(quoteId)) throw new HypercorePaymentError('invalid_quote', 'quoteId is invalid');
  return {
    scheme: 'exact', network: input.network, amount: parseHypercoreUsdAmount(input.amount), asset: 'USDC',
    payTo: parseAddress(input.payTo, 'payTo'), maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
    extra: { assetTransferMethod: HYPERCORE_USD_SEND_METHOD, protocolVersion: '1', quoteId },
  };
}

function requirementFingerprint(requirement: HypercorePaymentRequirement): string {
  return JSON.stringify({
    scheme: requirement.scheme, network: requirement.network, amount: requirement.amount, asset: requirement.asset,
    payTo: requirement.payTo.toLowerCase(), maxTimeoutSeconds: requirement.maxTimeoutSeconds, extra: requirement.extra,
  });
}

/**
 * Verify every field bound by the Hyperliquid signature and every field bound
 * by the resource quote.  `quoteId` itself is not part of `usdSend`, which is
 * why the facilitator must atomically consume it in durable storage.
 */
export async function verifyHypercorePayment(
  value: unknown,
  expected: HypercorePaymentRequirement,
  now = Date.now(),
): Promise<VerifiedHypercorePayment> {
  const payment = parseHypercorePaymentPayload(value);
  if (requirementFingerprint(payment.accepted) !== requirementFingerprint(expected)) {
    throw new HypercorePaymentError('requirement_mismatch', 'accepted requirement does not match the issued quote');
  }
  const { action, signature, nonce } = payment.payload;
  if (action.hyperliquidChain !== expectedHyperliquidChain(expected.network)) {
    throw new HypercorePaymentError('network_mismatch', 'action Hyperliquid environment does not match the quote');
  }
  if (action.destination !== expected.payTo || action.amount !== expected.amount) {
    throw new HypercorePaymentError('payment_mismatch', 'action destination or amount does not match the quote');
  }
  const age = now - action.time;
  if (age > expected.maxTimeoutSeconds * 1_000 || age < -5_000) {
    throw new HypercorePaymentError('expired_payment', 'signed action is outside the allowed settlement window');
  }
  const signatureChainId = Number.parseInt(action.signatureChainId, 16);
  const yParity: 0 | 1 = signature.v === 1 || signature.v === 28 ? 1 : 0;
  const payer = await recoverTypedDataAddress({
    domain: {
      name: HYPERCORE_SIGNING_NAME,
      version: HYPERCORE_SIGNING_VERSION,
      chainId: signatureChainId,
      verifyingContract: HYPERCORE_ZERO_ADDRESS,
    },
    types: USD_SEND_TYPES,
    primaryType: HYPERCORE_USD_SEND_PRIMARY_TYPE,
    message: {
      hyperliquidChain: action.hyperliquidChain,
      destination: action.destination,
      amount: action.amount,
      time: BigInt(action.time),
    },
    signature: { r: signature.r, s: signature.s, yParity },
  });
  const canonicalPayer = getAddress(payer);
  const paymentId = hashTypedData({
    domain: {
      name: HYPERCORE_SIGNING_NAME,
      version: HYPERCORE_SIGNING_VERSION,
      chainId: signatureChainId,
      verifyingContract: HYPERCORE_ZERO_ADDRESS,
    },
    types: USD_SEND_TYPES,
    primaryType: HYPERCORE_USD_SEND_PRIMARY_TYPE,
    message: {
      hyperliquidChain: action.hyperliquidChain,
      destination: action.destination,
      amount: action.amount,
      time: BigInt(action.time),
    },
  });
  return {
    payer: canonicalPayer,
    paymentId,
    actionKey: `${canonicalPayer.toLowerCase()}:${nonce}`,
    action,
    signature,
  };
}

/** Recreate the only body that may be sent to Hyperliquid's Exchange API. */
export function hyperliquidExchangeRequest(payment: HypercorePaymentPayload) {
  return {
    action: payment.payload.action,
    nonce: payment.payload.nonce,
    signature: payment.payload.signature,
  };
}

export function isHypercoreNetwork(value: string): value is HypercoreX402Network {
  return HYPERCORE_X402_NETWORKS.includes(value as HypercoreX402Network);
}

export function validateHypercoreExchangeUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new HypercorePaymentError('invalid_config', 'Hyperliquid Exchange URL is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.pathname.replace(/\/+$/, '') !== '/exchange' || parsed.search || parsed.hash) {
    throw new HypercorePaymentError('invalid_config', 'Hyperliquid Exchange URL must be an HTTPS /exchange endpoint');
  }
  return parsed.toString();
}

export function isHexSignature(value: string): value is Hex {
  return HEX.test(value) && value.length === 132;
}
