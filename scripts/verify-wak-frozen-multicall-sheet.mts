/**
 * WAK 合作线：frozen multicall run sheet 独立核验（只读）。
 *
 * 背景（2026-10-05 20:01 Maulana 来信 IN-06）：对方交付 frozen package 四件套
 * （完整 sheet JSON 字节、multicall-wrapped calldata、router bytecode keccak256、
 * 同源三 digest），并声明全部由同一份原始字节重算。本脚本不采信任何声明，
 * 从 sheet 原始字段现场重算并交叉核验：
 *   1. call shape：0x5ae401dc multicall(uint256,bytes[]) 恰包一个 7 词
 *      exactInputSingle（0x04e45aaf），value=0，decode→re-encode 逐字节 round-trip；
 *   2. calldataHash：keccak256(原始 calldata)；
 *   3. envelopeDigest：WAK envelope.py `_domain_hash`（namespace + \\0 + canonical
 *      JSON，sha256），分别以 sheet envelope.nonce 与 transaction.nonce 试算并报告
 *      何者吻合（digest 绑定交易 nonce，envelope.nonce 字段可能是陈旧显示值）；
 *   4. policyCommitmentDigest：同算法按 policyDecision 字段重算；
 *   5. QuoterV2 报价：struct 参数（tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96）
 *      两个独立 RPC 重读，核对 quotedAmountOut／amountOutMinimum／sqrtPriceX96After／
 *      quoteGasEstimate；amountOutMinimum 必须 == ceil(quote×(10000−bps)/10000)
 *      （2026-10-06 IN-07 采纳的 ceil 约定，floor 会允许滑点略超 500bps）；
 *   6. routerBytecode.keccak256 与我方实测常量比对 + 双 RPC 现场重读；
 *   7. deadline 算术（routerCall.deadline = generatedAt + 600）与
 *      explicitLiveWindowNotes（同链、异 token）。
 *
 * 2026-10-06 v2（IN-07 五项修正强制化，不再宽容陈旧字段）：
 *   - wak.envelope.nonce 必须 == transaction.nonce（one source, one value）；
 *   - priorSeal.expected 必须绑定实际调用：asset 为完整 40 hex 的 WETH erc20
 *     CAIP-19、amount == approvedTest.amountInWei、transactionValue == tx.value == 0、
 *     expected.nonce == transaction.nonce、expected.calldataHash == tx.calldataHash；
 *   - constraints.maxGasUsed 必须 == transaction.gas（冻结 gas limit）；
 *   - network.rpcSnapshotBlock 必须存在、不得是旧硬编码 47668136、不得超前 live head。
 *
 * 全程只读（eth_call / eth_getCode / eth_blockNumber），不签名、不广播、不消耗 nonce。
 *
 * 用法：npm run verify:wak-frozen-multicall:sheet -- <path/to/run-sheet.json>
 * 可选环境变量：BASE_RPC / BASE_RPC2 覆盖默认两个独立 RPC。
 */

import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, keccak256, parseAbi, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RPCS = [
  process.env.BASE_RPC || 'https://base-sepolia-rpc.publicnode.com',
  process.env.BASE_RPC2 || 'https://sepolia.base.org',
];

const CHAIN_ID = 84532;
// 我方 INT-05 / INT-07 / 本脚本多轮双 RPC 实测的 SwapRouter02 runtime keccak256。
const ROUTER_KECCAK_EXPECTED = '0x60e9352f5af4eee63b41456f85bf80c63044e98123ad599d41d87f2d068de0be';
const SELECTOR_MULTICALL_DEADLINE = '0x5ae401dc';
const SELECTOR_EXACT_INPUT_SINGLE_7W = '0x04e45aaf';
const ENVELOPE_NAMESPACE = 'agent-call-envelope.v1';
const POLICY_NAMESPACE = 'web3-agent-kit.policy-decision.v1';

const sheetPath = process.argv[2];
if (!sheetPath) {
  console.error('Usage: node scripts/verify-wak-frozen-multicall-sheet.mjs <path/to/run-sheet.json>');
  process.exit(1);
}
type Sheet = Record<string, unknown>;
const sheet: Sheet = JSON.parse(readFileSync(resolve(process.cwd(), sheetPath), 'utf8'));

function section(title: string): void {
  console.log(`\n[${title}]`);
}

