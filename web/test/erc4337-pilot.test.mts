import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, parseAbi } from 'viem'
import { clearPilotRecoveryRecord, createPilotRecoveryRecord, readPilotRecoveryRecord, savePilotRecoveryRecord, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_OWNER, PILOT_SAFE } from '../src/lib/erc4337-pilot.ts'

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
