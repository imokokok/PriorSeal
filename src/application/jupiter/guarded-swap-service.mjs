// Generated from guarded-swap-service.mts by npm run core:build. Do not edit directly.
import { Connection, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  assertPreparedGuardedJupiterSwap,
  createInsightSolanaSimulationClient,
  createJupiterRouterClient,
  hashSolanaTransactionMessage,
  JupiterGuardedSwapError,
  prepareGuardedJupiterSwap,
  reviewGuardedJupiterSwap,
  SOLANA_USDC_MINT
} from "priorseal-sdk";
import { canonicalize } from "../../domain/hashing.mjs";
function createGuardedJupiterSwapService(options) {
  const apiKey = requiredSecret(options.jupiterApiKey, "JUPITER_API_KEY");
  const insightKey = requiredSecret(options.insightApiKey, "INSIGHT_API_KEY");
  const policy = assertDeploymentPolicy(options.policy);
  const connection = options.connection ?? new Connection(assertHttpsUrl(options.rpcUrl), "confirmed");
  const compiler = bindCompilerToWireMessage(options.compiler ?? createJupiterV0Compiler({ rpcUrl: options.rpcUrl, connection }));
  const router = createJupiterRouterClient({ apiKey, ...options.jupiterBaseUrl ? { baseUrl: options.jupiterBaseUrl } : {}, ...options.fetch ? { fetch: options.fetch } : {} });
  const insight = createInsightSolanaSimulationClient({ apiKey: insightKey, ...options.insightBaseUrl ? { baseUrl: options.insightBaseUrl } : {}, ...options.fetch ? { fetch: options.fetch } : {} });
  const now = options.now ?? (() => Date.now());
  return {
    async prepare(input, requestOptions = {}) {
      const intentId = input.intentId ?? `jps_${crypto.randomUUID().replaceAll("-", "")}`;
      const request = {
        ...input,
        intentId,
        ...policy.platformFee ? { platformFeeBps: policy.platformFee.feeBps, feeAccount: policy.platformFee.feeAccount } : {}
      };
      if (policy.platformFee) await assertPlatformFeeAccount(connection, policy.platformFee);
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
      assertAuthorizationId(input.authorizationId);
      await assertPreparedGuardedJupiterSwap(input.prepared, now);
      const unsigned = decodeSolanaTransaction(input.prepared.transactionBase64);
      const signed = decodeSolanaTransaction(input.signedTransactionBase64);
      await assertWireMessageMatches(unsigned, input.prepared.messageHash);
      await assertWireMessageMatches(signed, input.prepared.messageHash);
      if (!equalBytes(messageBytes(unsigned), messageBytes(signed))) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_MESSAGE_MISMATCH", "The signed transaction message differs from the guarded prepared message");
      await assertRequiredSignature(signed);
      const signature = signedTransactionSignature(signed);
      await assertAcceptedAuthorization(options.authorizationStore, input.authorizationId, input.prepared, now);
      const claim = await options.authorizationStore.claimAuthorization(input.authorizationId, signature);
      if (!claim.ok) throw new JupiterGuardedSwapError(claim.code ?? "AUTHORIZATION_ALREADY_USED", "The PriorSeal authorization was already used or is unavailable");
      try {
        const relayedSignature = await connection.sendRawTransaction(await signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0n });
        if (relayedSignature !== signature) return { signature, submission: "UNKNOWN" };
        return { signature, submission: "SUBMITTED" };
      } catch {
        return { signature, submission: "UNKNOWN" };
      }
    }
  };
}
function bindCompilerToWireMessage(compiler) {
  return {
    async compile(input, options = {}) {
      const compiled = await compiler.compile(input, options);
      await assertWireMessageMatches(decodeSolanaTransaction(compiled.transactionBase64), await hashSolanaTransactionMessage(compiled.transaction));
      return compiled;
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
    if (!await transaction.verifySignatures(true)) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_SIGNATURE_INVALID", "The signed transaction has an invalid required signature");
    return;
  }
  if (transaction.signatures.length !== 1 || transaction.signatures[0].every((byte) => byte === 0)) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_SIGNATURE_MISSING", "The signed transaction must contain exactly one fee-payer signature");
  const feePayer = transaction.message.staticAccountKeys[0];
  if (!feePayer || !await feePayer.verifySignature(transaction.signatures[0], transaction.message.serialize())) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_SIGNATURE_INVALID", "The signed transaction has an invalid required signature");
}
async function assertWireMessageMatches(transaction, expectedMessageHash) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(messageBytes(transaction)));
  const actualMessageHash = `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (actualMessageHash !== expectedMessageHash) throw new JupiterGuardedSwapError("PREPARED_WIRE_MESSAGE_MISMATCH", "The serialized transaction bytes do not match the prepared guarded message");
}
function signedTransactionSignature(transaction) {
  const signature = transaction instanceof VersionedTransaction ? transaction.signatures[0] : transaction.signature;
  if (!signature || signature.every((byte) => byte === 0)) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_SIGNATURE_MISSING", "The signed transaction does not contain a fee-payer signature");
  const value = encodeBase58(signature);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) throw new JupiterGuardedSwapError("SIGNED_TRANSACTION_SIGNATURE_INVALID", "The signed transaction fee-payer signature is invalid");
  return value;
}
async function assertAcceptedAuthorization(store, authorizationId, prepared, now) {
  const record = await store.getAuthorization(authorizationId);
  if (!record) throw new JupiterGuardedSwapError("AUTHORIZATION_NOT_FOUND", "The guarded swap authorization was not found");
  const timestamp = Math.floor(now() / 1e3);
  const { authorization, acceptance } = record;
  if (record.status !== "ACCEPTED" || record.boundTxHash !== null || record.uses !== 0) throw new JupiterGuardedSwapError("AUTHORIZATION_ALREADY_USED", "The guarded swap authorization has already been used");
  if (timestamp < authorization.notBefore || timestamp >= authorization.expiresAt || timestamp >= prepared.intent.validUntil) throw new JupiterGuardedSwapError("AUTHORIZATION_EXPIRED", "The guarded swap authorization has expired");
  const expectedIntent = canonicalize(prepared.intent);
  const accepted = acceptance.status === "ACCEPTED" && acceptance.authorizationId === authorizationId && acceptance.intentHash === prepared.intent.intentHash && authorization.authorizationId === authorizationId && authorization.intentHash === prepared.intent.intentHash && canonicalize(authorization.intent) === expectedIntent && authorization.authorizer.type === "solana-ed25519" && authorization.authorizer.address === prepared.transaction.feePayer && authorization.principal.account === prepared.transaction.feePayer && authorization.delegate.executor === prepared.transaction.feePayer;
  if (!accepted) throw new JupiterGuardedSwapError("AUTHORIZATION_INTENT_MISMATCH", "The accepted PriorSeal authorization does not bind this exact guarded swap");
}
function assertAuthorizationId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new JupiterGuardedSwapError("AUTHORIZATION_NOT_FOUND", "A valid guarded swap authorizationId is required");
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
  if (value.platformFee) {
    if (!Number.isSafeInteger(value.platformFee.feeBps) || value.platformFee.feeBps < 1 || value.platformFee.feeBps > 20 || value.platformFee.feeMint !== SOLANA_USDC_MINT) throw new TypeError("Guarded Jupiter platform fee is invalid");
    try {
      new PublicKey(value.platformFee.feeAccount);
      new PublicKey(value.platformFee.merchant);
    } catch {
      throw new TypeError("Guarded Jupiter platform-fee account and merchant must be Solana public keys");
    }
  }
  return structuredClone(value);
}
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
async function assertPlatformFeeAccount(connection, fee) {
  let account;
  try {
    account = await connection.getAccountInfo(new PublicKey(fee.feeAccount), "confirmed");
  } catch {
    throw new JupiterGuardedSwapError("FEE_ACCOUNT_UNAVAILABLE", "The configured USDC platform-fee account could not be read from Solana RPC");
  }
  if (!account) throw new JupiterGuardedSwapError("FEE_ACCOUNT_UNAVAILABLE", "The configured USDC platform-fee account does not exist on Solana");
  const merchant = new PublicKey(fee.merchant);
  const mint = new PublicKey(SOLANA_USDC_MINT);
  const tokenProgram = new PublicKey(SPL_TOKEN_PROGRAM);
  const associatedTokenProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM);
  const [expectedAccount] = await PublicKey.findProgramAddress([merchant.toBytes(), tokenProgram.toBytes(), mint.toBytes()], associatedTokenProgram);
  const data = new Uint8Array(account.data);
  const mintMatches = equalBytes(data.slice(0, 32), mint.toBytes());
  const ownerMatches = equalBytes(data.slice(32, 64), merchant.toBytes());
  if (!expectedAccount.equals(new PublicKey(fee.feeAccount)) || account.owner.toBase58() !== SPL_TOKEN_PROGRAM || data.length !== 165 || !mintMatches || !ownerMatches || data[108] !== 1) {
    throw new JupiterGuardedSwapError("FEE_ACCOUNT_MISMATCH", "The configured platform-fee account is not the merchant's initialized Solana USDC ATA");
  }
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
