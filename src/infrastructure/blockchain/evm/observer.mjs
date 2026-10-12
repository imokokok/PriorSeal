// Generated from observer.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../../shared/error-code.mjs";
import { normalizeExecution } from "../../../domain/execution.mjs";
import { SUPPORTED_CHAINS, getRpcUrls } from "./chains.mjs";
import { PriorSealError } from "../../../domain/errors.mjs";
import { createRpcClient } from "./rpc-client.mjs";
import { decodeSafe4337CallFromBundlerTransaction } from "./erc4337-call-data.mjs";
import { verifyEip7702Bundle } from "./eip7702-evidence.mjs";
import { encodeAbiParameters, keccak256, toBytes, toFunctionSelector } from "viem";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SELECTORS = ["0xa9059cbb", "0x23b872dd"];
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;
const ABI_WORD = /^0x[0-9a-fA-F]{64}$/;
const USER_OPERATION_EVENT_TOPIC = keccak256(toBytes("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"));
const DELEGATE_ENTRY_POINT_SELECTOR = toFunctionSelector("entryPoint()");
const SAFE_FALLBACK_HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
const storageAddress = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? `0x${value.slice(-40)}`.toLowerCase() : null;
const clean = (x) => x?.toLowerCase();
const address = (topic) => typeof topic === "string" && /^0x[0-9a-fA-F]{64}$/.test(topic) ? `0x${topic.slice(-40)}`.toLowerCase() : null;
const hexBig = (x) => typeof x === "string" && /^0x[0-9a-fA-F]+$/.test(x) ? BigInt(x).toString() : null;
const safeSource = (chainId, index) => `evm-json-rpc:eip155:${chainId}:configured-${index + 1}`;
const actionFor = (tx) => {
  const input = clean(tx.input ?? "0x") ?? "0x";
  return input === "0x" || input === "0x0" || TRANSFER_SELECTORS.some((selector) => input.startsWith(selector)) ? "TRANSFER" : "CONTRACT_CALL";
};
function isTransferLog(log) {
  return clean(log.topics?.[0]) === TRANSFER_TOPIC && log.topics?.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(log.address ?? "") && Boolean(address(log.topics[1])) && Boolean(address(log.topics[2])) && ABI_WORD.test(log.data ?? "") && hexBig(log.logIndex) !== null;
}
async function observeEvm({ chainId, txHash, confirmations = 0, finalityRequirement = "CONFIRMATIONS", maxToleratedReorgDepth = null, erc4337, erc4337EntryPoints = [], safe4337Trust = [], eip7702Delegates = [], rpcUrls, timeoutMs = 1e4, signal, rpcClient = createRpcClient({ timeoutMs }) }) {
  if (!Number.isSafeInteger(confirmations) || confirmations < 0 || confirmations > 1e4) throw new PriorSealError("INVALID_REQUEST", "confirmations must be an integer between 0 and 10000");
  if (!["CONFIRMATIONS", "RPC_FINALIZED"].includes(finalityRequirement)) throw new PriorSealError("INVALID_REQUEST", "Unsupported finality requirement");
  if (maxToleratedReorgDepth != null && (!Number.isSafeInteger(maxToleratedReorgDepth) || maxToleratedReorgDepth < 0 || maxToleratedReorgDepth > 9999)) throw new PriorSealError("INVALID_REQUEST", "Invalid reorg tolerance depth");
  const trustedEntryPoint = erc4337 && erc4337EntryPoints.find((entry) => entry.chainId === Number(chainId) && entry.version === erc4337.entryPointVersion && clean(entry.address) === clean(erc4337.entryPoint));
  if (erc4337 && !trustedEntryPoint) throw new PriorSealError("ERC4337_ENTRY_POINT_NOT_TRUSTED", "EntryPoint is not in the deployment trust list");
  if (erc4337 && clean(trustedEntryPoint?.codeHash) !== clean(erc4337.entryPointCodeHash)) throw new PriorSealError("ERC4337_CODE_HASH_MISMATCH", "Authorized EntryPoint code hash does not match the deployment trust list");
  const trustedSafe = erc4337?.accountCallProfile === "safe-4337.v1" ? safe4337Trust.find((entry) => entry.chainId === Number(chainId) && entry.version === erc4337.entryPointVersion) : void 0;
  if (erc4337?.accountCallProfile === "safe-4337.v1" && !trustedSafe) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe ERC-4337 module and singleton trust profile is not configured");
  const trustedEip7702Delegate = erc4337?.eip7702 ? eip7702Delegates.find((entry) => entry.chainId === Number(chainId) && clean(entry.address) === clean(erc4337.eip7702?.delegateAddress)) : void 0;
  if (erc4337?.eip7702 && (!["0.7", "0.8", "0.9"].includes(erc4337.entryPointVersion) || !trustedEip7702Delegate || erc4337.entryPointVersion === "0.7" && erc4337.eip7702.authorizationTupleHash != null)) throw new PriorSealError("ERC4337_EIP7702_UNTRUSTED", "EIP-7702 delegate is not trusted for this EntryPoint profile or the v0.7 profile includes a fresh authorization");
  if (erc4337?.eip7702 && clean(trustedEip7702Delegate?.codeHash) !== clean(erc4337.eip7702.delegateCodeHash)) throw new PriorSealError("ERC4337_EIP7702_UNTRUSTED", "Authorized EIP-7702 delegate code hash does not match the trust list");
  if (!SUPPORTED_CHAINS[Number(chainId)]) return normalizeExecution({ chainId, txHash, status: "UNSUPPORTED_CHAIN", executionDataAvailable: false, observationSource: "evm-json-rpc" });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new PriorSealError("INVALID_TX_HASH", "txHash must be a 32-byte hex hash");
  const urls = rpcUrls ?? getRpcUrls(chainId);
  if (!urls?.length) throw new PriorSealError("RPC_NOT_CONFIGURED", `Configure ${SUPPORTED_CHAINS[Number(chainId)].rpcEnv}; PriorSeal will not guess an endpoint`);
  let lastError;
  let fallbackObservation;
  for (const [index, url] of urls.entries()) {
    try {
      const observationSource = safeSource(chainId, index);
      const reportedChainId = await rpcClient.call(url, "eth_chainId", [], signal);
      if (Number(BigInt(reportedChainId)) !== Number(chainId)) throw new PriorSealError("RPC_CHAIN_MISMATCH", "RPC endpoint reported an unexpected chain ID");
      const tx = await rpcClient.call(url, "eth_getTransactionByHash", [txHash], signal);
      if (!tx) {
        fallbackObservation ??= normalizeExecution({ chainId, txHash, status: "NOT_FOUND", executionDataAvailable: false, observationSource });
        continue;
      }
      if (String(tx.hash).toLowerCase() !== txHash.toLowerCase()) throw new PriorSealError("RPC_INVALID_RESPONSE", "Transaction hash does not match request");
      const transactionNonce = hexBig(tx.nonce);
      if (transactionNonce === null) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned an invalid transaction nonce");
      const receipt = await rpcClient.call(url, "eth_getTransactionReceipt", [txHash], signal);
      if (!receipt) {
        fallbackObservation = erc4337 ? normalizeExecution({ chainId, txHash, status: "PENDING", action: "ERC4337_USER_OPERATION", nonce: null, sender: null, recipient: null, target: erc4337.entryPoint, asset: `eip155:${chainId}/native`, amount: "0", executionDataAvailable: false, observationSource, finalityState: "PENDING", userOperationHash: erc4337.userOperationHash, entryPoint: erc4337.entryPoint, entryPointVersion: erc4337.entryPointVersion }) : normalizeExecution({ chainId, txHash, status: "PENDING", action: actionFor(tx), nonce: transactionNonce, sender: tx.from, recipient: tx.to, target: tx.to, calldataHash: keccak256(tx.input ?? "0x"), nativeValue: hexBig(tx.value), executionDataAvailable: true, observationSource, finalityState: "PENDING" });
        continue;
      }
      if (receipt.transactionHash && String(receipt.transactionHash).toLowerCase() !== txHash.toLowerCase()) throw new PriorSealError("RPC_INVALID_RESPONSE", "Receipt hash does not match request");
      const receiptStatus = String(receipt.status).toLowerCase();
      const receiptBlockNumber = hexBig(receipt.blockNumber);
      const gasUsed = hexBig(receipt.gasUsed);
      if (!["0x0", "0x1"].includes(receiptStatus)) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned an invalid transaction status");
      if (receiptBlockNumber === null || gasUsed === null || !BLOCK_HASH.test(receipt.blockHash ?? "")) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned invalid receipt block evidence");
      const [head, containingBlock] = await Promise.all([
        rpcClient.call(url, "eth_blockNumber", [], signal),
        rpcClient.call(url, "eth_getBlockByHash", [receipt.blockHash, false], signal)
      ]);
      const headNumber = hexBig(head);
      const containingBlockNumber = containingBlock?.number == null ? receiptBlockNumber : hexBig(containingBlock.number);
      const txBlockNumber = tx.blockNumber == null ? receiptBlockNumber : hexBig(tx.blockNumber);
      if (!containingBlock || clean(containingBlock.hash) !== clean(receipt.blockHash) || hexBig(containingBlock.timestamp) === null || containingBlockNumber !== receiptBlockNumber) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned inconsistent block evidence");
      if (headNumber === null || BigInt(headNumber) < BigInt(receiptBlockNumber)) throw new PriorSealError("RPC_INVALID_RESPONSE", "Receipt block is ahead of the reported chain head");
      if (BigInt(headNumber) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(receiptBlockNumber) > BigInt(Number.MAX_SAFE_INTEGER)) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC block height exceeds the supported safe integer range");
      if (tx.blockHash != null && clean(tx.blockHash) !== clean(receipt.blockHash) || txBlockNumber !== receiptBlockNumber) throw new PriorSealError("RPC_INVALID_RESPONSE", "Transaction and receipt block evidence do not match");
      const confirmationsSeen = Number(BigInt(headNumber) - BigInt(receiptBlockNumber) + 1n);
      const requiredConfirmations = Math.max(confirmations, (maxToleratedReorgDepth ?? -1) + 1);
      let finalizedBlock = null;
      let observedHeadHash = null;
      let canonicalInclusion = true;
      if (finalityRequirement === "RPC_FINALIZED") {
        const observedHead = await rpcClient.call(url, "eth_getBlockByNumber", [`0x${BigInt(headNumber).toString(16)}`, false], signal);
        if (!observedHead || !BLOCK_HASH.test(observedHead.hash ?? "") || hexBig(observedHead.number) !== headNumber) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint did not return the observed chain head");
        observedHeadHash = observedHead.hash.toLowerCase();
        const canonical = await rpcClient.call(url, "eth_getBlockByNumber", [`0x${BigInt(receiptBlockNumber).toString(16)}`, false], signal);
        if (!canonical || !BLOCK_HASH.test(canonical.hash ?? "") || hexBig(canonical.number) !== receiptBlockNumber) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint did not return a canonical inclusion block");
        canonicalInclusion = clean(canonical.hash) === clean(receipt.blockHash);
        try {
          const finalized2 = await rpcClient.call(url, "eth_getBlockByNumber", ["finalized", false], signal);
          if (finalized2 && BLOCK_HASH.test(finalized2.hash ?? "") && hexBig(finalized2.number) !== null && BigInt(finalized2.number) <= BigInt(headNumber)) {
            finalizedBlock = { number: Number(BigInt(finalized2.number)), hash: finalized2.hash.toLowerCase() };
          }
        } catch (error) {
          if (signal?.aborted) throw error;
        }
        if (finalizedBlock) {
          const canonicalFinalized = await rpcClient.call(url, "eth_getBlockByNumber", [`0x${BigInt(finalizedBlock.number).toString(16)}`, false], signal);
          if (!canonicalFinalized || hexBig(canonicalFinalized.number) !== String(finalizedBlock.number) || clean(canonicalFinalized.hash) !== finalizedBlock.hash) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC finalized block is not canonical at its height");
        }
        if (finalizedBlock && (canonicalInclusion && finalizedBlock.number === Number(BigInt(receiptBlockNumber)) && finalizedBlock.hash !== clean(receipt.blockHash) || finalizedBlock.number === Number(BigInt(headNumber)) && finalizedBlock.hash !== observedHeadHash)) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC finalized block conflicts with the observed chain");
      }
      const logs = receipt.logs ?? [];
      if (!Array.isArray(logs)) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned invalid receipt logs");
      const transfers = [];
      for (const log of logs) {
        if (!log || typeof log !== "object" || log.removed === true || log.transactionHash != null && clean(log.transactionHash) !== clean(txHash) || log.blockHash != null && clean(log.blockHash) !== clean(receipt.blockHash) || log.blockNumber != null && hexBig(log.blockNumber) !== receiptBlockNumber) throw new PriorSealError("RPC_INVALID_RESPONSE", "RPC endpoint returned a log outside the receipt");
        if (isTransferLog(log)) transfers.push({ asset: log.address.toLowerCase(), sender: address(log.topics[1]), recipient: address(log.topics[2]), amount: hexBig(log.data), logIndex: Number(BigInt(log.logIndex)) });
      }
      let userOperationEvent = null;
      let eip7702Bundle = null;
      let safeAccountCall = null;
      if (erc4337) {
        if (clean(tx.to) !== clean(erc4337.entryPoint)) throw new PriorSealError("ERC4337_ENTRY_POINT_MISMATCH", "Bundler transaction target does not match the authorized EntryPoint");
        if (!/^0x[0-9a-fA-F]{64}$/.test(erc4337.userOperationHash) || !/^0x[0-9a-fA-F]{40}$/.test(erc4337.entryPoint) || !/^0x[0-9a-fA-F]{64}$/.test(erc4337.entryPointCodeHash)) throw new PriorSealError("INVALID_INTENT", "ERC-4337 observation profile is invalid");
        const deployedCode = await rpcClient.call(url, "eth_getCode", [erc4337.entryPoint, receipt.blockNumber], signal);
        if (deployedCode === "0x" || clean(keccak256(deployedCode)) !== clean(erc4337.entryPointCodeHash)) throw new PriorSealError("ERC4337_CODE_HASH_MISMATCH", "EntryPoint runtime code at the UserOperation block does not match the authorized code hash");
        const matches = logs.filter((log) => clean(log.address) === clean(erc4337.entryPoint) && clean(log.topics?.[0]) === USER_OPERATION_EVENT_TOPIC && clean(log.topics?.[1]) === clean(erc4337.userOperationHash));
        if (erc4337.eip7702) {
          const gasPrice2 = receipt.effectiveGasPrice ?? tx.gasPrice;
          eip7702Bundle = await verifyEip7702Bundle({
            chainId: Number(chainId),
            entryPoint: erc4337.entryPoint,
            entryPointVersion: erc4337.entryPointVersion,
            userOperationHash: erc4337.userOperationHash,
            expected: erc4337.eip7702,
            transactionType: tx.type,
            transactionData: tx.input,
            authorizationList: tx.authorizationList,
            receiptStatus,
            logs,
            entryPointAddress: erc4337.entryPoint,
            transactionHash: txHash,
            outerTransactionGasUsed: gasUsed,
            outerTransactionFee: gasPrice2 ? (BigInt(gasPrice2) * BigInt(gasUsed)).toString() : null,
            readCode: (account, blockNumber) => rpcClient.call(url, "eth_getCode", [account, blockNumber], signal),
            readDelegateEntryPoint: async (delegate, blockNumber) => {
              const result = await rpcClient.call(url, "eth_call", [{ to: delegate, data: DELEGATE_ENTRY_POINT_SELECTOR }, blockNumber], signal);
              if (typeof result !== "string" || !ABI_WORD.test(result)) throw new PriorSealError("ERC4337_EIP7702_UNTRUSTED", "EIP-7702 delegate returned an invalid EntryPoint getter result");
              return `0x${result.slice(-40)}`;
            },
            traceTransaction: (hash, diffMode) => rpcClient.call(url, "debug_traceTransaction", [hash, { tracer: "prestateTracer", tracerConfig: { diffMode } }], signal),
            blockNumber: receipt.blockNumber
          });
        }
        if (!erc4337.eip7702 || receiptStatus === "0x1") {
          if (matches.length !== 1) throw new PriorSealError(erc4337.eip7702 ? "ERC4337_EIP7702_OPERATION_MISMATCH" : "ERC4337_EVENT_MISMATCH", `Expected exactly one matching UserOperationEvent, found ${matches.length}`);
          const event = matches[0];
          const sender = address(event.topics?.[2]);
          const words = typeof event.data === "string" && /^0x[0-9a-fA-F]{256}$/.test(event.data) ? event.data.slice(2).match(/.{64}/g) : null;
          if (!sender || !words || words.length !== 4 || !/^0x[0-9a-fA-F]{64}$/.test(event.topics?.[3] ?? "") || !["0".repeat(64), `${"0".repeat(63)}1`].includes(words[1])) throw new PriorSealError("RPC_INVALID_RESPONSE", "EntryPoint returned an invalid UserOperationEvent");
          userOperationEvent = { sender, nonce: BigInt(`0x${words[0]}`).toString(), success: BigInt(`0x${words[1]}`) === 1n, actualGasCost: BigInt(`0x${words[2]}`).toString(), actualGasUsed: BigInt(`0x${words[3]}`).toString() };
          if (eip7702Bundle && (clean(eip7702Bundle.sender) !== clean(sender) || eip7702Bundle.nonce !== userOperationEvent.nonce || eip7702Bundle.userOperationSuccess !== userOperationEvent.success)) throw new PriorSealError("ERC4337_EIP7702_OPERATION_MISMATCH", "UserOperationEvent does not match the decoded EIP-7702 UserOperation");
        }
        if (erc4337.accountCallProfile === "safe-4337.v1") {
          if (!userOperationEvent) throw new PriorSealError("ERC4337_EVENT_MISMATCH", "Safe call evidence requires a matching UserOperationEvent");
          safeAccountCall = decodeSafe4337CallFromBundlerTransaction({ transactionData: tx.input, entryPointVersion: erc4337.entryPointVersion, sender: userOperationEvent.sender, nonce: userOperationEvent.nonce });
          if (clean(safeAccountCall.target) !== clean(erc4337.accountCallTarget) || safeAccountCall.value !== erc4337.accountCallValue || clean(safeAccountCall.dataHash) !== clean(erc4337.accountCallDataHash)) throw new PriorSealError("ERC4337_ACCOUNT_CALL_MISMATCH", "Decoded Safe call does not match the authorized account call");
          const safeTrust = trustedSafe;
          if (clean(safeTrust.entryPointAddress) !== clean(erc4337.entryPoint)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe4337Module trust configuration targets a different EntryPoint");
          let prestate;
          try {
            prestate = await rpcClient.call(url, "debug_traceTransaction", [txHash, { tracer: "prestateTracer", tracerConfig: { diffMode: false } }], signal);
          } catch (error) {
            if (signal?.aborted) throw error;
            throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "RPC endpoint must provide debug_traceTransaction prestate for Safe verification");
          }
          if (!prestate || typeof prestate !== "object" || Array.isArray(prestate)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "RPC transaction prestate is malformed");
          const prestateAccount = (account) => Object.entries(prestate).find(([candidate]) => clean(candidate) === clean(account))?.[1];
          const safeState = prestateAccount(userOperationEvent.sender);
          if (!safeState?.storage) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "RPC transaction prestate is missing Safe storage");
          if (typeof safeState.code !== "string" || clean(keccak256(safeState.code)) !== clean(safeTrust.safeProxyCodeHash)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe proxy runtime code does not match the configured trust hash");
          const storageAt = (state, slot) => Object.entries(state?.storage ?? {}).find(([candidate]) => clean(candidate) === clean(slot))?.[1];
          const singletonStorage = storageAt(safeState, `0x${"0".repeat(63)}0`);
          const singleton = storageAddress(singletonStorage);
          if (!singleton || singleton === `0x${"0".repeat(40)}`) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe singleton storage is missing or invalid at the inclusion block");
          const singletonCode = prestateAccount(singleton)?.code;
          if (typeof singletonCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(singletonCode)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "RPC transaction prestate is missing Safe singleton code");
          if (singletonCode === "0x" || clean(keccak256(singletonCode)) !== clean(safeTrust.safeSingletonCodeHash)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe singleton runtime code does not match the configured trust hash");
          const moduleState = prestateAccount(safeTrust.moduleAddress);
          const moduleCode = moduleState?.code;
          if (typeof moduleCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(moduleCode)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "RPC transaction prestate is missing Safe4337Module code");
          if (moduleCode === "0x" || clean(keccak256(moduleCode)) !== clean(safeTrust.moduleCodeHash)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe4337Module runtime code does not match the configured trust hash");
          const moduleMappingSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [safeTrust.moduleAddress, 1n]));
          const enabledStorage = storageAt(safeState, moduleMappingSlot);
          const enabledModule = storageAddress(enabledStorage);
          if (!enabledModule || enabledModule === `0x${"0".repeat(40)}`) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe4337Module was not enabled on the Safe before this transaction");
          const fallbackStorage = storageAt(safeState, SAFE_FALLBACK_HANDLER_SLOT);
          if (storageAddress(fallbackStorage) !== clean(safeTrust.moduleAddress)) throw new PriorSealError("ERC4337_SAFE_ACCOUNT_UNTRUSTED", "Safe fallback handler is not the configured Safe4337Module at the inclusion block");
        }
      }
      const first = transfers[0];
      const gasPrice = receipt.effectiveGasPrice ?? tx.gasPrice;
      const depthReached = confirmationsSeen >= requiredConfirmations;
      const finalized = finalityRequirement === "RPC_FINALIZED" && finalizedBlock !== null && finalizedBlock.number >= Number(BigInt(receiptBlockNumber));
      const finalityReached = depthReached && (finalityRequirement === "CONFIRMATIONS" || finalized);
      const finalityState = !canonicalInclusion ? "REORGED" : finalityReached ? finalityRequirement === "RPC_FINALIZED" ? "FINALIZED" : "CONFIRMED" : "INSUFFICIENT_FINALITY";
      const status = !canonicalInclusion ? "REORGED" : !finalityReached ? "PENDING" : erc4337 ? userOperationEvent?.success ? "CONFIRMED" : "REVERTED" : receiptStatus === "0x0" ? "REVERTED" : "CONFIRMED";
      const observedSender = userOperationEvent?.sender ?? eip7702Bundle?.sender ?? tx.from;
      const observedNonce = userOperationEvent?.nonce ?? eip7702Bundle?.nonce ?? transactionNonce;
      const isEip7702 = Boolean(eip7702Bundle);
      return normalizeExecution({ chainId, txHash, status, executedAt: Number(BigInt(containingBlock.timestamp)), action: erc4337 ? "ERC4337_USER_OPERATION" : actionFor(tx), nonce: observedNonce, sender: observedSender, recipient: erc4337 ? observedSender : first?.recipient ?? tx.to, target: erc4337 ? erc4337.entryPoint : tx.to, calldataHash: erc4337 ? erc4337.userOperationHash : keccak256(tx.input ?? "0x"), asset: erc4337 ? `eip155:${chainId}/native` : first ? `eip155:${chainId}/erc20:${first.asset}` : `eip155:${chainId}/native`, amount: erc4337 ? "0" : first?.amount ?? hexBig(tx.value), transfers, nativeValue: erc4337 ? null : hexBig(tx.value), gasUsed: userOperationEvent?.actualGasUsed ?? (isEip7702 ? null : gasUsed), fee: userOperationEvent?.actualGasCost ?? (isEip7702 ? null : gasPrice ? (BigInt(gasPrice) * BigInt(gasUsed)).toString() : null), executionDataAvailable: erc4337 ? Boolean(userOperationEvent || eip7702Bundle) : true, observationSource: erc4337 ? `${observationSource}:${isEip7702 ? "erc4337-eip7702-trace" : "erc4337-entrypoint-event"}` : observationSource, finalityState, confirmations: confirmationsSeen, ...erc4337 ? { userOperationHash: erc4337.userOperationHash, entryPoint: erc4337.entryPoint, entryPointCodeHash: erc4337.entryPointCodeHash, entryPointVersion: erc4337.entryPointVersion, userOperationSuccess: userOperationEvent?.success ?? null, actualGasCost: userOperationEvent?.actualGasCost ?? null, ...safeAccountCall ? { accountCallProfile: safeAccountCall.profile, accountCallTarget: safeAccountCall.target, accountCallValue: safeAccountCall.value, accountCallDataHash: safeAccountCall.dataHash } : {}, ...eip7702Bundle ? { eip7702Delegation: eip7702Bundle.evidence } : {} } : {}, blockNumber: Number(BigInt(receiptBlockNumber)), blockHash: receipt.blockHash, temporalEvidence: { schema: "priorseal.temporal-evidence.v1", criterion: finalityRequirement, requiredConfirmations, maxToleratedReorgDepth, observedHeadNumber: Number(BigInt(headNumber)), observedHeadHash, finalizedBlock } });
    } catch (error) {
      lastError = error;
    }
  }
  if (erc4337 && ["ERC4337_EVENT_MISMATCH", "ERC4337_ENTRY_POINT_MISMATCH", "ERC4337_CODE_HASH_MISMATCH", "ERC4337_ACCOUNT_CALL_UNSUPPORTED", "ERC4337_ACCOUNT_CALL_MISMATCH", "ERC4337_SAFE_ACCOUNT_UNTRUSTED", "ERC4337_EIP7702_UNTRUSTED", "ERC4337_EIP7702_AUTH_MISMATCH", "ERC4337_EIP7702_OPERATION_MISMATCH", "ERC4337_EIP7702_TRACE_UNAVAILABLE"].includes(errorCode(lastError) ?? "")) throw lastError;
  if (fallbackObservation) return fallbackObservation;
  throw new PriorSealError(signal?.aborted ? "REQUEST_ABORTED" : errorCode(lastError) === "RPC_TIMEOUT" ? "RPC_TIMEOUT" : "RPC_FAILURE", "All RPC endpoints failed");
}
export {
  observeEvm
};
