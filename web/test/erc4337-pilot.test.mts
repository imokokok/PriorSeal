import test from 'node:test'
import assert from 'node:assert/strict'
import { createWalletClient, custom, encodeFunctionData, hashTypedData, keccak256, parseAbi, recoverTypedDataAddress, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { toPackedUserOperation } from 'viem/account-abstraction'
import { baseSepolia } from 'viem/chains'
import { assessPilotObservation, clearPilotRecoveryRecord, createPilotRecoveryRecord, isPilotSubmissionEligible, PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_OWNER, PILOT_SAFE, pilotFinalityConstraints, readPilotRecoveryRecord, reconcilePilotRecoveryLookups, savePilotRecoveryRecord, withPilotLookupTimeout } from '../src/lib/erc4337-pilot.ts'
import { assessEip7702Observation, createEip7702RecoveryRecord, eip7702FinalityConstraints, isEip7702SubmissionEligible, PILOT_7702_DELEGATE, PILOT_7702_DELEGATE_CODE_HASH, readEip7702RecoveryRecord, reconcileEip7702Lookups, saveEip7702RecoveryRecord } from '../src/lib/eip7702-pilot.ts'
import { createMetaMask7702PilotAccount, encodeMetaMask7702PilotCall } from '../src/lib/metamask-7702-account.ts'
import type { ObservationResult } from 'priorseal-sdk'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const storage = new MemoryStorage()
const userOperation = {
  sender: PILOT_SAFE,
  nonce: '7',
  callData: encodeFunctionData({
    abi: parseAbi(['function executeUserOp(address to,uint256 value,bytes data,uint8 operation)']),
    functionName: 'executeUserOp',
    args: [PILOT_OWNER, 0n, '0x', 0],
  }),
  callGasLimit: '100000',
  verificationGasLimit: '200000',
  preVerificationGas: '21000',
  maxFeePerGas: '100',
  maxPriorityFeePerGas: '2',
  signature: '0x1234',
}
const recovery = createPilotRecoveryRecord({ userOperation, authorizationId: 'auth_test-123' })
const txHash = `0x${'a'.repeat(64)}`
const eipSender = '0x2222222222222222222222222222222222222222' as const
const eipUserOperation = {
  sender: eipSender,
  nonce: '3',
  callData: encodeMetaMask7702PilotCall(),
  callGasLimit: '90000',
  verificationGasLimit: '180000',
  preVerificationGas: '26000',
  maxFeePerGas: '200',
  maxPriorityFeePerGas: '3',
  signature: `0x${'11'.repeat(65)}`,
}
const eipRecovery = createEip7702RecoveryRecord({ sender: eipSender, userOperation: eipUserOperation, authorizationId: 'auth_7702-test' })

function finalObservation(status: 'CONFIRMED' | 'REVERTED' = 'CONFIRMED'): ObservationResult {
  return {
    observation: {
      chainId: PILOT_CHAIN_ID,
      txHash,
      status,
      action: 'ERC4337_USER_OPERATION',
      sender: PILOT_SAFE,
      nonce: '7',
      executionDataAvailable: true,
      userOperationHash: recovery.userOperationHash,
      entryPoint: PILOT_ENTRY_POINT,
      entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
      entryPointVersion: '0.7',
      userOperationSuccess: status === 'CONFIRMED',
      actualGasCost: '831064000000',
      gasUsed: '127856',
      accountCallProfile: 'safe-4337.v1',
      accountCallTarget: PILOT_OWNER,
      accountCallValue: '0',
      accountCallDataHash: keccak256('0x'),
      finalityState: 'CONFIRMED',
      confirmations: 2,
      blockNumber: 10,
      blockHash: `0x${'b'.repeat(64)}`,
      temporalEvidence: { schema: 'priorseal.temporal-evidence.v1', criterion: 'CONFIRMATIONS', requiredConfirmations: 2, maxToleratedReorgDepth: 1, observedHeadNumber: 11, observedHeadHash: `0x${'c'.repeat(64)}`, finalizedBlock: null },
    },
    receipt: null,
    authorizationAssociation: 'FINAL',
    executionCorrelation: 'MATCH',
  }
}

test('pilot recovery record survives storage round trips and binds the signed UserOperation hash', () => {
  const record = createPilotRecoveryRecord({ userOperation, authorizationId: 'auth_test-123' })
  savePilotRecoveryRecord(record, storage)
  const recovered = readPilotRecoveryRecord(storage)
  assert.equal(recovered.error, null)
  assert.equal(recovered.record?.userOperationHash, record.userOperationHash)
  assert.equal(recovered.record?.authorizationId, 'auth_test-123')
  assert.equal(recovered.record?.entryPoint, PILOT_ENTRY_POINT)
  assert.equal(recovered.record?.entryPointCodeHash, PILOT_ENTRY_POINT_CODE_HASH)
  assert.equal(recovered.record?.userOperation.nonce, '7')
  clearPilotRecoveryRecord(storage)
  assert.deepEqual(readPilotRecoveryRecord(storage), { record: null, error: null })
})

test('pilot recovery reader rejects tampered operation hashes and unsupported fields', () => {
  const record = createPilotRecoveryRecord({ userOperation, authorizationId: 'auth_test-123' })
  storage.setItem('priorseal.erc4337-pilot-recovery.v1', JSON.stringify({ ...record, userOperation: { ...record.userOperation, nonce: '8' } }))
  assert.match(readPilotRecoveryRecord(storage).error ?? '', /does not match its recorded hash/)

  storage.setItem('priorseal.erc4337-pilot-recovery.v1', JSON.stringify({ ...record, extra: true }))
  assert.match(readPilotRecoveryRecord(storage).error ?? '', /unsupported field/)
})

test('legacy uncertain checkpoints are conservatively counted and a retry requires an explicit authorized state', () => {
  const legacy: Record<string, unknown> = { ...recovery, stage: 'SUBMITTING' }
  delete legacy.submissionAttempts
  storage.setItem('priorseal.erc4337-pilot-recovery.v1', JSON.stringify(legacy))
  const restored = readPilotRecoveryRecord(storage).record!
  assert.equal(restored.submissionAttempts, 1)
  assert.equal(isPilotSubmissionEligible(restored), false)

  const authorized = createPilotRecoveryRecord({ userOperation, authorizationId: 'auth_test-123' })
  assert.equal(isPilotSubmissionEligible(authorized), true)
  assert.equal(isPilotSubmissionEligible({ ...authorized, submissionAttempts: 2 }), false)
  assert.equal(isPilotSubmissionEligible({ ...authorized, stage: 'SUBMITTED' }), false)
})

test('pilot intent always binds a confirmation and reorg buffer at least as strong as deployment policy', () => {
  assert.deepEqual(pilotFinalityConstraints({ minConfirmations: 0, maxToleratedReorgDepth: null, finalityRequirement: 'CONFIRMATIONS' }), { minConfirmations: 2, maxToleratedReorgDepth: 1 })
  assert.deepEqual(pilotFinalityConstraints({ minConfirmations: 9, maxToleratedReorgDepth: 4, finalityRequirement: 'RPC_FINALIZED' }), { minConfirmations: 9, maxToleratedReorgDepth: 4, finalityRequirement: 'RPC_FINALIZED' })
})

test('recovery reconciliation uses a positive source even when a separate provider is unavailable', () => {
  const result = reconcilePilotRecoveryLookups({
    expectedUserOperationHash: recovery.userOperationHash,
    bundlerReceipt: { status: 'rejected', reason: new Error('timeout') },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'fulfilled', value: txHash },
  })
  assert.deepEqual(result, { kind: 'INCLUDED', transactionHash: txHash, source: 'entrypoint-event' })
})

