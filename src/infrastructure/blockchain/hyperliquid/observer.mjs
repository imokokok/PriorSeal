// Generated from observer.mts by npm run core:build. Do not edit directly.
import { normalizeExecution } from "../../../domain/execution.mjs";
import { hashJson } from "../../../domain/hashing.mjs";
import { HYPERLIQUID_MAINNET_CHAIN_REF, hyperliquidTerminalDisposition, normalizeHyperliquidSpotIocExecution } from "../../../domain/hyperliquid.mjs";
const CONSERVATIVE_FILL_PAGE_LIMIT = 500;
const MAX_FILL_PAGES = 100;
const ORDER_TIMESTAMP_SKEW_MS = 6e4;
async function observeHyperliquidSpotIoc({ txHash, order, nonce, user, infoUrl = "https://api.hyperliquid.xyz/info", fetcher = fetch, now = () => Date.now(), signal, metrics }) {
  const status = await postInfo(infoUrl, { type: "orderStatus", user, oid: order.clientOrderId }, "order_status", fetcher, signal, metrics);
  const endpointHash = hashJson(infoUrl);
  const baseEvidence = (observedAtMillis, fills = null) => ({
    schema: "priorseal.hyperliquid-info-observation.v1",
    endpointHash,
    orderStatusRequestHash: status.requestHash,
    orderStatusResponseHash: status.responseHash,
    fillRequestHashes: fills?.evidence.fillRequestHashes ?? [],
    fillResponseHashes: fills?.evidence.fillResponseHashes ?? [],
    fillPageCount: fills?.evidence.fillPageCount ?? 0,
    fillResponseCount: fills?.evidence.fillResponseCount ?? 0,
    relevantFillCount: fills?.evidence.relevantFillCount ?? 0,
    fillsComplete: fills?.complete ?? false,
    observedAtMillis
  });
  if (status.value.status === "unknownOid") return pending(txHash, user, order, nonce, now, baseEvidence(now()));
  const result = status.value.order;
  const rawOrder = result?.order;
  const disposition = hyperliquidTerminalDisposition(result?.status);
  if (!result || !rawOrder || !disposition) return pending(txHash, user, order, nonce, now, baseEvidence(now()));
  const statusTimestamp = positiveTimestamp(result.statusTimestamp, "statusTimestamp");
  const orderTimestamp = positiveTimestamp(rawOrder.timestamp, "order.timestamp");
  const orderId = uintString(rawOrder.oid, "order.oid");
  if (!matchesAuthorizedOrder(rawOrder, order, nonce, orderTimestamp)) return terminalMismatch(txHash, user, order, nonce, statusTimestamp, now, baseEvidence(now()));
  const windowStart = Math.max(0, Math.min(Number(nonce), orderTimestamp) - ORDER_TIMESTAMP_SKEW_MS);
  const windowEnd = Math.max(orderTimestamp, statusTimestamp);
  const collection = await collectFills({ infoUrl, user, orderId, order, windowStart, windowEnd, fetcher, signal, metrics });
  const evidence = baseEvidence(now(), collection);
  if (!collection.complete) return pending(txHash, user, order, nonce, now, evidence);
  const filledSize = sumDecimals(collection.fills.map((fill) => fill.sz));
  const aggregate = weightedAverage(collection.fills);
  const fee = collection.fills.length ? sumDecimals(collection.fills.map((fill) => fill.fee)) : null;
  if (disposition === "FILLED" && compareDecimal(filledSize, order.size) < 0) return pending(txHash, user, order, nonce, now, evidence);
  if (disposition === "FILLED" && filledSize !== order.size) return terminalMismatch(txHash, user, order, nonce, statusTimestamp, now, evidence);
  if (disposition === "REJECTED" && compareDecimal(filledSize, "0") !== 0) return terminalMismatch(txHash, user, order, nonce, statusTimestamp, now, evidence);
  if (aggregate && !priceWithinLimit(aggregate, order)) return terminalMismatch(txHash, user, order, nonce, statusTimestamp, now, evidence);
  const canonical = normalizeHyperliquidSpotIocExecution({ ...order, orderId, orderStatus: result.status, filledSize, averagePrice: aggregate?.display ?? null, fee, statusTimestamp });
  const filled = compareDecimal(canonical.filledSize, "0") > 0;
  const observation = normalizeExecution({
    chainId: 0,
    chainRef: HYPERLIQUID_MAINNET_CHAIN_REF,
    txHash,
    status: filled ? "CONFIRMED" : "REVERTED",
    executedAt: Math.floor(canonical.statusTimestamp / 1e3),
    observedAt: Math.floor(now() / 1e3),
    action: "HYPERLIQUID_SPOT_IOC_ORDER",
    nonce,
    sender: user,
    recipient: user,
    asset: `hyperliquid:mainnet/spot:${order.assetId}`,
    amount: "0",
    hyperliquidOrder: canonical,
    hyperliquidInfoObservation: evidence,
    executionDataAvailable: true,
    observationSource: "hyperliquid-info:orderStatus+userFillsByTime:paginated",
    finalityState: "CONFIRMED",
    confirmations: 1
  });
  metrics?.count?.("hyperliquid_observation", { operation: "terminal", outcome: String(observation.status).toLowerCase() });
  return observation;
}
async function collectFills({ infoUrl, user, orderId, order, windowStart, windowEnd, fetcher, signal, metrics }) {
  let cursor = windowStart, responseCount = 0;
  const requestHashes = [], responseHashes = [];
  const fills = /* @__PURE__ */ new Map();
  const evidence = (complete) => ({ fillRequestHashes: requestHashes, fillResponseHashes: responseHashes, fillPageCount: requestHashes.length, fillResponseCount: responseCount, relevantFillCount: fills.size, fillsComplete: complete });
  for (let page = 0; page < MAX_FILL_PAGES; page += 1) {
    const response = await postInfo(infoUrl, { type: "userFillsByTime", user, startTime: cursor, endTime: windowEnd, aggregateByTime: false }, "user_fills_by_time", fetcher, signal, metrics);
    requestHashes.push(response.requestHash);
    responseHashes.push(response.responseHash);
    if (!Array.isArray(response.value)) throw new TypeError("Hyperliquid userFillsByTime response must be an array");
    responseCount += response.value.length;
    let pageLastTimestamp = 0;
    for (const entry of response.value) {
      const timestamp = fillTimestamp(entry);
      pageLastTimestamp = Math.max(pageLastTimestamp, timestamp);
      if (String(entry.oid ?? "") !== orderId) continue;
      const fill = parseRelevantFill(entry, order, orderId, windowStart, windowEnd);
      const previous = fills.get(fill.tid);
      if (previous && canonicalFill(previous) !== canonicalFill(fill)) throw new TypeError("Hyperliquid returned conflicting records for one fill id");
      fills.set(fill.tid, fill);
    }
    if (response.value.length < CONSERVATIVE_FILL_PAGE_LIMIT) return { fills: [...fills.values()], complete: true, evidence: evidence(true) };
    if (pageLastTimestamp <= cursor || pageLastTimestamp >= windowEnd) return { fills: [...fills.values()], complete: false, evidence: evidence(false) };
    cursor = pageLastTimestamp;
  }
  return { fills: [...fills.values()], complete: false, evidence: evidence(false) };
}
function parseRelevantFill(value, order, orderId, windowStart, windowEnd) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Hyperliquid fill is invalid");
  const input = value;
  const time = fillTimestamp(input);
  if (time < windowStart || time > windowEnd || uintString(input.oid, "fill.oid") !== orderId) throw new TypeError("Hyperliquid fill falls outside its observed order window");
  if (input.coin !== `@${order.assetId - 1e4}` || input.side !== (order.isBuy ? "B" : "A")) throw new TypeError("Hyperliquid fill does not match the authorized market or side");
  return { oid: orderId, px: decimal(input.px, "fill.px"), sz: positiveDecimal(input.sz, "fill.sz"), fee: decimal(input.fee, "fill.fee"), time, coin: input.coin, side: input.side, tid: uintString(input.tid, "fill.tid") };
}
function matchesAuthorizedOrder(rawOrder, order, nonce, orderTimestamp) {
  const nonceMillis = Number(nonce);
  return rawOrder.coin === `@${order.assetId - 1e4}` && rawOrder.side === (order.isBuy ? "B" : "A") && decimal(rawOrder.limitPx, "order.limitPx") === order.limitPrice && decimal(rawOrder.origSz, "order.origSz") === order.size && rawOrder.reduceOnly === false && rawOrder.tif === "Ioc" && String(rawOrder.cloid ?? "").toLowerCase() === order.clientOrderId && orderTimestamp >= nonceMillis - ORDER_TIMESTAMP_SKEW_MS && orderTimestamp <= order.expiresAfter;
}
async function postInfo(infoUrl, body, operation, fetcher, signal, metrics) {
  const started = Date.now();
  try {
    const response = await fetcher(infoUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`Hyperliquid Info endpoint returned HTTP ${response.status}`);
    const value = await response.json();
    metrics?.count?.("hyperliquid_info_request", { operation, outcome: "ok" });
    metrics?.timing?.("hyperliquid_info_request_ms", Date.now() - started, { operation, outcome: "ok" });
    return { value, requestHash: hashJson(body), responseHash: hashJson(value) };
  } catch (error) {
    metrics?.count?.("hyperliquid_info_request", { operation, outcome: "error" });
    metrics?.timing?.("hyperliquid_info_request_ms", Date.now() - started, { operation, outcome: "error" });
    throw error;
  }
}
function terminalMismatch(txHash, user, order, nonce, statusTimestamp, now, hyperliquidInfoObservation) {
  return normalizeExecution({ chainId: 0, chainRef: HYPERLIQUID_MAINNET_CHAIN_REF, txHash, status: "REVERTED", executedAt: Math.floor(statusTimestamp / 1e3), observedAt: Math.floor(now() / 1e3), action: "HYPERLIQUID_SPOT_IOC_ORDER", nonce, sender: user, recipient: user, asset: `hyperliquid:mainnet/spot:${order.assetId}`, amount: "0", hyperliquidInfoObservation, executionDataAvailable: false, observationSource: "hyperliquid-info:orderStatus+userFillsByTime:paginated", finalityState: "CONFIRMED", confirmations: 1 });
}
function pending(txHash, user, order, nonce, now, hyperliquidInfoObservation) {
  return normalizeExecution({ chainId: 0, chainRef: HYPERLIQUID_MAINNET_CHAIN_REF, txHash, status: "PENDING", observedAt: Math.floor(now() / 1e3), action: "HYPERLIQUID_SPOT_IOC_ORDER", nonce, sender: user, recipient: user, asset: `hyperliquid:mainnet/spot:${order.assetId}`, amount: "0", hyperliquidInfoObservation, executionDataAvailable: false, observationSource: "hyperliquid-info:orderStatus+userFillsByTime:paginated", finalityState: "PENDING", confirmations: 0 });
}
function fillTimestamp(value) {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.time) || Number(value.time) <= 0) throw new TypeError("Hyperliquid fill timestamp is invalid");
  return Number(value.time);
}
function positiveTimestamp(value, field) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`Hyperliquid ${field} is invalid`);
  return Number(value);
}
function uintString(value, field) {
  if (!(typeof value === "number" || typeof value === "string") || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new TypeError(`Hyperliquid ${field} is invalid`);
  return String(value);
}
function decimal(value, field) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new TypeError(`Hyperliquid ${field} is invalid`);
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
function positiveDecimal(value, field) {
  const normalized = decimal(value, field);
  if (compareDecimal(normalized, "0") <= 0) throw new TypeError(`Hyperliquid ${field} must be positive`);
  return normalized;
}
function sumDecimals(values) {
  return values.reduce((total, value) => addDecimals(total, value), "0");
}
function addDecimals(left, right) {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const result = BigInt(leftWhole) * factor + BigInt((leftFraction + "0".repeat(scale)).slice(0, scale) || "0") + BigInt(rightWhole) * factor + BigInt((rightFraction + "0".repeat(scale)).slice(0, scale) || "0");
  return formatDecimal(result, scale);
}
function weightedAverage(fills) {
  if (!fills.length) return null;
  const scale = Math.max(...fills.flatMap((fill) => [(fill.sz.split(".")[1] ?? "").length, (fill.px.split(".")[1] ?? "").length]));
  let denominator = 0n;
  let numerator = 0n;
  for (const fill of fills) {
    const size = decimalToScaled(fill.sz, scale);
    const price = decimalToScaled(fill.px, scale);
    denominator += size;
    numerator += size * price;
  }
  if (denominator === 0n) return null;
  const averageScaled = numerator / denominator;
  const display = scale <= 18 ? formatDecimal(averageScaled, scale) : formatDecimal(averageScaled / 10n ** BigInt(scale - 18), 18);
  return { display, numerator, denominator, scale };
}
function priceWithinLimit(aggregate, order) {
  const limit = decimalToScaled(order.limitPrice, aggregate.scale);
  const comparison = aggregate.numerator - aggregate.denominator * limit;
  return order.isBuy ? comparison <= 0n : comparison >= 0n;
}
function decimalToScaled(value, scale) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
}
function formatDecimal(value, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = value / factor;
  const fraction = (value % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function compareDecimal(left, right) {
  const scale = Math.max((left.split(".")[1] ?? "").length, (right.split(".")[1] ?? "").length);
  const difference = decimalToScaled(left, scale) - decimalToScaled(right, scale);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
function canonicalFill(fill) {
  return `${fill.oid}|${fill.px}|${fill.sz}|${fill.fee}|${fill.time}|${fill.coin}|${fill.side}|${fill.tid}`;
}
export {
  observeHyperliquidSpotIoc
};
