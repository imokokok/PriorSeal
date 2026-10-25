// Generated from hyperliquid.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "./errors.mjs";
import { assertOnlyFields } from "../shared/safe-json.mjs";
import { evmAddress, uintString } from "./values.mjs";
const HYPERLIQUID_MAINNET_CHAIN_REF = "hyperliquid:mainnet";
const HYPERLIQUID_SPOT_IOC_PROFILE = "priorseal.execution-profile.hyperliquid-spot-ioc.v1";
const HYPERLIQUID_SPOT_IOC_ACTION = "HYPERLIQUID_SPOT_IOC_ORDER";
const HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS = 5 * 6e4;
const HYPERLIQUID_OUTCOME_ASSET_ID_MIN = 1e8;
const HYPERLIQUID_TERMINAL_ORDER_STATUSES = [
  "filled",
  "canceled",
  "marginCanceled",
  "vaultWithdrawalCanceled",
  "openInterestCapCanceled",
  "selfTradeCanceled",
  "reduceOnlyCanceled",
  "siblingFilledCanceled",
  "delistedCanceled",
  "liquidatedCanceled",
  "scheduledCancel",
  "rejected",
  "tickRejected",
  "minTradeNtlRejected",
  "perpMarginRejected",
  "reduceOnlyRejected",
  "badAloPxRejected",
  "iocCancelRejected",
  "badTriggerPxRejected",
  "marketOrderNoLiquidityRejected",
  "positionIncreaseAtOpenInterestCapRejected",
  "positionFlipAtOpenInterestCapRejected",
  "tooAggressiveAtOpenInterestCapRejected",
  "openInterestIncreaseRejected",
  "insufficientSpotBalanceRejected",
  "oracleRejected",
  "perpMaxPositionRejected"
];
function normalizeHyperliquidSpotIocOrder(value) {
  const input = assertOnlyFields(value, ["assetId", "isBuy", "limitPrice", "size", "timeInForce", "clientOrderId", "expiresAfter"], "hyperliquidOrder");
  if (!Number.isSafeInteger(input.assetId) || Number(input.assetId) < 1e4 || Number(input.assetId) >= HYPERLIQUID_OUTCOME_ASSET_ID_MIN) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Hyperliquid spot assetId must be a spot-pair integer from 10000 through 99999999");
  if (typeof input.isBuy !== "boolean") throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Hyperliquid isBuy must be a boolean");
  if (input.timeInForce !== "Ioc") throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Only Hyperliquid IOC orders are supported");
  if (typeof input.clientOrderId !== "string" || !/^0x[0-9a-fA-F]{32}$/.test(input.clientOrderId)) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Hyperliquid clientOrderId must be a 16-byte hex cloid");
  if (!Number.isSafeInteger(input.expiresAfter) || Number(input.expiresAfter) <= 0) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Hyperliquid expiresAfter must be a positive millisecond timestamp");
  return {
    assetId: Number(input.assetId),
    isBuy: input.isBuy,
    limitPrice: decimal(input.limitPrice, "limitPrice"),
    size: positiveDecimal(input.size, "size"),
    timeInForce: "Ioc",
    clientOrderId: input.clientOrderId.toLowerCase(),
    expiresAfter: Number(input.expiresAfter)
  };
}
function normalizeHyperliquidSpotIocExecution(value) {
  const input = assertOnlyFields(value, ["assetId", "isBuy", "limitPrice", "size", "timeInForce", "clientOrderId", "expiresAfter", "orderId", "orderStatus", "filledSize", "averagePrice", "fee", "statusTimestamp"], "hyperliquidExecution");
  const order = normalizeHyperliquidSpotIocOrder({
    assetId: input.assetId,
    isBuy: input.isBuy,
    limitPrice: input.limitPrice,
    size: input.size,
    timeInForce: input.timeInForce,
    clientOrderId: input.clientOrderId,
    expiresAfter: input.expiresAfter
  });
  if (!/^(0|[1-9][0-9]*)$/.test(String(input.orderId ?? ""))) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "Hyperliquid orderId must be an unsigned integer");
  const disposition = hyperliquidTerminalDisposition(input.orderStatus);
  if (!disposition) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "Hyperliquid orderStatus is not terminal");
  if (!Number.isSafeInteger(input.statusTimestamp) || Number(input.statusTimestamp) <= 0) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "Hyperliquid statusTimestamp must be a positive millisecond timestamp");
  const filledSize = decimal(input.filledSize, "filledSize");
  const averagePrice = input.averagePrice === null ? null : positiveDecimal(input.averagePrice, "averagePrice");
  const fee = input.fee === null ? null : decimal(input.fee, "fee");
  if (compareDecimal(filledSize, order.size) > 0) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "Hyperliquid filledSize exceeds the authorized order size");
  if (disposition === "FILLED" && compareDecimal(filledSize, order.size) !== 0) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "A filled Hyperliquid order requires complete fill evidence");
  if (disposition === "REJECTED" && compareDecimal(filledSize, "0") !== 0) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "A rejected Hyperliquid order cannot have fills");
  if (compareDecimal(filledSize, "0") === 0 && averagePrice !== null) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "A zero-fill order cannot have an average price");
  if (compareDecimal(filledSize, "0") > 0 && averagePrice === null) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "A nonzero fill requires an average price");
  if (averagePrice !== null && (order.isBuy ? compareDecimal(averagePrice, order.limitPrice) > 0 : compareDecimal(averagePrice, order.limitPrice) < 0)) throw new PriorSealError("INVALID_HYPERLIQUID_EXECUTION", "Hyperliquid fill price exceeds the authorized IOC limit");
  return { ...order, orderId: String(input.orderId), orderStatus: input.orderStatus, filledSize, averagePrice, fee, statusTimestamp: Number(input.statusTimestamp) };
}
function hyperliquidTerminalDisposition(value) {
  if (value === "filled") return "FILLED";
  if (typeof value !== "string" || !HYPERLIQUID_TERMINAL_ORDER_STATUSES.includes(value)) return null;
  return value.endsWith("Rejected") || value === "rejected" ? "REJECTED" : "CANCELED";
}
function normalizeHyperliquidInfoObservationEvidence(value) {
  const input = assertOnlyFields(value, ["schema", "endpointHash", "orderStatusRequestHash", "orderStatusResponseHash", "fillRequestHashes", "fillResponseHashes", "fillPageCount", "fillResponseCount", "relevantFillCount", "fillsComplete", "observedAtMillis"], "hyperliquidInfoObservation");
  const hash = (field) => {
    if (typeof input[field] !== "string" || !/^[0-9a-f]{64}$/.test(input[field])) throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", `Hyperliquid ${field} must be a SHA-256 digest`);
    return input[field];
  };
  const hashes = (field) => {
    if (!Array.isArray(input[field]) || input[field].length > 100 || input[field].some((item) => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item))) throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", `Hyperliquid ${field} must be a bounded digest array`);
    return input[field];
  };
  const count = (field) => {
    if (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0 || Number(input[field]) > 1e6) throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", `Hyperliquid ${field} must be a bounded non-negative integer`);
    return Number(input[field]);
  };
  if (input.schema !== "priorseal.hyperliquid-info-observation.v1") throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", "Unsupported Hyperliquid Info observation evidence schema");
  if (typeof input.fillsComplete !== "boolean") throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", "Hyperliquid fillsComplete must be a boolean");
  if (!Number.isSafeInteger(input.observedAtMillis) || Number(input.observedAtMillis) <= 0) throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", "Hyperliquid observedAtMillis must be a positive millisecond timestamp");
  const fillRequestHashes = hashes("fillRequestHashes");
  const fillResponseHashes = hashes("fillResponseHashes");
  const fillPageCount = count("fillPageCount");
  if (fillRequestHashes.length !== fillResponseHashes.length || fillPageCount !== fillRequestHashes.length) throw new PriorSealError("INVALID_HYPERLIQUID_EVIDENCE", "Hyperliquid fill evidence page counts do not agree");
  return { schema: "priorseal.hyperliquid-info-observation.v1", endpointHash: hash("endpointHash"), orderStatusRequestHash: hash("orderStatusRequestHash"), orderStatusResponseHash: hash("orderStatusResponseHash"), fillRequestHashes, fillResponseHashes, fillPageCount, fillResponseCount: count("fillResponseCount"), relevantFillCount: count("relevantFillCount"), fillsComplete: input.fillsComplete, observedAtMillis: Number(input.observedAtMillis) };
}
function hyperliquidSpotAssetId(asset) {
  const match = /^hyperliquid:mainnet\/spot:([1-9][0-9]*)$/.exec(asset);
  if (!match || Number(match[1]) < 1e4 || Number(match[1]) >= HYPERLIQUID_OUTCOME_ASSET_ID_MIN || !Number.isSafeInteger(Number(match[1]))) throw new PriorSealError("INVALID_ASSET", "asset must be hyperliquid:mainnet/spot:<assetId>");
  return Number(match[1]);
}
function isHyperliquidCloid(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{32}$/.test(value);
}
function hyperliquidCloidReservation(intent) {
  if (intent.executionProfile !== HYPERLIQUID_SPOT_IOC_PROFILE || intent.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF || typeof intent.sender !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(intent.sender) || !isHyperliquidCloid(intent.hyperliquidOrder?.clientOrderId)) return null;
  return { networkRef: HYPERLIQUID_MAINNET_CHAIN_REF, account: intent.sender.toLowerCase(), clientOrderId: intent.hyperliquidOrder.clientOrderId.toLowerCase() };
}
function sameHyperliquidSpotIocOrder(expected, observed) {
  return Boolean(expected && observed && expected.assetId === observed.assetId && expected.isBuy === observed.isBuy && expected.limitPrice === observed.limitPrice && expected.size === observed.size && expected.timeInForce === observed.timeInForce && expected.clientOrderId === observed.clientOrderId && expected.expiresAfter === observed.expiresAfter);
}
function normalizeHyperliquidAccount(value, field) {
  return evmAddress(value, field);
}
function normalizeHyperliquidNonce(value) {
  const nonce = uintString(value, "nonce");
  if (BigInt(nonce) < 1000000000000n || BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", "Hyperliquid nonce must be a safe millisecond timestamp");
  return nonce;
}
function positiveDecimal(value, field) {
  const normalized = decimal(value, field);
  if (compareDecimal(normalized, "0") <= 0) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", `Hyperliquid ${field} must be positive`);
  return normalized;
}
function decimal(value, field) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new PriorSealError("INVALID_HYPERLIQUID_ORDER", `Hyperliquid ${field} must be a non-negative decimal string with at most 18 decimals`);
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function compareDecimal(left, right) {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const asInteger = (whole, fraction) => BigInt(whole) * factor + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  const difference = asInteger(leftWhole, leftFraction) - asInteger(rightWhole, rightFraction);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
export {
  HYPERLIQUID_MAINNET_CHAIN_REF,
  HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS,
  HYPERLIQUID_OUTCOME_ASSET_ID_MIN,
  HYPERLIQUID_SPOT_IOC_ACTION,
  HYPERLIQUID_SPOT_IOC_PROFILE,
  HYPERLIQUID_TERMINAL_ORDER_STATUSES,
  hyperliquidCloidReservation,
  hyperliquidSpotAssetId,
  hyperliquidTerminalDisposition,
  isHyperliquidCloid,
  normalizeHyperliquidAccount,
  normalizeHyperliquidInfoObservationEvidence,
  normalizeHyperliquidNonce,
  normalizeHyperliquidSpotIocExecution,
  normalizeHyperliquidSpotIocOrder,
  sameHyperliquidSpotIocOrder
};
