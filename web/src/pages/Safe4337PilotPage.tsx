import { useEffect, useRef, useState } from 'react'
import { GenericFeeEstimator, Safe4337Pack } from '@safe-global/relay-kit'
import { formatEther } from 'viem'
import { buildERC4337UserOperationIntent, generateAuthorizationNonce } from 'priorseal-sdk'
import { CodeValue, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, type Capabilities } from '../lib/api'
import { downloadJson } from '../lib/download'
import { clearPilotRecoveryRecord, createPilotRecoveryRecord, PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_MODULE, PILOT_OWNER, PILOT_SAFE, PILOT_USER_OPERATION_EVENT_TOPIC, readPilotRecoveryRecord, savePilotRecoveryRecord, type PilotRecoveryRecord } from '../lib/erc4337-pilot'
import { session } from '../lib/storage'
import type { AuthorizationRecord, Eip1193Provider, Intent, ObservationResult } from '../types'

const BUNDLER_URL = new URL('/__priorseal_bundler', window.location.origin).toString()
const RPC_URL = new URL('/__priorseal_rpc', window.location.origin).toString()
const userOperationHashPattern = /^0x[0-9a-f]{64}$/i

type SafeOperation = Awaited<ReturnType<Safe4337Pack['createTransaction']>>
type GasSummary = { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint; maxFeePerGas: bigint; maxCost: bigint; balance: bigint; nonce: string }
type PilotPhase = 'idle' | 'estimated' | 'safe-signed' | 'authorized' | 'submitted' | 'complete'

function cleanError(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
  const value = `${error instanceof Error ? error.message : 'The operation could not be completed.'}${cause}`
  return value.replace(/https?:\/\/\S+/g, '[provider URL hidden]').replace(/\bak_[A-Za-z0-9]+\b/g, '[API key hidden]').slice(0, 300)
}

function normalizeUserOperation(operation: SafeOperation) {
  const raw = operation.getUserOperation() as unknown as Record<string, unknown>
  const normalized: Record<string, unknown> = {
    sender: raw.sender,
    nonce: raw.nonce,
    callData: raw.callData,
    callGasLimit: raw.callGasLimit,
    verificationGasLimit: raw.verificationGasLimit,
    preVerificationGas: raw.preVerificationGas,
    maxFeePerGas: raw.maxFeePerGas,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas,
    signature: raw.signature,
  }
  for (const field of ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) {
    const value = raw[field]
    if (value !== undefined && value !== null) normalized[field] = BigInt(String(value)).toString(10)
  }
  for (const field of ['factory', 'factoryData', 'paymaster', 'paymasterData'] as const) {
    const value = raw[field]
    if (value === undefined || value === null || (['factory', 'paymaster'].includes(field) && value === '0x')) continue
    normalized[field] = value
  }
  return normalized
}

function asGasSummary(operation: SafeOperation, balance: bigint): GasSummary {
  const userOperation = operation.getUserOperation() as unknown as Record<string, unknown>
  const callGasLimit = BigInt(String(userOperation.callGasLimit))
  const verificationGasLimit = BigInt(String(userOperation.verificationGasLimit))
  const preVerificationGas = BigInt(String(userOperation.preVerificationGas))
  const maxFeePerGas = BigInt(String(userOperation.maxFeePerGas))
  const maxCost = (callGasLimit + verificationGasLimit + preVerificationGas) * maxFeePerGas
  return { callGasLimit, verificationGasLimit, preVerificationGas, maxFeePerGas, maxCost, balance, nonce: BigInt(String(userOperation.nonce)).toString() }
}

function formatEth(value: bigint) {
  return `${formatEther(value)} ETH`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function pilotRpcResult(method: string, params: unknown[]) {
  const id = crypto.randomUUID()
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(18_000),
  })
  const envelope: unknown = await response.json()
  if (!response.ok || !isRecord(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id || ('error' in envelope) === ('result' in envelope)) throw new Error('Base Sepolia RPC lookup failed')
  if ('error' in envelope) throw new Error('Base Sepolia RPC lookup failed')
  return envelope.result
}

