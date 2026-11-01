import {
  HypercorePaymentError,
  createHypercorePaymentRequirement,
  hyperliquidExchangeRequest,
  parseHypercorePaymentPayload,
  parseHypercoreUsdAmount,
  type HypercorePaymentPayload,
  type HypercorePaymentRequirement,
  type HypercoreX402Network,
  type VerifiedHypercorePayment,
  verifyHypercorePayment,
} from '../infrastructure/payments/hypercore-x402-protocol.mjs';

export type HypercoreQuoteState = 'QUOTED' | 'VERIFIED' | 'SUBMITTING' | 'SUBMITTED' | 'SUBMIT_UNKNOWN' | 'REJECTED' | 'EXPIRED';

export type HypercoreQuote = {
  quoteId: string;
  merchantId: string;
  resource: string;
  requirement: HypercorePaymentRequirement;
  createdAt: number;
  expiresAt: number;
  state: HypercoreQuoteState;
  paymentId?: string;
  payer?: string;
  settledAt?: number;
  exchangeResponse?: { status: string; response?: { type?: string } };
};

type StoredPayment = {
  quoteId: string;
  payment: HypercorePaymentPayload;
  verified: VerifiedHypercorePayment;
};

export type HypercoreSettlement = {
  success: boolean;
  transaction: string;
  network: HypercoreX402Network;
  errorReason?: 'settlement_pending' | 'payment_rejected' | 'payment_not_verified';
  payer?: string;
  amount?: string;
};

/** Minimal durable-key interface implemented by both a Durable Object and tests. */
export interface HypercorePaymentStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
}

export interface HypercoreExchangeClient {
  submit(request: ReturnType<typeof hyperliquidExchangeRequest>): Promise<unknown>;
}

const quoteKey = (quoteId: string) => `quote:${quoteId}`;
const paymentKey = (paymentId: string) => `payment:${paymentId}`;
const actionKey = (value: string) => `action:${value}`;

function settlementReference(paymentId: string): string {
  return `hcx_${paymentId.slice(2, 34)}`;
}

function isExchangeSuccess(value: unknown): value is { status: 'ok'; response: { type: 'default' } } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = (value as Record<string, unknown>).response;
  return (value as Record<string, unknown>).status === 'ok' &&
    typeof response === 'object' && response !== null && !Array.isArray(response) &&
    (response as Record<string, unknown>).type === 'default';
}

/**
 * The coordinator is intentionally the only component permitted to transition
 * a payment from VERIFIED to SUBMITTING. A worker routes every payment through
 * one globally named Durable Object, so quote consumption and `(payer,time)`
 * replay prevention remain atomic.
 */
export class HypercorePaymentCoordinator {
  constructor(
    private readonly store: HypercorePaymentStore,
    private readonly exchange: HypercoreExchangeClient,
    private readonly now: () => number = Date.now,
  ) {}

  async createQuote(input: {
    quoteId: string;
    merchantId: string;
    resource: string;
    network: HypercoreX402Network;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
  }): Promise<HypercoreQuote> {
    const timestamp = this.now();
    const amount = parseHypercoreUsdAmount(input.amount);
    const requirement = createHypercorePaymentRequirement({
      network: input.network,
      amount,
      payTo: input.payTo,
      quoteId: input.quoteId,
      maxTimeoutSeconds: input.maxTimeoutSeconds,
    });
    const quote: HypercoreQuote = {
      quoteId: input.quoteId,
      merchantId: input.merchantId,
      resource: input.resource,
      requirement,
      createdAt: timestamp,
      expiresAt: timestamp + requirement.maxTimeoutSeconds * 1_000,
      state: 'QUOTED',
    };
    await this.store.transaction(async () => {
      if (await this.store.get<HypercoreQuote>(quoteKey(quote.quoteId))) {
        throw new HypercorePaymentError('duplicate_quote', 'quoteId is already in use');
      }
      await this.store.put(quoteKey(quote.quoteId), quote);
    });
    return quote;
  }

  async verify(paymentInput: unknown, merchantId: string): Promise<{ isValid: true; payer: string; paymentId: string; network: HypercoreX402Network; amount: string } | { isValid: false; invalidReason: string }> {
    try {
      const payment = await this.parseAndVerifyKnownQuote(paymentInput, merchantId);
      await this.store.transaction(async () => {
        const quote = await this.requiredQuote(payment.payment.payload.quoteId);
        if (quote.expiresAt < this.now() && quote.state === 'QUOTED') {
          quote.state = 'EXPIRED';
          await this.store.put(quoteKey(quote.quoteId), quote);
          throw new HypercorePaymentError('expired_quote', 'payment quote has expired');
        }
        const existingAction = await this.store.get<string>(actionKey(payment.verified.actionKey));
        if (existingAction) {
          const existingPayment = await this.store.get<StoredPayment>(paymentKey(existingAction));
          if (existingAction !== payment.verified.paymentId || existingPayment?.quoteId !== quote.quoteId) {
            throw new HypercorePaymentError('replayed_action', 'payer and action timestamp have already been used');
          }
        }
        if (quote.state === 'QUOTED') {
          quote.state = 'VERIFIED';
          quote.paymentId = payment.verified.paymentId;
          quote.payer = payment.verified.payer;
          await this.store.put(quoteKey(quote.quoteId), quote);
          await this.store.put(paymentKey(payment.verified.paymentId), {
            quoteId: quote.quoteId,
            payment: payment.payment,
            verified: payment.verified,
          } satisfies StoredPayment);
          await this.store.put(actionKey(payment.verified.actionKey), payment.verified.paymentId);
          return;
        }
        if (quote.paymentId !== payment.verified.paymentId) {
          throw new HypercorePaymentError('quote_consumed', 'payment quote is already bound to a different action');
        }
        if (!['VERIFIED', 'SUBMITTING', 'SUBMITTED', 'SUBMIT_UNKNOWN'].includes(quote.state)) {
          throw new HypercorePaymentError('quote_unavailable', 'payment quote is not available for verification');
        }
      });
      return {
        isValid: true,
        payer: payment.verified.payer,
        paymentId: payment.verified.paymentId,
        network: payment.payment.accepted.network,
        amount: payment.payment.accepted.amount,
      };
    } catch (error) {
      return { isValid: false, invalidReason: error instanceof HypercorePaymentError ? error.code : 'invalid_payment' };
    }
  }