test('recovery refuses a retry when any negative lookup is incomplete or bundler still knows the operation', () => {
  const expectedUserOperationHash = recovery.userOperationHash
  const indeterminate = reconcilePilotRecoveryLookups({
    expectedUserOperationHash,
    bundlerReceipt: { status: 'fulfilled', value: null },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'rejected', reason: new Error('trace RPC unavailable') },
  })
  const pending = reconcilePilotRecoveryLookups({
    expectedUserOperationHash,
    bundlerReceipt: { status: 'fulfilled', value: null },
    bundlerOperation: { status: 'fulfilled', value: { transactionHash: null } },
    entryPointEvent: { status: 'rejected', reason: new Error('timeout') },
  })
  const absent = reconcilePilotRecoveryLookups({
    expectedUserOperationHash,
    bundlerReceipt: { status: 'fulfilled', value: null },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'fulfilled', value: null },
  })
  assert.deepEqual(indeterminate, { kind: 'INDETERMINATE' })
  assert.deepEqual(pending, { kind: 'PENDING' })
  assert.deepEqual(absent, { kind: 'ABSENT' })
})

test('provider lookup timeout is bounded and reported for read-only recovery', async () => {
  await assert.rejects(withPilotLookupTimeout(new Promise<string>(() => {}), 'EntryPoint event lookup', 5), /EntryPoint event lookup timed out/)
})