async function findUserOperationEventTransactionHash(userOperationHash: string) {
  const latestBlock = await pilotRpcResult('eth_getBlockByNumber', ['latest', false])
  if (!isRecord(latestBlock) || typeof latestBlock.number !== 'string' || !/^0x[0-9a-f]+$/i.test(latestBlock.number)) throw new Error('Base Sepolia RPC returned an invalid latest block')
  const latest = BigInt(latestBlock.number)
  const fromBlock = latest > 9_999n ? latest - 9_999n : 0n
  const logs = await pilotRpcResult('eth_getLogs', [{
    address: PILOT_ENTRY_POINT,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: latestBlock.number,
    topics: [PILOT_USER_OPERATION_EVENT_TOPIC, userOperationHash],
  }])
  if (!Array.isArray(logs) || logs.length > 1) throw new Error('Base Sepolia RPC returned an ambiguous EntryPoint event result')
  if (!logs.length) return null
  const log = logs[0]
  if (!isRecord(log)
    || typeof log.address !== 'string'
    || log.address.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()
    || !Array.isArray(log.topics)
    || log.topics.length !== 4
    || !log.topics.every((topic) => typeof topic === 'string' && userOperationHashPattern.test(topic))
    || typeof log.topics[0] !== 'string'
    || log.topics[0].toLowerCase() !== PILOT_USER_OPERATION_EVENT_TOPIC.toLowerCase()
    || typeof log.topics[1] !== 'string'
    || log.topics[1].toLowerCase() !== userOperationHash.toLowerCase()
    || typeof log.data !== 'string'
    || !/^0x[0-9a-f]{256}$/i.test(log.data)
    || typeof log.blockNumber !== 'string'
    || !/^0x[0-9a-f]+$/i.test(log.blockNumber)
    || typeof log.blockHash !== 'string'
    || !userOperationHashPattern.test(log.blockHash)
    || typeof log.transactionHash !== 'string'
    || !userOperationHashPattern.test(log.transactionHash)
    || (log.removed !== undefined && typeof log.removed !== 'boolean')) throw new Error('Base Sepolia RPC returned an invalid EntryPoint event')
  return log.removed === true ? null : log.transactionHash.toLowerCase()
}

async function waitForUserOperationInclusion(pack: Safe4337Pack, userOperationHash: string, onStatus: (status: string) => void) {
  const deadline = Date.now() + 120_000
  let attempt = 0
  let lastLookupFailed = false
  let chainLookupFailed = false
  while (Date.now() < deadline) {
    let requestTimer: number | undefined
    let bundlerLookupFailed = false
    try {
      const receipt = await Promise.race([
        pack.getUserOperationReceipt(userOperationHash),
        new Promise<never>((_, reject) => {
          requestTimer = window.setTimeout(() => reject(new Error('Receipt lookup timed out')), 18_000)
        }),
      ])
      if (receipt) {
        const transactionHash = isRecord(receipt.receipt) ? receipt.receipt.transactionHash : null
        if (typeof receipt.userOpHash === 'string'
          && userOperationHashPattern.test(receipt.userOpHash)
          && receipt.userOpHash.toLowerCase() === userOperationHash.toLowerCase()
          && typeof receipt.sender === 'string'
          && /^0x[0-9a-f]{40}$/i.test(receipt.sender)
          && receipt.sender.toLowerCase() === PILOT_SAFE.toLowerCase()
          && typeof transactionHash === 'string'
          && userOperationHashPattern.test(transactionHash)) {
          onStatus('Bundler receipt found. PriorSeal finality observation is starting…')
          return { transactionHash: transactionHash.toLowerCase(), source: 'bundler' as const, providerUnavailable: false }
        }
        bundlerLookupFailed = true
      }
    } catch {
      bundlerLookupFailed = true
    } finally {
      if (requestTimer !== undefined) window.clearTimeout(requestTimer)
    }
    if (attempt % 3 === 0) {
      try {
        const transactionHash = await findUserOperationEventTransactionHash(userOperationHash)
        chainLookupFailed = false
        if (transactionHash) {
          onStatus('Matching EntryPoint event found on Base Sepolia. PriorSeal finality observation is starting…')
          return { transactionHash, source: 'entrypoint-event' as const, providerUnavailable: false }
        }
      } catch {
        chainLookupFailed = true
      }
    }
    lastLookupFailed = bundlerLookupFailed || chainLookupFailed
    onStatus(lastLookupFailed
      ? 'A receipt or chain-event provider is temporarily unavailable. Retrying read-only lookups for the saved hash…'
      : 'No bundler receipt or matching EntryPoint event was found in recent blocks. Continuing read-only checks…')
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const delay = Math.min(2_000 * 2 ** Math.min(attempt, 2), 8_000, remaining)
    attempt += 1
    await new Promise((resolve) => window.setTimeout(resolve, delay))
  }
  onStatus(lastLookupFailed
    ? 'A bundler or chain RPC lookup is still unavailable. The recovery checkpoint is retained; retry these read-only lookups later.'
    : 'No receipt or matching EntryPoint event was found in the last 10,000 blocks. The operation may still be pending or dropped; the checkpoint is retained.')
  return { transactionHash: null, providerUnavailable: lastLookupFailed }
}

