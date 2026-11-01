// Generated from coordinator.mts by npm run core:build. Do not edit directly.
import {
  HypercorePaymentError,
  createHypercorePaymentRequirement,
  hyperliquidExchangeRequest,
  parseHypercorePaymentPayload,
  parseHypercoreUsdAmount,
  verifyHypercorePayment
} from "../infrastructure/payments/hypercore-x402-protocol.mjs";
const quoteKey = (quoteId) => `quote:${quoteId}`;
const paymentKey = (paymentId) => `payment:${paymentId}`;
const actionKey = (value) => `action:${value}`;
function settlementReference(paymentId) {
  return `hcx_${paymentId.slice(2, 34)}`;
}
function isExchangeSuccess(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value.response;
  return value.status === "ok" && typeof response === "object" && response !== null && !Array.isArray(response) && response.type === "default";
}
class HypercorePaymentCoordinator {
  constructor(store, exchange, now = Date.now) {
    this.store = store;
    this.exchange = exchange;
    this.now = now;
  }
  async createQuote(input) {
    const timestamp = this.now();
    const amount = parseHypercoreUsdAmount(input.amount);
    const requirement = createHypercorePaymentRequirement({
      network: input.network,
      amount,
      payTo: input.payTo,
      quoteId: input.quoteId,
      maxTimeoutSeconds: input.maxTimeoutSeconds
    });
    const quote = {
      quoteId: input.quoteId,
      merchantId: input.merchantId,
      resource: input.resource,
      requirement,
      createdAt: timestamp,
      expiresAt: timestamp + requirement.maxTimeoutSeconds * 1e3,
      state: "QUOTED"
    };
    await this.store.transaction(async () => {
      if (await this.store.get(quoteKey(quote.quoteId))) {
        throw new HypercorePaymentError("duplicate_quote", "quoteId is already in use");
      }
      await this.store.put(quoteKey(quote.quoteId), quote);
    });
    return quote;
  }
  async verify(paymentInput, merchantId) {
    try {
      const payment = await this.parseAndVerifyKnownQuote(paymentInput, merchantId);
      await this.store.transaction(async () => {
        const quote = await this.requiredQuote(payment.payment.payload.quoteId);
        if (quote.expiresAt < this.now() && quote.state === "QUOTED") {
          quote.state = "EXPIRED";
          await this.store.put(quoteKey(quote.quoteId), quote);
          throw new HypercorePaymentError("expired_quote", "payment quote has expired");
        }
        const existingAction = await this.store.get(actionKey(payment.verified.actionKey));
        if (existingAction) {
          const existingPayment = await this.store.get(paymentKey(existingAction));
          if (existingAction !== payment.verified.paymentId || existingPayment?.quoteId !== quote.quoteId) {
            throw new HypercorePaymentError("replayed_action", "payer and action timestamp have already been used");
          }
        }
        if (quote.state === "QUOTED") {
          quote.state = "VERIFIED";
          quote.paymentId = payment.verified.paymentId;
          quote.payer = payment.verified.payer;
          await this.store.put(quoteKey(quote.quoteId), quote);
          await this.store.put(paymentKey(payment.verified.paymentId), {
            quoteId: quote.quoteId,
            payment: payment.payment,
            verified: payment.verified
          });
          await this.store.put(actionKey(payment.verified.actionKey), payment.verified.paymentId);
          return;
        }
        if (quote.paymentId !== payment.verified.paymentId) {
          throw new HypercorePaymentError("quote_consumed", "payment quote is already bound to a different action");
        }
        if (!["VERIFIED", "SUBMITTING", "SUBMITTED", "SUBMIT_UNKNOWN"].includes(quote.state)) {
          throw new HypercorePaymentError("quote_unavailable", "payment quote is not available for verification");
        }
      });
      return {
        isValid: true,
        payer: payment.verified.payer,
        paymentId: payment.verified.paymentId,
        network: payment.payment.accepted.network,
        amount: payment.payment.accepted.amount
      };
    } catch (error) {
      return { isValid: false, invalidReason: error instanceof HypercorePaymentError ? error.code : "invalid_payment" };
    }
  }
  async settle(paymentInput, merchantId) {
    let payment;
    try {
      payment = await this.parseAndVerifyKnownQuote(paymentInput, merchantId);
    } catch {
      return { success: false, transaction: "", network: "hyperliquid:mainnet", errorReason: "payment_not_verified" };
    }
    const initial = await this.store.transaction(async () => {
      const quote = await this.requiredQuote(payment.payment.payload.quoteId);
      const stored = await this.store.get(paymentKey(payment.verified.paymentId));
      if (!stored || quote.paymentId !== payment.verified.paymentId) {
        return { kind: "not_verified", quote };
      }
      const settlement = {
        success: true,
        transaction: settlementReference(payment.verified.paymentId),
        network: quote.requirement.network,
        payer: payment.verified.payer,
        amount: quote.requirement.amount
      };
      if (quote.state === "SUBMITTED") return { kind: "submitted", settlement };
      if (quote.state === "SUBMIT_UNKNOWN" || quote.state === "SUBMITTING") {
        return { kind: "pending", settlement: { ...settlement, success: false, errorReason: "settlement_pending" } };
      }
      if (quote.state !== "VERIFIED") return { kind: "rejected", settlement: { ...settlement, success: false, errorReason: "payment_rejected" } };
      quote.state = "SUBMITTING";
      await this.store.put(quoteKey(quote.quoteId), quote);
      return { kind: "submit", quote, stored, settlement };
    });
    if (initial.kind === "submitted" || initial.kind === "pending" || initial.kind === "rejected") return initial.settlement;
    if (initial.kind === "not_verified") {
      return { success: false, transaction: "", network: initial.quote.requirement.network, errorReason: "payment_not_verified" };
    }
    try {
      const exchangeResponse = await this.exchange.submit(hyperliquidExchangeRequest(initial.stored.payment));
      return await this.store.transaction(async () => {
        const quote = await this.requiredQuote(initial.quote.quoteId);
        if (isExchangeSuccess(exchangeResponse)) {
          quote.state = "SUBMITTED";
          quote.settledAt = this.now();
          quote.exchangeResponse = exchangeResponse;
          await this.store.put(quoteKey(quote.quoteId), quote);
          return initial.settlement;
        }
        quote.state = "REJECTED";
        await this.store.put(quoteKey(quote.quoteId), quote);
        return { ...initial.settlement, success: false, errorReason: "payment_rejected" };
      });
    } catch {
      return this.store.transaction(async () => {
        const quote = await this.requiredQuote(initial.quote.quoteId);
        quote.state = "SUBMIT_UNKNOWN";
        await this.store.put(quoteKey(quote.quoteId), quote);
        return { ...initial.settlement, success: false, errorReason: "settlement_pending" };
      });
    }
  }
  async quote(quoteId) {
    return this.store.get(quoteKey(quoteId));
  }
  async parseAndVerifyKnownQuote(paymentInput, merchantId) {
    const provisional = parseHypercorePaymentPayload(paymentInput);
    const quote = await this.requiredQuote(provisional.payload.quoteId);
    if (quote.merchantId !== merchantId) {
      throw new HypercorePaymentError("merchant_mismatch", "merchant does not own the payment quote");
    }
    const verified = await verifyHypercorePayment(paymentInput, quote.requirement, this.now());
    return { payment: provisional, verified };
  }
  async requiredQuote(quoteId) {
    const quote = await this.store.get(quoteKey(quoteId));
    if (!quote) throw new HypercorePaymentError("unknown_quote", "payment quote does not exist");
    return quote;
  }
}
export {
  HypercorePaymentCoordinator
};