test('recovery rejects mismatched bundler hashes and malformed inclusion data', () => {
  assert.throws(() => reconcilePilotRecoveryLookups({
    expectedUserOperationHash: recovery.userOperationHash,
    bundlerReceipt: { status: 'fulfilled', value: { userOpHash: txHash, sender: PILOT_SAFE, receipt: { transactionHash: txHash } } },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'fulfilled', value: null },
  }), /different or malformed UserOperation/)
})

test('only matching, final, confirmed UserOperations become exportable', () => {
  const assessment = assessPilotObservation(finalObservation(), recovery, txHash)
  assert.deepEqual(assessment, { kind: 'FINAL', status: 'CONFIRMED', actualGasCost: '831064000000', actualGasUsed: '127856', confirmations: 2 })
})

test('a reverted UserOperation is final evidence with its actual charged gas', () => {
  const assessment = assessPilotObservation(finalObservation('REVERTED'), recovery, txHash)
  assert.deepEqual(assessment, { kind: 'FINAL', status: 'REVERTED', actualGasCost: '831064000000', actualGasUsed: '127856', confirmations: 2 })
})

test('pending and reorged observations stay recoverable and cannot be exported', () => {
  const pending = finalObservation()
  pending.observation.status = 'PENDING'
  const reorged = finalObservation()
  reorged.observation.status = 'REORGED'
  assert.deepEqual(assessPilotObservation(pending, recovery, txHash), { kind: 'PENDING' })
  assert.deepEqual(assessPilotObservation(reorged, recovery, txHash), { kind: 'REORGED' })
})

test('mismatched operation identity, weak finality and invalid receipt signatures fail closed', () => {
  const wrongHash = finalObservation()
  wrongHash.observation.userOperationHash = txHash
  assert.throws(() => assessPilotObservation(wrongHash, recovery, txHash), /does not match the saved UserOperation event/)

  const weakFinality = finalObservation()
  weakFinality.observation.temporalEvidence!.requiredConfirmations = 0
  assert.throws(() => assessPilotObservation(weakFinality, recovery, txHash), /confirmation and execution-evidence requirements/)

  const invalidReceipt = finalObservation()
  invalidReceipt.receipt = {} as NonNullable<ObservationResult['receipt']>
  invalidReceipt.verification = { valid: false, code: 'INVALID_SIGNATURE' } as ObservationResult['verification']
  assert.throws(() => assessPilotObservation(invalidReceipt, recovery, txHash), /receipt failed verification/)
})

test('MetaMask 7702 recovery persists and binds the exact predelegated EOA operation', () => {
  const record = createEip7702RecoveryRecord({ sender: eipSender, userOperation: eipUserOperation, authorizationId: 'auth_7702-test' })
  saveEip7702RecoveryRecord(record, storage)
  const restored = readEip7702RecoveryRecord(storage)
  assert.equal(restored.error, null)
  assert.equal(restored.record?.userOperationHash, record.userOperationHash)
  assert.equal(restored.record?.sender, eipSender)
  assert.equal(restored.record?.delegateAddress, PILOT_7702_DELEGATE)
  assert.equal(restored.record?.delegateCodeHash, PILOT_7702_DELEGATE_CODE_HASH)
})