export function Safe4337PilotPage() {
  const packRef = useRef<Safe4337Pack | null>(null)
  const operationRef = useRef<SafeOperation | null>(null)
  const signedOperationRef = useRef<SafeOperation | null>(null)
  const intentRef = useRef<Intent | null>(null)
  const authorizationRef = useRef<AuthorizationRecord | null>(null)
  const completedRunRef = useRef<PilotRecoveryRecord | null>(null)
  const [recoveryState, setRecoveryState] = useState(() => readPilotRecoveryRecord())
  const [phase, setPhase] = useState<PilotPhase>(() => recoveryState.record ? 'submitted' : 'idle')
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [account, setAccount] = useState('')
  const [gas, setGas] = useState<GasSummary | null>(null)
  const [userOperationHash, setUserOperationHash] = useState(recoveryState.record?.userOperationHash ?? '')
  const [authorizationId, setAuthorizationId] = useState(recoveryState.record?.authorizationId ?? '')
  const [outerTransactionHash, setOuterTransactionHash] = useState<string>(recoveryState.record?.transactionHash ?? '')
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lookupStatus, setLookupStatus] = useState(() => recoveryState.record?.stage === 'SUBMITTING'
    ? 'Submission status is uncertain. Use receipt lookup only; do not submit this operation again.'
    : recoveryState.record?.transactionHash ? 'The transaction hash is saved. Resume PriorSeal observation without relying on the bundler.'
      : recoveryState.record ? 'A saved operation is ready for read-only receipt lookup.' : '')

  useEffect(() => { getCapabilities().then(setCapabilities).catch((caught) => setError(cleanError(caught))) }, [])

  function saveRecovery(record: PilotRecoveryRecord) {
    savePilotRecoveryRecord(record)
    setRecoveryState({ record, error: null })
    setUserOperationHash(record.userOperationHash)
    setAuthorizationId(record.authorizationId)
    setOuterTransactionHash(record.transactionHash ?? '')
  }

  function clearRecovery() {
    try { clearPilotRecoveryRecord() } catch { /* The final evidence remains available in this page session. */ }
    setRecoveryState({ record: null, error: null })
  }

  function wallet() {
    const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum
    if (!provider) throw new Error('Open this local pilot in Chrome with MetaMask enabled.')
    return provider
  }

  async function connectAndEstimate() {
    if (recoveryState.error) { setError('The saved recovery record is invalid. Reconcile the existing UserOperation before starting another pilot operation.'); return }
    setBusy(true); setError(''); setObservation(null); setOuterTransactionHash(''); setAuthorizationId(''); setUserOperationHash('')
    try {
      const provider = wallet()
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
      const walletAccount = accounts[0]?.toLowerCase()
      if (!walletAccount || walletAccount !== PILOT_OWNER.toLowerCase()) throw new Error('Connect the MetaMask owner account shown in this pilot.')
      const chain = await provider.request({ method: 'eth_chainId' })
      if (typeof chain !== 'string' || Number(BigInt(chain)) !== PILOT_CHAIN_ID) throw new Error('Switch MetaMask to Base Sepolia (chain ID 84532), then retry.')
      const safeBalanceHex = await provider.request({ method: 'eth_getBalance', params: [PILOT_SAFE, 'latest'] })
      if (typeof safeBalanceHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(safeBalanceHex)) throw new Error('MetaMask did not return a valid Safe balance.')
      const pack = await Safe4337Pack.init({
        provider: provider as never,
        signer: PILOT_OWNER,
        bundlerUrl: BUNDLER_URL,
        safeModulesVersion: '0.3.0',
        customContracts: { entryPointAddress: PILOT_ENTRY_POINT, safe4337ModuleAddress: PILOT_MODULE },
        options: { safeAddress: PILOT_SAFE },
      })
      if (Number(await pack.getChainId()) !== PILOT_CHAIN_ID) throw new Error('The configured bundler is not connected to Base Sepolia.')
      const supported = await pack.getSupportedEntryPoints()
      if (!supported.some((address) => address.toLowerCase() === PILOT_ENTRY_POINT.toLowerCase())) throw new Error('The configured bundler does not support the pinned EntryPoint v0.7.')
      const operation = await pack.createTransaction({
        transactions: [{ to: PILOT_OWNER, value: '0', data: '0x', operation: 0 }],
        options: { feeEstimator: new GenericFeeEstimator(RPC_URL) },
      })
      const summary = asGasSummary(operation, BigInt(safeBalanceHex))
      if (summary.maxCost >= summary.balance) throw new Error('The estimated maximum gas cost is not below the Safe balance.')
      packRef.current = pack
      operationRef.current = operation
      signedOperationRef.current = null
      intentRef.current = null
      authorizationRef.current = null
      setAccount(walletAccount)
      setGas(summary)
      setPhase('estimated')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function signSafeOperation() {
    const pack = packRef.current
    const operation = operationRef.current
    if (!pack || !operation || !gas || !account) { setError('Connect and estimate the operation first.'); return }
    if (!window.confirm(`Review Safe operation on Base Sepolia:\n\nSafe: ${PILOT_SAFE}\nTarget: ${PILOT_OWNER}\nValue: 0 ETH\nCalldata: empty\nMode: CALL\nEstimated maximum gas fee: ${formatEth(gas.maxCost)}\nSafe balance: ${formatEth(gas.balance)}\n\nThe next MetaMask prompt signs this exact Safe operation. It does not submit it.`)) return
    setBusy(true); setError('')
    try {
      const signed = await pack.signSafeOperation(operation)
      const validUntil = Math.floor(Date.now() / 1000) + 3600
      const nextIntent = buildERC4337UserOperationIntent({
        chainId: PILOT_CHAIN_ID,
        entryPoint: PILOT_ENTRY_POINT,
        entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
        entryPointVersion: '0.7',
        accountCallProfile: 'safe-4337.v1',
        userOperation: normalizeUserOperation(signed),
        intentId: `safe4337-pilot-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
        validUntil,
        constraints: {
          minConfirmations: capabilities?.minConfirmations ?? 0,
          ...(capabilities?.maxToleratedReorgDepth == null ? {} : { maxToleratedReorgDepth: capabilities.maxToleratedReorgDepth }),
          ...(capabilities?.finalityRequirement === 'RPC_FINALIZED' ? { finalityRequirement: 'RPC_FINALIZED' as const } : {}),
        },
      })
      signedOperationRef.current = signed
      intentRef.current = nextIntent
      setUserOperationHash(nextIntent.userOperationHash ?? '')
      setPhase('safe-signed')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function authorizeWithPriorSeal() {
    setBusy(true); setError('')
    const reviewDeclined = new Error('Canonical PriorSeal authorization review declined')
    try {
      const provider = wallet()
      const intent = intentRef.current
      if (!intent || !capabilities) throw new Error('Sign the Safe operation and load PriorSeal capabilities first.')
      if (!capabilities.workflowReady || !capabilities.chains.includes(PILOT_CHAIN_ID) || !capabilities.executionProfiles.includes('priorseal.execution-profile.erc4337-user-operation.v1') || !capabilities.authorizers.includes('eip712')) throw new Error('The local PriorSeal API is not configured for Base Sepolia ERC-4337 EIP-712 authorization.')
      const now = Math.floor(Date.now() / 1000)
      const { accepted } = await api.authorizeWithWallet({
        intent,
        principal: { type: 'user', id: `wallet:${account.slice(2)}` },
        delegate: { agentId: `agent:${PILOT_SAFE.slice(2)}`, executor: PILOT_SAFE },
        account,
        issuedAt: now,
        notBefore: now,
        expiresAt: intent.validUntil,
        authorizationNonce: generateAuthorizationNonce(),
        maxUses: '1',
        audience: capabilities.audience,
      }, provider, {
        onCheckpoint(checkpoint) {
          if (checkpoint.stage === 'PREPARED' && !window.confirm(`Review the canonical PriorSeal authorization before the wallet opens:\n\n${JSON.stringify({ ...checkpoint.prepared.authorization.intent, intentHash: checkpoint.prepared.authorization.intentHash }, null, 2)}`)) throw reviewDeclined
        },
      })
      const record: AuthorizationRecord = { authorization: accepted.authorization, acceptance: accepted.acceptance, policyEvidence: accepted.policyEvidence, timestampEvidence: accepted.timestampEvidence, witnessEvidence: accepted.witnessEvidence, status: 'ACCEPTED', boundTxHash: null, uses: 0 }
      authorizationRef.current = record
      setAuthorizationId(accepted.authorization.authorizationId)
      session.saveIntent(accepted.authorization.intent)
      session.saveAuthorization(record)
      const signedOperation = signedOperationRef.current
      if (!signedOperation) throw new Error('The signed Safe operation is unavailable for recovery.')
      const recovery = createPilotRecoveryRecord({ userOperation: normalizeUserOperation(signedOperation), authorizationId: accepted.authorization.authorizationId })
      setPhase('authorized')
      saveRecovery(recovery)
    } catch (caught) { if (caught !== reviewDeclined) setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function submitAndObserve() {
    const pack = packRef.current
    const operation = signedOperationRef.current
    const authorization = authorizationRef.current
    const recovery = recoveryState.record
    if (!pack || !operation || !authorization || !recovery || !gas || !userOperationHash) { setError('Sign and authorize the operation first; its recovery record must be present before submission.'); return }
    if (!window.confirm(`Submit this signed UserOperation to the Base Sepolia bundler now?\n\nSafe: ${PILOT_SAFE}\nTarget: ${PILOT_OWNER}\nValue: 0 ETH\nEstimated maximum gas fee: ${formatEth(gas.maxCost)}\nAvailable Safe balance: ${formatEth(gas.balance)}\nUserOperation hash: ${userOperationHash}\n\nThis broadcasts the operation and consumes test ETH for gas.`)) return
    setBusy(true); setError('')
    try {
      saveRecovery({ ...recovery, stage: 'SUBMITTING' })
      const submittedHash = await pack.executeTransaction({ executable: operation })
      if (submittedHash.toLowerCase() !== userOperationHash.toLowerCase()) throw new Error('Bundler returned a different UserOperation hash; stop and investigate before retrying.')
      saveRecovery({ ...recovery, stage: 'SUBMITTED' })
      setPhase('submitted')
      const lookup = await waitForUserOperationInclusion(pack, submittedHash, setLookupStatus)
      if (!lookup.transactionHash) throw new Error(lookup.providerUnavailable
        ? `Receipt and chain-event lookup is currently unavailable for ${submittedHash}. The recovery checkpoint is retained; retry later and do not submit again.`
        : `No receipt or matching EntryPoint event is available yet for ${submittedHash}. The recovery checkpoint is retained; retry later and do not submit again.`)
      await finishObservation(authorization.authorization.authorizationId, recovery, lookup.transactionHash)
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function finishObservation(authorizationId: string, recovery: PilotRecoveryRecord, transactionHash: string) {
    if (typeof transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) throw new Error('Bundler returned an invalid outer transaction hash; the recovery checkpoint is retained.')
    const normalizedTransactionHash = transactionHash.toLowerCase() as `0x${string}`
    const submitted = { ...recovery, stage: 'SUBMITTED' as const, transactionHash: normalizedTransactionHash }
    saveRecovery(submitted)
    setLookupStatus('The transaction hash is saved. PriorSeal is checking transaction finality and preparing the observation…')
    const result = await api.observeExecutionUntilFinal({ authorizationId, chainId: PILOT_CHAIN_ID, txHash: normalizedTransactionHash, confirmations: capabilities?.minConfirmations ?? 0 }, { timeoutMs: 120_000 })
    session.saveObservation(result.observation)
    if (result.receipt) session.saveReceipt(result.receipt)
    if (result.observationJob) session.saveObservationJob(result.observationJob)
    completedRunRef.current = submitted
    setObservation(result)
    setOuterTransactionHash(normalizedTransactionHash)
    setPhase('complete')
    setLookupStatus('PriorSeal observation completed. Download the evidence bundle to preserve the run and clear this tab’s recovery checkpoint.')
  }

  async function resumeObservation() {
    const recovery = recoveryState.record
    if (!recovery) { setError('There is no valid ERC-4337 recovery checkpoint in this tab.'); return }
    setBusy(true); setError('')
    try {
      if (recovery.transactionHash) {
        await finishObservation(recovery.authorizationId, recovery, recovery.transactionHash)
        return
      }
      const provider = wallet()
      const chain = await provider.request({ method: 'eth_chainId' })
      if (typeof chain !== 'string' || Number(BigInt(chain)) !== PILOT_CHAIN_ID) throw new Error('Switch MetaMask to Base Sepolia (chain ID 84532), then retry recovery.')
      const pack = packRef.current ?? await Safe4337Pack.init({
        provider: provider as never,
        signer: PILOT_OWNER,
        bundlerUrl: BUNDLER_URL,
        safeModulesVersion: '0.3.0',
        customContracts: { entryPointAddress: PILOT_ENTRY_POINT, safe4337ModuleAddress: PILOT_MODULE },
        options: { safeAddress: PILOT_SAFE },
      })
      packRef.current = pack
      const lookup = await waitForUserOperationInclusion(pack, recovery.userOperationHash, setLookupStatus)
      if (!lookup.transactionHash) throw new Error(lookup.providerUnavailable
        ? `Receipt and chain-event lookup is currently unavailable for ${recovery.userOperationHash}. The recovery checkpoint is retained; retry later and do not resubmit.`
        : `No receipt or matching EntryPoint event is available yet for ${recovery.userOperationHash}. The recovery checkpoint is retained; retry later and do not resubmit.`)
      await finishObservation(recovery.authorizationId, recovery, lookup.transactionHash)
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function downloadEvidence() {
    const recovery = completedRunRef.current ?? recoveryState.record
    if (!recovery || !observation) { setError('Complete the PriorSeal observation before exporting the evidence bundle.'); return }
    setBusy(true); setError('')
    try {
      const cached = authorizationRef.current ?? session.getActivity().authorizations.find((item) => item.authorization.authorizationId === recovery.authorizationId) ?? null
      const accepted = cached ?? await api.getAuthorization(recovery.authorizationId)
      downloadJson({
        schema: 'priorseal.erc4337-pilot-evidence.v1',
        exportedAt: new Date().toISOString(),
        chain: { id: PILOT_CHAIN_ID, name: 'Base Sepolia' },
        entryPoint: { address: recovery.entryPoint, version: recovery.entryPointVersion, runtimeCodeHash: recovery.entryPointCodeHash },
        userOperation: { hash: recovery.userOperationHash, operation: recovery.userOperation },
        authorization: accepted.authorization,
        acceptance: accepted.acceptance,
        observation: observation.observation,
        receipt: observation.receipt,
        observationJob: observation.observationJob ?? null,
      }, `priorseal-safe-erc4337-${recovery.userOperationHash.slice(2, 14)}.json`)
      clearRecovery()
      completedRunRef.current = null
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  const canUse = Boolean(capabilities?.workflowReady && capabilities.chains.includes(PILOT_CHAIN_ID) && capabilities.executionProfiles.includes('priorseal.execution-profile.erc4337-user-operation.v1') && capabilities.authorizers.includes('eip712'))
  return <>
    <PageHeader eyebrow="LOCAL TESTNET ONLY" title="Safe ERC-4337 pilot">Prepare one zero-value CALL, bind it to a PriorSeal authorization, then submit only after reviewing the exact operation and estimated fee.</PageHeader>
    <div className="operation-sequence" aria-label="Safe ERC-4337 pilot workflow"><div><span>01 / ESTIMATE</span><strong>Review call and fee</strong></div><div><span>02 / AUTHORIZE</span><strong>Sign Safe and PriorSeal data</strong></div><div><span>03 / EXECUTE</span><strong>Submit and observe</strong></div></div>
    {error && <Notice tone="danger" title="Pilot paused">{error}</Notice>}
    {recoveryState.error && <Notice tone="danger" title="Saved recovery data could not be verified">{recoveryState.error} The pilot is paused until the existing UserOperation is reconciled; do not start another operation from this tab.</Notice>}
    {recoveryState.record && <Notice tone="warning" title={recoveryState.record.stage === 'SUBMITTING' ? 'Submission status needs verification' : 'Recoverable operation saved in this tab'}>{recoveryState.record.stage === 'SUBMITTING' ? 'The page saved this signed operation before the bundler confirmed its response. It may have reached the bundler. The button below only looks up the existing UserOperation hash; do not submit it again.' : 'The signed UserOperation and authorization ID are held in this tab’s session storage so receipt lookup can resume after a page reload. The session contains no private key. Export the evidence bundle after final observation to clear this recovery data.'}</Notice>}
    {!capabilities && <Notice tone="warning" title="Checking the local PriorSeal API">The Safe operation can be estimated after the local API reports its supported chains and execution profiles.</Notice>}
    {capabilities && !canUse && <Notice tone="danger" title="PriorSeal ERC-4337 is not ready">The local API does not report a ready Base Sepolia ERC-4337 EIP-712 workflow. Start the configured local PriorSeal API and reload.</Notice>}
    <section className="panel intent-form" aria-busy={busy}>
      <div className="form-section-heading"><span>TEST OPERATION</span><strong>One zero-value Safe CALL</strong></div>
      <dl className="data-grid">
        <div><dt>Network</dt><dd>Base Sepolia · 84532</dd></div>
        <div><dt>Safe</dt><dd><CodeValue value={PILOT_SAFE} /></dd></div>
        <div><dt>Owner wallet</dt><dd><CodeValue value={PILOT_OWNER} /></dd></div>
        <div><dt>Target</dt><dd><CodeValue value={PILOT_OWNER} /></dd></div>
        <div><dt>Value</dt><dd>0 ETH</dd></div>
        <div><dt>Calldata</dt><dd>empty</dd></div>
        <div><dt>EntryPoint</dt><dd>v0.7</dd></div>
        <div><dt>Current stage</dt><dd><Status value={phase === 'idle' ? 'NOT_STARTED' : phase === 'submitted' && recoveryState.record?.stage === 'SUBMITTING' ? 'SUBMISSION_UNCERTAIN' : phase === 'submitted' && recoveryState.record?.transactionHash ? 'RECEIPT_FOUND' : phase.toUpperCase().replace('-', '_')} small /></dd></div>
      </dl>
      <Notice tone="warning" title="Testnet gas is still spent">The call sends no ETH or USDC to the target. If submitted, the Safe pays the bundler fee in test ETH.</Notice>
      {gas && <><div className="form-section-heading"><span>GAS REVIEW</span><strong>Bundler estimate</strong></div><dl className="data-grid">
        <div><dt>Safe nonce</dt><dd>{gas.nonce}</dd></div>
        <div><dt>Call gas limit</dt><dd>{gas.callGasLimit.toString()}</dd></div>
        <div><dt>Verification gas limit</dt><dd>{gas.verificationGasLimit.toString()}</dd></div>
        <div><dt>Pre-verification gas</dt><dd>{gas.preVerificationGas.toString()}</dd></div>
        <div><dt>Maximum gas price</dt><dd>{gas.maxFeePerGas.toString()} wei</dd></div>
        <div><dt>Conservative maximum fee</dt><dd>{formatEth(gas.maxCost)}</dd></div>
        <div><dt>Safe balance</dt><dd>{formatEth(gas.balance)}</dd></div>
      </dl></>}
      {userOperationHash && <div className="form-section-heading"><span>AUTHORIZATION</span><strong>Bound UserOperation</strong></div>}
      {userOperationHash && <p className="mono"><CodeValue value={userOperationHash} /></p>}
      {authorizationId && <p>PriorSeal authorization: <CodeValue value={authorizationId} /></p>}
      {outerTransactionHash && <p>Outer transaction hash: <CodeValue value={outerTransactionHash} /></p>}
      {phase === 'idle' && <button className="button primary" type="button" disabled={busy || !canUse || Boolean(recoveryState.error)} onClick={() => void connectAndEstimate()}>{busy ? 'Checking wallet and estimating…' : 'Connect owner wallet and estimate'}</button>}
      {phase === 'estimated' && <button className="button primary" type="button" disabled={busy} onClick={() => void signSafeOperation()}>{busy ? 'Waiting for Safe signature…' : 'Review and sign Safe operation'}</button>}
      {phase === 'safe-signed' && <button className="button primary" type="button" disabled={busy} onClick={() => void authorizeWithPriorSeal()}>{busy ? 'Preparing PriorSeal authorization…' : 'Review and authorize with PriorSeal'}</button>}
      {phase === 'authorized' && recoveryState.record && <button className="button primary" type="button" disabled={busy} onClick={() => void submitAndObserve()}>{busy ? 'Submitting and observing…' : 'Review and submit UserOperation'}</button>}
      {phase === 'authorized' && !recoveryState.record && <Notice tone="danger" title="Recovery could not be saved">The PriorSeal authorization was accepted, but this browser could not save its recovery checkpoint. Do not repeat authorization or submit from this pilot. Use the Observe execution page with the authorization ID shown above.</Notice>}
      {phase === 'submitted' && <><p role="status">{lookupStatus || 'Recovery checks bundler receipt and recent EntryPoint events for the saved hash. It never resubmits the UserOperation.'}</p><button className="button primary" type="button" disabled={busy || !recoveryState.record} onClick={() => void resumeObservation()}>{busy ? 'Checking inclusion by hash…' : 'Resume receipt and chain-event lookup'}</button></>}
      {phase === 'complete' && observation && <><Notice tone={observation.observation.status === 'CONFIRMED' ? 'success' : 'warning'} title="PriorSeal observation received">The UserOperation was observed with status {observation.observation.status}; receipt {observation.receipt?.receiptId ?? 'is not yet available'}.</Notice><button className="button primary" type="button" disabled={busy} onClick={() => void downloadEvidence()}>{busy ? 'Preparing evidence…' : 'Download pilot evidence bundle'}</button></>}
    </section>
  </>
}