function domainDigest(namespace: string, payload: Record<string, unknown>): string {
  // 与 WAK envelope.py `_domain_hash` 一致：sort_keys + separators (',',':')，
  // namespace 与 "\0" 前置于 canonical JSON，sha256。
  const canonical = canonicalJson(payload);
  const body = `${namespace}\x00${canonical}`;
  return `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const clients = RPCS.map((url) => ({
    url,
    client: createPublicClient({ chain: baseSepolia, transport: http(url) }),
  }));

  section('1] sheet identity (read from bytes, not trusted from message)');
  const tx = sheet.transaction as Record<string, string>;
  const wak = sheet.wak as Record<string, unknown>;
  const envelope = wak.envelope as Record<string, string>;
  const policy = wak.policyDecision as Record<string, unknown>;
  console.log('schema:', sheet.schema);
  console.log('status:', sheet.status, '| authorization:', sheet.authorization);
  console.log('wakCommit:', sheet.wakCommit);
  console.log('generatedAt:', sheet.generatedAt);

  section('1b] rpcSnapshotBlock (live-read, not the old hardcoded value)');
  const network = (sheet.network ?? {}) as Record<string, string>;
  const snap = network.rpcSnapshotBlock;
  if (!snap) throw new Error('sheet.network.rpcSnapshotBlock missing');
  if (snap === '47668136') throw new Error('rpcSnapshotBlock is the old hardcoded 47668136; five-correction round requires the live-read head');
  const headNow = await clients[0].client.getBlockNumber();
  const snapNum = BigInt(snap);
  if (snapNum > headNow) throw new Error(`rpcSnapshotBlock ${snap} is ahead of live head ${headNow}`);
  console.log(`rpcSnapshotBlock=${snap} vs live head=${headNow} (lag ${headNow - snapNum} blocks; sheet is re-frozen at the live window)`);

  section('2] call shape (decode -> re-encode round-trip)');
  const data = tx.data;
  if (!data.startsWith(SELECTOR_MULTICALL_DEADLINE)) throw new Error(`calldata does not start with ${SELECTOR_MULTICALL_DEADLINE}`);
  const multicallAbi = parseAbi(['function multicall(uint256 deadline, bytes[] data)']);
  // manual decode: deadline word + array offset + count + element offset + element length + element bytes
  const rest = data.slice(10);
  const word = (i: number): string => rest.slice(i * 64, (i + 1) * 64);
  const deadline = BigInt('0x' + word(0));
  if (BigInt('0x' + word(1)) !== 0x40n) throw new Error('unexpected bytes[] offset');
  if (BigInt('0x' + word(2)) !== 1n) throw new Error('bytes[] must contain exactly one element');
  if (BigInt('0x' + word(3)) !== 0x20n) throw new Error('unexpected element offset');
  const innerLenBytes = Number(BigInt('0x' + word(4)));
  const innerHex = rest.slice(5 * 64, 5 * 64 + innerLenBytes * 2);
  if (innerHex.length !== innerLenBytes * 2) throw new Error('truncated inner calldata');
  const innerSelector = '0x' + innerHex.slice(0, 8);
  const innerWords = innerHex.slice(8).match(/.{64}/g) as string[];
  const reEncoded = encodeFunctionData({ abi: multicallAbi, functionName: 'multicall', args: [deadline, [`0x${innerHex}`]] });
  console.log('re-encode round-trip byte-identical:', reEncoded === data ? 'YES' : 'NO');
  console.log('multicall deadline:', deadline.toString(), '| deadlineSource:', (sheet.routerCall as Record<string, unknown>).deadlineSource);
  console.log('routerCall.deadline == generatedAt + 600:', BigInt((sheet.routerCall as Record<string, string>).deadline) === deadline && deadline === BigInt(sheet.generatedAt as string) + 600n ? 'YES' : 'NO');
  console.log('inner selector:', innerSelector, '| inner words:', innerWords.length);
  if (innerSelector !== SELECTOR_EXACT_INPUT_SINGLE_7W) throw new Error('inner selector is not the 7-word exactInputSingle');
  if (innerWords.length !== 7) throw new Error(`inner tuple has ${innerWords.length} words, expected 7`);
  const inner = {
    tokenIn: ('0x' + innerWords[0].slice(24)) as Address,
    tokenOut: ('0x' + innerWords[1].slice(24)) as Address,
    fee: Number(BigInt('0x' + innerWords[2])),
    recipient: ('0x' + innerWords[3].slice(24)) as Address,
    amountIn: BigInt('0x' + innerWords[4]),
    amountOutMinimum: BigInt('0x' + innerWords[5]),
    sqrtPriceLimitX96: BigInt('0x' + innerWords[6]),
  };
  console.log('inner:', JSON.stringify({ ...inner, tokenIn: inner.tokenIn, tokenOut: inner.tokenOut, recipient: inner.recipient }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const contracts = sheet.contracts as Record<string, string>;
  const shapeChecks: Array<[string, boolean]> = [
    ['value == 0', BigInt(tx.value) === 0n],
    ['tokenIn == contracts.weth', inner.tokenIn.toLowerCase() === contracts.weth.toLowerCase()],
    ['tokenOut == contracts.usdc', inner.tokenOut.toLowerCase() === contracts.usdc.toLowerCase()],
    ['fee == approvedTest.feeTier', inner.fee === Number((sheet.approvedTest as Record<string, unknown>).feeTier)],
    ['recipient == tx.from', inner.recipient.toLowerCase() === tx.from.toLowerCase()],
    ['amountIn == approvedTest.amountInWei', inner.amountIn === BigInt((sheet.approvedTest as Record<string, string>).amountInWei)],
    ['sqrtPriceLimitX96 == 0', inner.sqrtPriceLimitX96 === 0n],
    ['amountOutMinimum == quote.amountOutMinimum', inner.amountOutMinimum === BigInt((sheet.quote as Record<string, string>).amountOutMinimum)],
  ];
  for (const [name, ok] of shapeChecks) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (shapeChecks.some(([, ok]) => !ok)) throw new Error('call shape check failed');

  section('3] calldataHash (keccak256 of raw calldata)');
  const calldataHash = keccak256(data as `0x${string}`);
  const calldataMatch = calldataHash.toLowerCase() === tx.calldataHash.toLowerCase();
  console.log('recomputed:', calldataHash);
  console.log('sheet     :', tx.calldataHash, '=>', calldataMatch ? 'MATCH' : 'MISMATCH');
  if (!calldataMatch) throw new Error('calldataHash mismatch');

  section('4] envelopeDigest (WAK _domain_hash, sha256 canonical JSON)');
  // 注意：sheet 的 envelope.nonce 可能是陈旧显示值；from_transaction 绑定的是交易 nonce。
  const candidates = new Set<string>([envelope.nonce, tx.nonce]);
  let envelopeMatched: string | null = null;
  for (const nonce of candidates) {
    const payload = {
      schema: ENVELOPE_NAMESPACE,
      chainId: Number(tx.chainId),
      executionProfile: envelope.executionProfile,
      executor: envelope.executor.toLowerCase(),
      nonce: String(BigInt(nonce)),
      calldataHash: calldataHash,
      nativeValue: String(BigInt(envelope.nativeValue)),
      target: envelope.target.toLowerCase(),
    };
    const digest = domainDigest(ENVELOPE_NAMESPACE, payload);
    const match = digest.toLowerCase() === (wak.envelopeDigest as string).toLowerCase();
    console.log(`recomputed (nonce=${nonce}):`, digest, match ? '=> MATCHES SHEET' : '');
    if (match) envelopeMatched = nonce;
  }
  if (envelopeMatched === null) throw new Error('envelopeDigest does not match any nonce candidate');
  if (envelope.nonce !== tx.nonce) {
    throw new Error(`wak.envelope.nonce=${envelope.nonce} != transaction.nonce=${tx.nonce}: five-correction round requires one source, one value (287)`);
  }
  console.log(`envelope.nonce == transaction.nonce == ${tx.nonce}: OK (single source)`);

  section('5] policyCommitmentDigest (same algorithm)');
  const policyPayload = {
    schema: POLICY_NAMESPACE,
    callIdentity: wak.envelopeDigest as string,
    policyId: policy.policyId as string,
    policyVersion: policy.policyVersion as string,
    verdict: policy.verdict as string,
    reasonCodes: policy.reasonCodes as string[],
    evaluatedAt: policy.evaluatedAt as number,
  };
  const policyDigest = domainDigest(POLICY_NAMESPACE, policyPayload);
  const policyMatch = policyDigest.toLowerCase() === (wak.policyCommitmentDigest as string).toLowerCase();
  console.log('recomputed:', policyDigest, policyMatch ? '=> MATCHES SHEET' : '=> MISMATCH');
  if (!policyMatch) throw new Error('policyCommitmentDigest mismatch');

  section('5b] priorSeal.expected binding (five-correction round, binds the ACTUAL call)');
  const ps = sheet.priorSeal as Record<string, unknown> | undefined;
  if (!ps || typeof ps !== 'object') throw new Error('sheet.priorSeal missing');
  const expected = ps.expected as Record<string, string> | undefined;
  if (!expected) throw new Error('sheet.priorSeal.expected missing');
  const constraints = ((expected.constraints as unknown) ?? {}) as Record<string, string>;
  const assetStr = String(expected.asset ?? '');
  const assetFullHex = /^eip155:84532\/erc20:0x[0-9a-fA-F]{40}$/.test(assetStr);
  const assetIsWeth = assetStr.toLowerCase() === `eip155:84532/erc20:${String(contracts.weth).toLowerCase()}`;
  const approved = sheet.approvedTest as Record<string, string>;
  const psChecks: Array<[string, boolean]> = [
    ['asset is full 40-hex erc20 CAIP-19 (not truncated)', assetFullHex],
    ['asset == WETH (the spent token)', assetIsWeth],
    ['amount == approvedTest.amountInWei', String(expected.amount) === String(approved.amountInWei)],
    ['transactionValue == tx.value == 0', String(expected.transactionValue) === String(tx.value) && BigInt(tx.value) === 0n],
    ['expected.nonce == transaction.nonce', String(expected.nonce) === String(tx.nonce)],
    ['expected.calldataHash == tx.calldataHash', String(expected.calldataHash).toLowerCase() === tx.calldataHash.toLowerCase()],
    ['constraints.maxGasUsed == transaction.gas (frozen gas limit)', String(constraints.maxGasUsed) === String(tx.gas)],
  ];
  for (const [name, ok] of psChecks) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (psChecks.some(([, ok]) => !ok)) throw new Error('priorSeal.expected binding check failed');

  section('6] QuoterV2 re-read (struct params, two RPCs) + slippage rounding');
  const quoterAbi = parseAbi([
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  ]);
  const quoteParams = {
    tokenIn: contracts.weth as Address,
    tokenOut: contracts.usdc as Address,
    amountIn: inner.amountIn,
    fee: inner.fee,
    sqrtPriceLimitX96: 0n,
  };
  const quoteCalldata = encodeFunctionData({ abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [quoteParams] });
  const quote = sheet.quote as Record<string, string>;
  for (const { url, client } of clients) {
    const result = await client.call({ to: contracts.quoter as Address, data: quoteCalldata });
    const decodedQuote = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data: result.data ?? '0x' });
    const head = await client.getBlockNumber();
    const q = {
      amountOut: decodedQuote[0].toString(),
      sqrtPriceX96After: decodedQuote[1].toString(),
      initializedTicksCrossed: decodedQuote[2],
      gasEstimate: decodedQuote[3].toString(),
    };
    console.log(`${url} (head ${head}) =>`, JSON.stringify(q));
    console.log(`  sheet quote: quotedAmountOut=${quote.quotedAmountOut} amountOutMinimum=${quote.amountOutMinimum} sqrtAfter=${quote.sqrtPriceX96After} gas=${quote.quoteGasEstimate}`);
    const amountOutMatch = q.amountOut === quote.quotedAmountOut;
    console.log(`  amountOut matches sheet: ${amountOutMatch ? 'YES' : `NO (chain moved? recompute at re-freeze)`}`);
    const maxSlippageBps = Number((sheet.approvedTest as Record<string, unknown>).maxSlippageBps);
    const quoteNum = BigInt(quote.quotedAmountOut);
    const floorMin = (quoteNum * BigInt(10000 - maxSlippageBps)) / 10000n;
    const ceilMin = (quoteNum * BigInt(10000 - maxSlippageBps) + 9999n) / 10000n;
    const declaredMin = BigInt(quote.amountOutMinimum);
    console.log(`  min=${declaredMin} | floor(quote*(1-${maxSlippageBps}bps))=${floorMin} | ceil=${ceilMin}`);
    if (declaredMin !== ceilMin) {
      throw new Error(`amountOutMinimum ${declaredMin} != ceil(quote*(1-${maxSlippageBps}bps))=${ceilMin}: agreed ceil convention (five-correction round)`);
    }
    console.log(`  amountOutMinimum == ceil(quote*(1-${maxSlippageBps}bps)): OK (strict ${maxSlippageBps}bps cap)`);
  }

  section('7] routerBytecode keccak256 (constant + live double-RPC re-read)');
  const routerBytecode = sheet.routerBytecode as Record<string, string>;
  const constantMatch = routerBytecode.keccak256.toLowerCase() === ROUTER_KECCAK_EXPECTED.toLowerCase();
  console.log('sheet constant:', routerBytecode.keccak256, constantMatch ? '=> matches our INT-05/INT-07 measured value' : '=> MISMATCH vs our measured value');
  for (const { url, client } of clients) {
    const code = await client.getBytecode({ address: contracts.router as Address });
    if (!code) throw new Error(`router has no code at ${url}`);
    const hash = keccak256(code);
    console.log(`${url} live keccak256:`, hash, hash.toLowerCase() === ROUTER_KECCAK_EXPECTED.toLowerCase() ? 'MATCH' : 'MISMATCH');
  }

  section('8] explicitLiveWindowNotes');
  const notes = sheet.explicitLiveWindowNotes as Record<string, unknown>;
  const chainNotes = notes.evidenceVsExecutionChain as Record<string, unknown>;
  const tokenNotes = notes.sourceVsDestinationToken as Record<string, unknown>;
  console.log('evidence chain == execution chain:', chainNotes.same === true && chainNotes.evidenceChainId === CHAIN_ID ? 'YES (84532)' : 'NO');
  console.log('source token != destination token:', tokenNotes.same === false ? 'YES (WETH != USDC)' : 'NO');

  console.log('\nConclusion: all checks above are read-only recomputations from the sheet bytes and live chain state.');
}

main().catch((error) => {
  console.error('VERIFY FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
