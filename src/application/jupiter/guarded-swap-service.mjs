// Generated from guarded-swap-service.mts by npm run core:build. Do not edit directly.
import { Connection, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  assertPreparedGuardedJupiterSwap,
  createInsightSolanaSimulationClient,
  createJupiterRouterClient,
  prepareGuardedJupiterSwap,
  reviewGuardedJupiterSwap
} from "priorseal-sdk";
function createGuardedJupiterSwapService(options) {
  const apiKey = requiredSecret(options.jupiterApiKey, "JUPITER_API_KEY");
  const insightKey = requiredSecret(options.insightApiKey, "INSIGHT_API_KEY");
  const policy = assertDeploymentPolicy(options.policy);
  const connection = options.connection ?? new Connection(assertHttpsUrl(options.rpcUrl), "confirmed");
  const compiler = options.compiler ?? createJupiterV0Compiler({ rpcUrl: options.rpcUrl, connection });
  const router = createJupiterRouterClient({ apiKey, ...options.jupiterBaseUrl ? { baseUrl: options.jupiterBaseUrl } : {}, ...options.fetch ? { fetch: options.fetch } : {} });
  const insight = createInsightSolanaSimulationClient({ apiKey: insightKey, ...options.insightBaseUrl ? { baseUrl: options.insightBaseUrl } : {}, ...options.fetch ? { fetch: options.fetch } : {} });
  const now = options.now ?? (() => Date.now());
  return {
    async prepare(input, requestOptions = {}) {
      const intentId = input.intentId ?? `jps_${crypto.randomUUID().replaceAll("-", "")}`;
      const request = { ...input, intentId };
      const prepared = await prepareGuardedJupiterSwap(request, {
        router,
        compiler,
        insight,
        policy: { ...policy, feePayer: request.taker },
        now,
        signal: requestOptions.signal
      });
      return { prepared, review: await reviewGuardedJupiterSwap(prepared, now) };
    },
    async submit(input, requestOptions = {}) {
      if (requestOptions.signal?.aborted) throw requestOptions.signal.reason ?? new Error("Guarded Jupiter submission was aborted");
      await assertPreparedGuardedJupiterSwap(input.prepared, now);
      const unsigned = decodeSolanaTransaction(input.prepared.transactionBase64);
      const signed = decodeSolanaTransaction(input.signedTransactionBase64);
      if (!equalBytes(messageBytes(unsigned), messageBytes(signed))) throw new Error("The signed transaction message differs from the guarded prepared message");
      await assertRequiredSignature(signed);
      const signature = await connection.sendRawTransaction(await signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0n });
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new Error("Solana RPC returned an invalid transaction signature");
      return { signature };
    }
  };
}
function createJupiterV0Compiler({ rpcUrl, connection = new Connection(assertHttpsUrl(rpcUrl), "confirmed") }) {
  return {
    async compile({ build, request }, options = {}) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Jupiter compilation was aborted");
      const lookupTables = await Promise.all(build.addressLookupTableAddresses.map(async (address) => {
        const result = await connection.getAddressLookupTable(new PublicKey(address));
        if (!result.value) throw new Error(`Jupiter address lookup table is unavailable: ${address}`);
        return result.value;
      }));
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Jupiter compilation was aborted");
      const blockhash = await connection.getLatestBlockhash("confirmed");
      const instructions = [
        ...build.computeBudgetInstructions,
        ...build.setupInstructions,
        build.swapInstruction,
        ...build.cleanupInstruction ? [build.cleanupInstruction] : [],
        ...build.otherInstructions,
        ...build.tipInstruction ? [build.tipInstruction] : []
      ].map((instruction) => new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })),
        data: decodeBase64(instruction.data, "Jupiter instruction data")
      }));
      const message = new TransactionMessage({ payerKey: new PublicKey(request.taker), recentBlockhash: blockhash.blockhash, instructions }).compileToV0Message(lookupTables);
      const loaded = message.resolveAddressTableLookups(lookupTables);
      const transaction = new VersionedTransaction(message);
      return {
        transactionBase64: encodeBase64(transaction.serialize()),
        transaction: normalizedV0Message(message, loaded)
      };
    }
  };
}
function decodeSolanaTransaction(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32768 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("signedTransactionBase64 must be canonical base64");
  const bytes = decodeBase64(value, "signedTransactionBase64");
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}
async function assertRequiredSignature(transaction) {
  if (!(transaction instanceof VersionedTransaction)) {
    if (!await transaction.verifySignatures(true)) throw new Error("The signed transaction has an invalid required signature");
    return;
  }
  if (transaction.signatures.length !== 1 || transaction.signatures[0].every((byte) => byte === 0)) throw new Error("The signed transaction must contain exactly one fee-payer signature");
  const feePayer = transaction.message.staticAccountKeys[0];
  if (!feePayer || !await feePayer.verifySignature(transaction.signatures[0], transaction.message.serialize())) throw new Error("The signed transaction has an invalid required signature");
}
function messageBytes(transaction) {
  return transaction instanceof VersionedTransaction ? transaction.message.serialize() : transaction.serializeMessage();
}
function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
function normalizedV0Message(message, loaded) {
  return {
    network: "mainnet-beta",
    messageVersion: "v0",
    feePayer: message.staticAccountKeys[0].toBase58(),
    recentBlockhash: message.recentBlockhash,
    header: {
      numRequiredSignatures: message.header.numRequiredSignatures,
      numReadonlySignedAccounts: message.header.numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts
    },
    accountKeys: message.staticAccountKeys.map((key) => key.toBase58()),
    addressTableLookups: message.addressTableLookups.map((lookup) => ({ accountKey: lookup.accountKey.toBase58(), writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] })),
    loadedAddresses: { writable: loaded.writable.map((key) => key.toBase58()), readonly: loaded.readonly.map((key) => key.toBase58()) },
    instructions: message.compiledInstructions.map((instruction) => ({ programIdIndex: instruction.programIdIndex, accountIndexes: [...instruction.accountKeyIndexes], data: encodeBase58(instruction.data) }))
  };
}
function assertDeploymentPolicy(value) {
  if (!value || typeof value !== "object") throw new TypeError("Guarded Jupiter policy is required");
  if (!Array.isArray(value.allowedProgramIds) || value.allowedProgramIds.length === 0) throw new TypeError("Guarded Jupiter policy requires allowedProgramIds");
  if (typeof value.maxInputAmountAtomic !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.maxInputAmountAtomic) || BigInt(value.maxInputAmountAtomic) === 0n) throw new TypeError("Guarded Jupiter policy maxInputAmountAtomic is invalid");
  if (!Number.isSafeInteger(value.maxSlippageBps) || value.maxSlippageBps < 0 || value.maxSlippageBps > 1e4) throw new TypeError("Guarded Jupiter policy maxSlippageBps is invalid");
  if (!Number.isSafeInteger(value.authorizationTtlSeconds) || value.authorizationTtlSeconds < 15 || value.authorizationTtlSeconds > 300) throw new TypeError("Guarded Jupiter policy authorizationTtlSeconds must be 15 through 300 seconds");
  return structuredClone(value);
}
function requiredSecret(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required when Guarded Jupiter swaps are enabled`);
  return value.trim();
}
function assertHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new TypeError("Guarded Jupiter RPC URL must use HTTPS");
  return url.toString();
}
function encodeBase58(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let integer = 0n;
  for (const byte of value) integer = integer << 8n | BigInt(byte);
  let encoded = "";
  while (integer > 0n) {
    encoded = alphabet[Number(integer % 58n)] + encoded;
    integer /= 58n;
  }
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}
function decodeBase64(value, name) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError(`${name} must be canonical base64`);
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError(`${name} must be canonical base64`);
  }
}
function encodeBase64(value) {
  let text = "";
  for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text);
}
export {
  createGuardedJupiterSwapService,
  createJupiterV0Compiler
};