test('MetaMask 7702 submission requires a fresh authorized stage and a bounded retry count', () => {
  assert.equal(isEip7702SubmissionEligible(eipRecovery), true)
  assert.equal(isEip7702SubmissionEligible({ ...eipRecovery, stage: 'SUBMITTING', submissionAttempts: 1 }), false)
  assert.equal(isEip7702SubmissionEligible({ ...eipRecovery, stage: 'AUTHORIZED', submissionAttempts: 2 }), false)
})

test('MetaMask 7702 recovery accepts matching inclusion and keeps uncertain lookups fail-closed', () => {
  const included = reconcileEip7702Lookups({
    expectedUserOperationHash: eipRecovery.userOperationHash,
    expectedSender: eipSender,
    bundlerReceipt: { status: 'fulfilled', value: { userOpHash: eipRecovery.userOperationHash, sender: eipSender, receipt: { transactionHash: txHash } } },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'rejected', reason: new Error('RPC timeout') },
  })
  const uncertain = reconcileEip7702Lookups({
    expectedUserOperationHash: eipRecovery.userOperationHash,
    expectedSender: eipSender,
    bundlerReceipt: { status: 'fulfilled', value: null },
    bundlerOperation: { status: 'rejected', reason: new Error('bundler timeout') },
    entryPointEvent: { status: 'fulfilled', value: null },
  })
  assert.deepEqual(included, { kind: 'INCLUDED', transactionHash: txHash, source: 'bundler-receipt' })
  assert.deepEqual(uncertain, { kind: 'INDETERMINATE' })
  assert.throws(() => reconcileEip7702Lookups({
    expectedUserOperationHash: eipRecovery.userOperationHash,
    expectedSender: eipSender,
    bundlerReceipt: { status: 'fulfilled', value: { userOpHash: txHash, sender: eipSender, receipt: { transactionHash: txHash } } },
    bundlerOperation: { status: 'fulfilled', value: null },
    entryPointEvent: { status: 'fulfilled', value: null },
  }), /different or malformed UserOperation/)
})

test('MetaMask 7702 finality policy carries a confirmation and reorg buffer', () => {
  assert.deepEqual(eip7702FinalityConstraints({ minConfirmations: 0, maxToleratedReorgDepth: null, finalityRequirement: 'CONFIRMATIONS' }), { minConfirmations: 2, maxToleratedReorgDepth: 1 })
  assert.deepEqual(eip7702FinalityConstraints({ minConfirmations: 8, maxToleratedReorgDepth: 3, finalityRequirement: 'RPC_FINALIZED' }), { minConfirmations: 8, maxToleratedReorgDepth: 3, finalityRequirement: 'RPC_FINALIZED' })
})