  async settle(paymentInput: unknown, merchantId: string): Promise<HypercoreSettlement> {
    let payment: { payment: HypercorePaymentPayload; verified: VerifiedHypercorePayment };
    try {
      payment = await this.parseAndVerifyKnownQuote(paymentInput, merchantId);
    } catch {
      return { success: false, transaction: '', network: 'hyperliquid:mainnet', errorReason: 'payment_not_verified' };
    }
    const initial = await this.store.transaction(async () => {
      const quote = await this.requiredQuote(payment.payment.payload.quoteId);
      const stored = await this.store.get<StoredPayment>(paymentKey(payment.verified.paymentId));
      if (!stored || quote.paymentId !== payment.verified.paymentId) {
        return { kind: 'not_verified' as const, quote };
      }
      const settlement: HypercoreSettlement = {
        success: true,
        transaction: settlementReference(payment.verified.paymentId),
        network: quote.requirement.network,
        payer: payment.verified.payer,
        amount: quote.requirement.amount,
      };
      if (quote.state === 'SUBMITTED') return { kind: 'submitted' as const, settlement };
      if (quote.state === 'SUBMIT_UNKNOWN' || quote.state === 'SUBMITTING') {
        return { kind: 'pending' as const, settlement: { ...settlement, success: false, errorReason: 'settlement_pending' as const } };
      }
      if (quote.state !== 'VERIFIED') return { kind: 'rejected' as const, settlement: { ...settlement, success: false, errorReason: 'payment_rejected' as const } };
      quote.state = 'SUBMITTING';
      await this.store.put(quoteKey(quote.quoteId), quote);
      return { kind: 'submit' as const, quote, stored, settlement };
    });

    if (initial.kind === 'submitted' || initial.kind === 'pending' || initial.kind === 'rejected') return initial.settlement;
    if (initial.kind === 'not_verified') {
      return { success: false, transaction: '', network: initial.quote.requirement.network, errorReason: 'payment_not_verified' };
    }

    try {
      const exchangeResponse = await this.exchange.submit(hyperliquidExchangeRequest(initial.stored.payment));
      return await this.store.transaction(async () => {
        const quote = await this.requiredQuote(initial.quote.quoteId);
        if (isExchangeSuccess(exchangeResponse)) {
          quote.state = 'SUBMITTED';
          quote.settledAt = this.now();
          quote.exchangeResponse = exchangeResponse;
          await this.store.put(quoteKey(quote.quoteId), quote);
          return initial.settlement;
        }
        quote.state = 'REJECTED';
        await this.store.put(quoteKey(quote.quoteId), quote);
        return { ...initial.settlement, success: false, errorReason: 'payment_rejected' as const };
      });
    } catch {
      return this.store.transaction(async () => {
        const quote = await this.requiredQuote(initial.quote.quoteId);
        quote.state = 'SUBMIT_UNKNOWN';
        await this.store.put(quoteKey(quote.quoteId), quote);
        return { ...initial.settlement, success: false, errorReason: 'settlement_pending' as const };
      });
    }
  }

  async quote(quoteId: string): Promise<HypercoreQuote | undefined> {
    return this.store.get<HypercoreQuote>(quoteKey(quoteId));
  }

  private async parseAndVerifyKnownQuote(paymentInput: unknown, merchantId: string) {
    // Parsing once before a lookup gives malformed requests no stateful error
    // oracle. Parsing again after quote loading verifies the full exact quote.
    const provisional = parseHypercorePaymentPayload(paymentInput);
    const quote = await this.requiredQuote(provisional.payload.quoteId);
    if (quote.merchantId !== merchantId) {
      throw new HypercorePaymentError('merchant_mismatch', 'merchant does not own the payment quote');
    }
    const verified = await verifyHypercorePayment(paymentInput, quote.requirement, this.now());
    return { payment: provisional, verified };
  }

  private async requiredQuote(quoteId: string): Promise<HypercoreQuote> {
    const quote = await this.store.get<HypercoreQuote>(quoteKey(quoteId));
    if (!quote) throw new HypercorePaymentError('unknown_quote', 'payment quote does not exist');
    return quote;
  }
}
