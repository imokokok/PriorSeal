import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, keccak256, parseAbi } from 'viem'
import { assessPilotObservation, clearPilotRecoveryRecord, createPilotRecoveryRecord, isPilotSubmissionEligible, PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_OWNER, PILOT_SAFE, pilotFinalityConstraints, readPilotRecoveryRecord, reconcilePilotRecoveryLookups, savePilotRecoveryRecord, withPilotLookupTimeout } from '../src/lib/erc4337-pilot.ts'
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