test('MetaMask 7702 success and failure outcomes require matching delegate and finality evidence', () => {
  const base = {
    chainId: 84532,
    txHash,
    status: 'CONFIRMED',
    action: 'ERC4337_USER_OPERATION',
    sender: eipSender,
    nonce: '3',
    executionDataAvailable: true,
    userOperationHash: eipRecovery.userOperationHash,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    userOperationSuccess: true,
    actualGasCost: '700000000000',
    gasUsed: '120000',
    finalityState: 'CONFIRMED',
    confirmations: 3,
    blockNumber: 40,
    blockHash: `0x${'b'.repeat(64)}`,
    temporalEvidence: { schema: 'priorseal.temporal-evidence.v1', criterion: 'CONFIRMATIONS', requiredConfirmations: 3, maxToleratedReorgDepth: 1, observedHeadNumber: 42, observedHeadHash: `0x${'c'.repeat(64)}`, finalizedBlock: null },
    eip7702Delegation: { schema: 'priorseal.eip7702.delegation-evidence.v1', delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH, authorizationTupleHash: null, authorizationIncluded: false, operationIncluded: true, operationSuccess: true, outerTransactionStatus: 'SUCCESS', outerTransactionGasUsed: '200000', outerTransactionFee: '800000000000', stateAtTransactionEnd: 'ACTIVE', delegateObservedForExecution: PILOT_7702_DELEGATE, delegateAfter: PILOT_7702_DELEGATE, transition: 'UNCHANGED' },
  }
  const result = (observation: Record<string, unknown>) => ({ observation, receipt: null, authorizationAssociation: 'FINAL', executionCorrelation: 'MATCH' }) as unknown as ObservationResult
  assert.deepEqual(assessEip7702Observation(result(base), eipRecovery, txHash), { kind: 'FINAL', status: 'CONFIRMED', actualGasCost: '700000000000', actualGasUsed: '120000', outerTransactionFee: '800000000000', confirmations: 3 })
  assert.deepEqual(assessEip7702Observation(result({ ...base, status: 'PENDING' }), eipRecovery, txHash), { kind: 'PENDING' })
  assert.throws(() => assessEip7702Observation(result({ ...base, eip7702Delegation: { ...base.eip7702Delegation, stateAtTransactionEnd: 'UNDELEGATED' } }), eipRecovery, txHash), /predelegated MetaMask UserOperation evidence/)
})

test('MetaMask 7702 account signs the packed v0.7 digest with the connected EOA', async () => {
  const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
  const operation = { ...eipUserOperation, sender: signer.address, nonce: 3n, callGasLimit: 90000n, verificationGasLimit: 180000n, preVerificationGas: 26000n, maxFeePerGas: 200n, maxPriorityFeePerGas: 3n } as const
  const fakeClient = {
    chain: { id: 84532 },
    async readContract(input: { args: [unknown] }) {
      const packed = input.args[0] as Record<string, unknown>
      return hashTypedData({
        domain: { name: 'EIP7702StatelessDeleGator', version: '1', chainId: 84532, verifyingContract: signer.address },
        types: { PackedUserOperation: [
          { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' }, { name: 'accountGasLimits', type: 'bytes32' }, { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' }, { name: 'paymasterAndData', type: 'bytes' }, { name: 'entryPoint', type: 'address' },
        ] },
        primaryType: 'PackedUserOperation',
        message: { ...packed, entryPoint: PILOT_ENTRY_POINT },
      })
    },
  } as never
  const provider = { request: async ({ method, params }: { method: string; params: unknown[] }) => {
    assert.equal(method, 'eth_signTypedData_v4')
    const data = JSON.parse(String(params[1])) as Parameters<typeof signer.signTypedData>[0]
    return signer.signTypedData(data)
  } }
  const walletClient = createWalletClient({ account: signer.address, chain: baseSepolia, transport: custom(provider as never) })
  const account = await createMetaMask7702PilotAccount({ client: fakeClient, walletClient: walletClient as never, address: signer.address })
  const signature = await account.signUserOperation({ ...operation, chainId: 84532 } as never)
  const packed = toPackedUserOperation({ ...operation, signature: '0x' } as never, { forHash: true })
  const typedData = {
    domain: { name: 'EIP7702StatelessDeleGator', version: '1', chainId: 84532, verifyingContract: signer.address },
    types: { PackedUserOperation: [
      { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'initCode', type: 'bytes' },
      { name: 'callData', type: 'bytes' }, { name: 'accountGasLimits', type: 'bytes32' }, { name: 'preVerificationGas', type: 'uint256' },
      { name: 'gasFees', type: 'bytes32' }, { name: 'paymasterAndData', type: 'bytes' }, { name: 'entryPoint', type: 'address' },
    ] },
    primaryType: 'PackedUserOperation',
    message: { ...packed, entryPoint: PILOT_ENTRY_POINT },
  } as const
  assert.equal(await recoverTypedDataAddress({ ...typedData, signature }), signer.address)
  assert.equal(signature.length, 132)
  assert.equal(operation.callData, encodeMetaMask7702PilotCall(zeroAddress))
})
