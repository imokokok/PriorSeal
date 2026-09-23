// Public deterministic SIMULATION only; not production keys, deployments or feeds.
import { encodeFunctionData, keccak256, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { RwaCallProfileV1, RwaEvidence, RwaTrustV2, SignedRwaReportV2 } from '../../sdk/dist/index.js';
import { rwaFixture, type RwaFixture } from '../rwa-v1/fixture.mjs';

type RwaSdk = typeof import('../../sdk/dist/index.js');
export type RwaV2Fixture = RwaFixture & { callProfile: RwaCallProfileV1; receiverEvidence: RwaEvidence };
export type SignedRwaV2Fixture = { proof: SignedRwaReportV2; trust: RwaTrustV2 };

export function rwaV2Fixture(sdk: RwaSdk, now = 1800000000): RwaV2Fixture {
  const f = rwaFixture(sdk, now);
  const quote = ('0x' + '44'.repeat(20)) as `0x${string}`, receiver = ('0x' + '55'.repeat(20)) as `0x${string}`;
  f.transaction.data = encodeFunctionData({ abi: sdk.RWA_SWAP_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: quote, tokenOut: f.input.instrument.tokenAddress as `0x${string}`, fee: 3000, recipient: receiver, deadline: BigInt(now + 120), amountIn: BigInt(f.input.request.amount), amountOutMinimum: 900000n, sqrtPriceLimitX96: 0n }] });
  f.input.request.call.calldataHash = keccak256(f.transaction.data as Hex);
  const callProfile: RwaCallProfileV1 = { schema: 'insight.rwa-call-profile.v1', adapter: 'uniswap-v3-exact-input-single', chainId: 8453, target: f.transaction.to, instrumentId: f.input.request.instrumentId, quoteToken: quote, allowedFees: [3000] };
  const eligibility = f.input.evidence.find(e => e.kind === 'eligibility');
  if (!eligibility) throw new TypeError('Simulation fixture requires eligibility evidence');
  const receiverEvidence: RwaEvidence = { ...eligibility, subject: receiver };
  return Object.assign(f, { callProfile, receiverEvidence });
}
export async function signRwaV2Fixture(sdk: RwaSdk, account: PrivateKeyAccount, f: RwaV2Fixture, sequence = '0', previousDigest: string | null = null): Promise<SignedRwaV2Fixture> {
  const report = sdk.buildRwaReportV2(f.input, f.policy, f.now, { sequence, previousDigest, transaction: f.transaction, callProfile: f.callProfile, receiverEvidence: f.receiverEvidence });
  return { proof: { report, digest: sdk.rwaV2ReportDigest(report), signer: account.address, signature: await account.signTypedData(sdk.rwaV2SigningData(report)) }, trust: { policy: structuredClone(f.policy), policyId: sdk.rwaPolicyId(f.policy), request: structuredClone(f.input.request), environment: f.policy.environment, keys: [{ address: account.address, validFrom: 1799996400, validUntil: 1800003600, revoked: false }], callProfile: structuredClone(f.callProfile) } };
}
