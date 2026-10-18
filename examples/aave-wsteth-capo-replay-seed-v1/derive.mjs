// Generated from derive.mts by npm run core:build. Do not edit directly.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function string(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function integer(value, label) {
  const text = string(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be an unsigned integer string`);
  return BigInt(text);
}
function safeUnsignedNumber(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe unsigned integer`);
  }
  return value;
}
function hexWords(value, label, expectedWords) {
  const hex = string(value, label);
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error(`${label} must be hex`);
  const body = hex.slice(2);
  if (body.length !== expectedWords * 64) throw new Error(`${label} must contain ${expectedWords} ABI words`);
  return Array.from({ length: expectedWords }, (_, index) => BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`));
}
function formatUnits(value, decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
const here = new URL(".", import.meta.url);
const inputUrl = new URL("./observations.json", here);
const source = await readFile(fileURLToPath(inputUrl), "utf8");
const input = JSON.parse(source);
const root = record(input, "observations");
if (root.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
const chain = record(root.chain, "chain");
if (chain.name !== "Ethereum mainnet" || chain.chainId !== 1) throw new Error("unexpected chain identity");
const update = record(root.capUpdate, "capUpdate");
const updateHash = string(update.transactionHash, "capUpdate.transactionHash");
if (!/^0x[0-9a-fA-F]{64}$/.test(updateHash)) throw new Error("capUpdate.transactionHash must be a transaction hash");
if (update.status !== "success") throw new Error("cap update transaction must be successful");
const updateEvent = record(update.event, "capUpdate.event");
if (updateEvent.name !== "CapParametersUpdated") throw new Error("unexpected CAPO event name");
if (string(updateEvent.emitter, "capUpdate.event.emitter").toLowerCase() !== "0xe1d97bf61901b075e9626c8a2340a7de385861ef") {
  throw new Error("unexpected CAPO event emitter");
}
const updateTopics = updateEvent.topics;
if (!Array.isArray(updateTopics) || updateTopics.length !== 1 || typeof updateTopics[0] !== "string") {
  throw new Error("CapParametersUpdated must have exactly one topic");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(updateTopics[0])) throw new Error("CAPO topic0 must be 32 bytes");
if (updateTopics[0].toLowerCase() !== "0x47f15f366dcc3684fc77c4f79eb851bb5befbc095ec7a296a53a27a622964c63") {
  throw new Error("unexpected CapParametersUpdated topic0");
}
const updateWords = hexWords(updateEvent.data, "capUpdate.event.data", 4);
const [snapshotRatio, snapshotTimestamp, emittedGrowthPerSecond, annualGrowthPercent] = updateWords;
const decodedUpdate = record(updateEvent.decoded, "capUpdate.event.decoded");
if (snapshotRatio !== integer(decodedUpdate.snapshotRatio, "snapshotRatio") || snapshotTimestamp !== integer(decodedUpdate.snapshotTimestamp, "snapshotTimestamp") || emittedGrowthPerSecond !== integer(decodedUpdate.maxRatioGrowthPerSecond, "maxRatioGrowthPerSecond") || annualGrowthPercent !== integer(decodedUpdate.maxYearlyRatioGrowthPercent, "maxYearlyRatioGrowthPercent")) {
  throw new Error("decoded CAPO fields do not match the recorded event data");
}
const updateBlockTimestamp = BigInt(safeUnsignedNumber(update.blockTimestamp, "capUpdate.blockTimestamp"));
if (string(update.blockTimestampIso, "capUpdate.blockTimestampIso") !== new Date(Number(updateBlockTimestamp) * 1e3).toISOString()) {
  throw new Error("cap update timestamp does not match its ISO field");
}
const elapsedSeconds = updateBlockTimestamp - snapshotTimestamp;
if (elapsedSeconds <= 0n) throw new Error("snapshot must precede the update block");
const percentageFactor = 10000n;
const scalingFactor = 1000000n;
const secondsPerYear = 365n * 24n * 60n * 60n;
const scaledGrowthPerSecond = snapshotRatio * annualGrowthPercent * scalingFactor / percentageFactor / secondsPerYear;
if (scaledGrowthPerSecond / scalingFactor !== emittedGrowthPerSecond) {
  throw new Error("CAPO growth-rate calculation does not match the emitted event value");
}
const maximumRatio = snapshotRatio + scaledGrowthPerSecond * elapsedSeconds / scalingFactor;
const liquidation = record(root.liquidationExample, "liquidationExample");
const liquidationHash = string(liquidation.transactionHash, "liquidationExample.transactionHash");
if (!/^0x[0-9a-fA-F]{64}$/.test(liquidationHash)) throw new Error("liquidation transactionHash must be a transaction hash");
if (liquidation.status !== "success") throw new Error("liquidation transaction must be successful");
const liquidationEvent = record(liquidation.event, "liquidationExample.event");
if (liquidationEvent.name !== "LiquidationCall") throw new Error("unexpected liquidation event name");
if (string(liquidationEvent.emitter, "liquidationExample.event.emitter").toLowerCase() !== "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2") {
  throw new Error("unexpected Aave V3 Pool emitter");
}
const liquidationData = hexWords(liquidationEvent.data, "liquidationExample.event.data", 4);
const liquidationTopics = liquidationEvent.topics;
if (!Array.isArray(liquidationTopics) || liquidationTopics.length !== 4) {
  throw new Error("LiquidationCall must have topic0 plus three indexed addresses");
}
if (typeof liquidationTopics[0] !== "string" || liquidationTopics[0].toLowerCase() !== "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286") {
  throw new Error("unexpected LiquidationCall topic0");
}
const topicAddress = (value, label) => {
  const topic = string(value, label);
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) throw new Error(`${label} must be a 32-byte topic`);
  return `0x${topic.slice(-40)}`.toLowerCase();
};
const decodedLiquidation = record(liquidationEvent.decoded, "liquidationExample.event.decoded");
const actualCollateral = topicAddress(liquidationTopics[1], "collateral topic");
const actualDebt = topicAddress(liquidationTopics[2], "debt topic");
const actualUser = topicAddress(liquidationTopics[3], "user topic");
if (actualCollateral !== string(decodedLiquidation.collateralAsset, "collateralAsset").toLowerCase() || actualDebt !== string(decodedLiquidation.debtAsset, "debtAsset").toLowerCase() || actualUser !== string(decodedLiquidation.user, "user").toLowerCase() || liquidationData[0] !== integer(decodedLiquidation.debtToCover, "debtToCover") || liquidationData[1] !== integer(decodedLiquidation.liquidatedCollateralAmount, "liquidatedCollateralAmount") || `0x${liquidationData[2].toString(16).padStart(40, "0")}` !== string(decodedLiquidation.liquidator, "liquidator").toLowerCase() || liquidationData[3] !== 0n && liquidationData[3] !== 1n || decodedLiquidation.receiveAToken !== (liquidationData[3] === 1n)) {
  throw new Error("decoded LiquidationCall fields do not match the recorded event topics/data");
}
const updateBlock = safeUnsignedNumber(update.blockNumber, "capUpdate.blockNumber");
const liquidationBlock = safeUnsignedNumber(liquidation.blockNumber, "liquidationExample.blockNumber");
const updateTs = safeUnsignedNumber(update.blockTimestamp, "capUpdate.blockTimestamp");
const liquidationTs = safeUnsignedNumber(liquidation.blockTimestamp, "liquidationExample.blockTimestamp");
if (string(liquidation.blockTimestampIso, "liquidationExample.blockTimestampIso") !== new Date(liquidationTs * 1e3).toISOString()) {
  throw new Error("liquidation timestamp does not match its ISO field");
}
const result = {
  schemaVersion: 1,
  scope: "Two explorer-recorded transactions; formula replay, not complete incident reconstruction.",
  capUpdate: {
    blockNumber: updateBlock,
    timestamp: new Date(updateTs * 1e3).toISOString(),
    snapshotRatio: formatUnits(snapshotRatio, 18),
    snapshotTimestamp: new Date(Number(snapshotTimestamp) * 1e3).toISOString(),
    elapsedSeconds: elapsedSeconds.toString(),
    maxYearlyRatioGrowthPercent: annualGrowthPercent.toString(),
    internalScaledGrowthPerSecond: scaledGrowthPerSecond.toString(),
    eventRoundedGrowthPerSecond: emittedGrowthPerSecond.toString(),
    reconstructedMaximumRatio: formatUnits(maximumRatio, 18),
    reconstructedMaximumRatioRaw: maximumRatio.toString()
  },
  liquidationExample: {
    blockNumber: liquidationBlock,
    timestamp: new Date(liquidationTs * 1e3).toISOString(),
    blocksAfterUpdate: liquidationBlock - updateBlock,
    secondsAfterUpdate: liquidationTs - updateTs,
    collateralAsset: actualCollateral,
    debtAsset: actualDebt,
    user: actualUser,
    debtToCoverWeth: formatUnits(liquidationData[0], 18),
    liquidatedCollateralWstEth: formatUnits(liquidationData[1], 18),
    liquidator: string(decodedLiquidation.liquidator, "liquidator").toLowerCase()
  },
  officialAggregateContext: root.officialIncidentContext,
  limitations: root.limits
};
await writeFile(new URL("./replay.json", here), `${JSON.stringify(result, null, 2)}
`, "utf8");
console.log(JSON.stringify(result, null, 2));
