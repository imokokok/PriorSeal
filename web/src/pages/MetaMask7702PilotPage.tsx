import { useEffect, useRef, useState } from 'react'
import { baseSepolia } from 'viem/chains'
import { createBundlerClient } from 'viem/account-abstraction'
import { createPublicClient, createWalletClient, custom, formatEther, http, keccak256, parseAbi, zeroAddress } from 'viem'
import { buildERC4337UserOperationIntent, generateAuthorizationNonce } from 'priorseal-sdk'
import { CodeValue, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, type Capabilities } from '../lib/api'
import { downloadJson } from '../lib/download'
import { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH } from '../lib/erc4337-profile'
import { session } from '../lib/storage'
import { createMetaMask7702PilotAccount, encodeMetaMask7702PilotCall } from '../lib/metamask-7702-account'
import {
  assessEip7702Observation,
  clearEip7702RecoveryRecord,
  clearEip7702SetupId,
  createEip7702RecoveryRecord,
  eip7702FinalityConstraints,
  isEip7702SubmissionEligible,
  PILOT_7702_DELEGATE,
  PILOT_7702_DELEGATE_CODE_HASH,
  PILOT_7702_USER_OPERATION_EVENT_TOPIC,
  readEip7702RecoveryRecord,
  readEip7702SetupId,
  reconcileEip7702Lookups,
  saveEip7702RecoveryRecord,
  saveEip7702SetupId,
  withEip7702LookupTimeout,
  type Eip7702RecoveryRecord,
} from '../lib/eip7702-pilot'
import type { AuthorizationRecord, Eip1193Provider, Intent, ObservationResult } from '../types'

const RPC_URL = new URL('/__priorseal_rpc', window.location.origin).toString()
const BUNDLER_URL = new URL('/__priorseal_bundler', window.location.origin).toString()
const delegateAbi = parseAbi(['function entryPoint() view returns (address)'])
const entryPointAbi = parseAbi(['function getNonce(address sender,uint192 key) view returns (uint256)', 'function balanceOf(address account) view returns (uint256)'])
const hashPattern = /^0x[0-9a-f]{64}$/i
const addressPattern = /^0x[0-9a-f]{40}$/i
const baseSepoliaHex = `0x${PILOT_CHAIN_ID.toString(16)}`

type GasReview = { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint; maxFeePerGas: bigint; maxCost: bigint; balance: bigint; nonce: bigint }
type Phase = 'idle' | 'setup' | 'estimated' | 'signed' | 'authorized' | 'submitted' | 'complete'

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function cleanError(error: unknown) {
  const value = typeof error === 'string' ? error : error instanceof Error ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}` : 'The operation could not be completed.'
  if (/External signature requests cannot use internal accounts as the verifying contract/i.test(value)) {
    return 'MetaMask rejected this EIP-712 request before opening a signature prompt. The delegated account requires its own EOA address as the verifying contract, but MetaMask blocks dapps from requesting signatures with an internal account in that field. No signature was created and the UserOperation was not submitted. Do not change the verifying contract or export the account key; this injected-wallet path cannot complete the signing step. Continue only with a signing flow that supports this exact account and typed-data domain.'
  }
  return value.replace(/https?:\/\/\S+/g, '[provider URL hidden]').replace(/\bak_[A-Za-z0-9]+\b/g, '[API key hidden]').slice(0, 300)
}
function wallet() {
  const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!provider) throw new Error('Open this local pilot in a browser with MetaMask enabled.')
  return provider
}
function asQuantity(value: unknown, label: string) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError(`${label} is invalid`)
  const result = BigInt(value)
  if (result < 0n) throw new TypeError(`${label} is invalid`)
  return result
}
function normalizeOperation(value: Record<string, unknown>) {
  const output: Record<string, unknown> = {}
  for (const field of ['sender', 'callData', 'signature', 'factory', 'factoryData', 'paymaster', 'paymasterData'] as const) {
    const item = value[field]
    if (item !== undefined && item !== null && !(field === 'factory' || field === 'paymaster' ? item === zeroAddress : false)) output[field] = item
  }
  for (const field of ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) {
    if (value[field] !== undefined && value[field] !== null) output[field] = asQuantity(value[field], field).toString(10)
  }
  return output
}
function toBundlerOperation(operation: Record<string, unknown>) {
  const output = { ...operation }
  for (const field of ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) {
    if (typeof operation[field] === 'string' && /^(0|[1-9][0-9]*)$/.test(operation[field] as string)) output[field] = `0x${BigInt(operation[field] as string).toString(16)}`
  }
  return output
}
function summarize(operation: Record<string, unknown>, balance: bigint): GasReview {
  const callGasLimit = asQuantity(operation.callGasLimit, 'callGasLimit')
  const verificationGasLimit = asQuantity(operation.verificationGasLimit, 'verificationGasLimit')
  const preVerificationGas = asQuantity(operation.preVerificationGas, 'preVerificationGas')
  const maxFeePerGas = asQuantity(operation.maxFeePerGas, 'maxFeePerGas')
  return { callGasLimit, verificationGasLimit, preVerificationGas, maxFeePerGas, maxCost: (callGasLimit + verificationGasLimit + preVerificationGas) * maxFeePerGas, balance, nonce: asQuantity(operation.nonce, 'nonce') }
}
async function rpc(url: string, method: string, params: unknown[]) {
  const id = crypto.randomUUID()
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(18_000) })
  const body: unknown = await response.json()
  if (!response.ok || !isRecord(body) || body.jsonrpc !== '2.0' || body.id !== id || ('error' in body) === ('result' in body)) throw new Error(`${method} lookup failed`)
  if ('error' in body) throw new Error(`${method} lookup failed`)
  return body.result
}

export function MetaMask7702PilotPage() {
  const recovered = useRef(readEip7702RecoveryRecord())
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [phase, setPhase] = useState<Phase>(() => recovered.current.record ? recovered.current.record.transactionHash || recovered.current.record.stage !== 'AUTHORIZED' ? 'submitted' : 'authorized' : 'idle')
  const [setup, setSetup] = useState(() => readEip7702SetupId())
  const [accountAddress, setAccountAddress] = useState(recovered.current.record?.sender ?? '')
  const [gas, setGas] = useState<GasReview | null>(null)
  const [operation, setOperation] = useState<Record<string, unknown> | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationRecord | null>(null)
  const [authorizationId, setAuthorizationId] = useState(recovered.current.record?.authorizationId ?? '')
  const [transactionHash, setTransactionHash] = useState(recovered.current.record?.transactionHash ?? '')
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [lookupStatus, setLookupStatus] = useState('')
  const [error, setError] = useState(recovered.current.error ?? setup.error ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { getCapabilities().then(setCapabilities).catch((caught) => setError(cleanError(caught))) }, [])

  const publicClient = () => createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
  const bundlerClient = () => createBundlerClient({ chain: baseSepolia, transport: http(BUNDLER_URL) })
  const canUse = Boolean(capabilities?.workflowReady && capabilities.chains.includes(PILOT_CHAIN_ID) && capabilities.executionProfiles.includes('priorseal.execution-profile.erc4337-user-operation.v1') && capabilities.authorizers.includes('eip712'))
  const recovery = recovered.current.record

  function save(record: Eip7702RecoveryRecord) {
    saveEip7702RecoveryRecord(record)
    recovered.current = { record, error: null }
    setAuthorizationId(record.authorizationId)
    setTransactionHash(record.transactionHash ?? '')
  }

  function discardEstimate() {
    setGas(null); setOperation(null); setIntent(null); setAuthorization(null); setPhase('idle'); setLookupStatus('')
  }

  async function walletContext(requestAccounts = true) {
    const provider = wallet()
    const accounts = await provider.request({ method: requestAccounts ? 'eth_requestAccounts' : 'eth_accounts' })
    const address = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : ''
    if (!addressPattern.test(address)) throw new Error('MetaMask did not return a valid EOA address.')
    const chainId = await provider.request({ method: 'eth_chainId' })
    if (typeof chainId !== 'string' || Number(BigInt(chainId)) !== PILOT_CHAIN_ID) throw new Error('Switch MetaMask to Base Sepolia (chain ID 84532).')
    setAccountAddress(address.toLowerCase())
    return { provider, address: address as `0x${string}` }
  }

  async function inspectDelegation(address: `0x${string}`) {
    const client = publicClient()
    const [runtime, entryPointCode] = await Promise.all([client.getCode({ address }), client.getCode({ address: PILOT_ENTRY_POINT })])
    if (!runtime?.toLowerCase().startsWith(`0xef0100${PILOT_7702_DELEGATE.slice(2).toLowerCase()}`)) return { delegated: false, client }
    const delegateCode = await client.getCode({ address: PILOT_7702_DELEGATE })
    if (!delegateCode || keccak256(delegateCode).toLowerCase() !== PILOT_7702_DELEGATE_CODE_HASH.toLowerCase()) throw new Error('Base Sepolia MetaMask delegate runtime code does not match the pinned code hash.')
    if (!entryPointCode || keccak256(entryPointCode).toLowerCase() !== PILOT_ENTRY_POINT_CODE_HASH.toLowerCase()) throw new Error('Base Sepolia EntryPoint v0.7 runtime code does not match the pinned code hash.')
    const configuredEntryPoint = await client.readContract({ address: PILOT_7702_DELEGATE, abi: delegateAbi, functionName: 'entryPoint' })
    if (configuredEntryPoint.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()) throw new Error('The MetaMask delegate reports a different EntryPoint address.')
    return { delegated: true, client }
  }

  async function checkSetupStatus() {
    if (!setup.id) { setError('There is no saved MetaMask wallet batch ID to check.'); return }
    setBusy(true); setError('')
    try {
      const { provider, address } = await walletContext(false)
      const result = await provider.request({ method: 'wallet_getCallsStatus', params: [setup.id] })
      if (!isRecord(result) || !Number.isSafeInteger(result.status)) throw new Error('MetaMask returned an invalid EIP-5792 wallet batch status.')
      const status = Number(result.status)
      if (status === 200) { setLookupStatus('MetaMask setup is still pending. Check status again after the wallet completes it.'); return }
      if (status !== 100) throw new Error(`MetaMask setup batch finished with status ${status}; verify the wallet before retrying.`)
      const checked = await inspectDelegation(address)
      if (!checked.delegated) throw new Error('MetaMask reported setup completion, but the account still has no pinned EIP-7702 delegation. Do not proceed.')
      clearEip7702SetupId(); setSetup({ id: null, error: null }); setPhase('idle')
      setLookupStatus('MetaMask reports the setup batch confirmed, and Base Sepolia independently confirms the expected delegation and EntryPoint.')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function prepareDelegation() {
    setBusy(true); setError(''); setLookupStatus('')
    try {
      const { provider, address } = await walletContext()
      const status = await inspectDelegation(address)
      if (status.delegated) { setLookupStatus('This EOA already has the pinned MetaMask EIP-7702 delegation. Continue to estimate the UserOperation.'); setPhase('idle'); return }
      const caps = await provider.request({ method: 'wallet_getCapabilities', params: [address] })
      const chainCaps = isRecord(caps) && isRecord(caps[baseSepoliaHex]) ? caps[baseSepoliaHex] : null
      const atomic = chainCaps && isRecord(chainCaps.atomic) ? chainCaps.atomic.status : null
      if (atomic !== 'supported' && atomic !== 'ready') throw new Error('This MetaMask account does not advertise atomic wallet_sendCalls on Base Sepolia. Update MetaMask or use an already delegated EOA.')
      if (!window.confirm(`MetaMask will prepare a separate EIP-7702 wallet-upgrade batch on Base Sepolia for this EOA.\n\nAccount: ${address}\nExpected delegate: ${PILOT_7702_DELEGATE}\n\nThe setup is separate from PriorSeal authorization and contains two zero-value empty calls. The next operation will be reviewed and signed separately. Continue to MetaMask?`)) return
      const batch = await provider.request({ method: 'wallet_sendCalls', params: [{ version: '2.0.0', from: address, chainId: baseSepoliaHex, atomicRequired: true, calls: [{ to: zeroAddress, value: '0x0', data: '0x' }, { to: zeroAddress, value: '0x0', data: '0x' }] }] })
      if (!isRecord(batch) || typeof batch.id !== 'string') throw new Error('MetaMask did not return an EIP-5792 setup batch ID.')
      saveEip7702SetupId(batch.id); setSetup({ id: batch.id.toLowerCase(), error: null }); setPhase('setup')
      setLookupStatus('MetaMask accepted the setup request. Complete any wallet prompt, then check the batch status; the UserOperation is a separate step.')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function estimateOperation() {
    setBusy(true); setError(''); setObservation(null); setTransactionHash('')
    try {
      if (!canUse) throw new Error('The local PriorSeal API is not ready for Base Sepolia ERC-4337 EIP-712 authorizations.')
      const { provider, address } = await walletContext()
      const inspected = await inspectDelegation(address)
      if (!inspected.delegated) { setPhase('idle'); throw new Error('This EOA is not yet delegated to the pinned MetaMask implementation. Complete the separate wallet setup first.') }
      const bundler = bundlerClient()
      if (Number(await bundler.getChainId()) !== PILOT_CHAIN_ID) throw new Error('The configured bundler is not connected to Base Sepolia.')
      if (!(await bundler.getSupportedEntryPoints()).some((value) => value.toLowerCase() === PILOT_ENTRY_POINT.toLowerCase())) throw new Error('The configured bundler does not support the pinned EntryPoint v0.7.')
      const walletClient = createWalletClient({ account: address, chain: baseSepolia, transport: custom(provider as never) })
      const account = await createMetaMask7702PilotAccount({ client: inspected.client as never, walletClient: walletClient as never, address })
      // Fee estimation through some bundlers is optional and may return undefined
      // fields while still returning gas limits. Pin fee values from the chain RPC
      // before asking the bundler to estimate this operation.
      const [gasPrice, maxPriorityFeePerGas] = await Promise.all([
        inspected.client.getGasPrice(),
        inspected.client.estimateMaxPriorityFeePerGas(),
      ])
      if (gasPrice <= 0n || maxPriorityFeePerGas < 0n) throw new Error('Base Sepolia returned invalid fee data.')
      const maxFeePerGas = 2n * gasPrice + maxPriorityFeePerGas
      const prepared = await bundler.prepareUserOperation({ account, calls: [{ to: zeroAddress, value: 0n, data: '0x' }], maxFeePerGas, maxPriorityFeePerGas })
      const candidate = prepared as unknown as Record<string, unknown>
      if (String(candidate.sender).toLowerCase() !== address.toLowerCase() || candidate.callData !== encodeMetaMask7702PilotCall() || candidate.factory != null || candidate.factoryData != null || candidate.paymaster != null || candidate.paymasterData != null) throw new Error('Bundler estimate changed the pilot sender, zero-value call, factory or paymaster fields.')
      const balance = await inspected.client.getBalance({ address })
      const deposit = await inspected.client.readContract({ address: PILOT_ENTRY_POINT, abi: entryPointAbi, functionName: 'balanceOf', args: [address] })
      const summary = summarize(candidate, balance + deposit)
      if (summary.maxCost >= summary.balance) throw new Error('The EOA balance plus EntryPoint deposit does not cover the conservative maximum gas fee.')
      setGas(summary); setOperation(candidate); setIntent(null); setAuthorization(null); setPhase('estimated')
      setLookupStatus('Bundler estimate is bound to one zero-value no-op call; no authorization or submission has happened.')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function signOperation() {
    if (!operation || !gas || !accountAddress) { setError('Estimate the delegated EOA operation first.'); return }
    if (!window.confirm(`Review the exact MetaMask 7702 UserOperation before requesting its signature:\n\nNetwork: Base Sepolia (84532)\nEOA: ${accountAddress}\nDelegate: ${PILOT_7702_DELEGATE}\nEntryPoint: ${PILOT_ENTRY_POINT} (v0.7)\nCall: zero-value empty call to ${zeroAddress}\nMaximum gas: ${formatEther(gas.maxCost)} ETH\nAvailable EOA balance + EntryPoint deposit: ${formatEther(gas.balance)} ETH\n\nSigning does not submit this operation.`)) return
    setBusy(true); setError('')
    try {
      const { provider, address } = await walletContext(false)
      if (address.toLowerCase() !== accountAddress.toLowerCase()) {
        discardEstimate()
        throw new Error('MetaMask account changed after estimation. The previous operation was discarded; estimate again for the connected EOA.')
      }
      if (typeof operation.sender !== 'string' || operation.sender.toLowerCase() !== address.toLowerCase()) {
        discardEstimate()
        throw new Error('The estimated UserOperation belongs to a different EOA. The previous operation was discarded; estimate again for the connected EOA.')
      }
      const client = publicClient()
      const walletClient = createWalletClient({ account: address, chain: baseSepolia, transport: custom(provider as never) })
      const account = await createMetaMask7702PilotAccount({ client: client as never, walletClient: walletClient as never, address })
      const signature = await account.signUserOperation({ ...operation, chainId: PILOT_CHAIN_ID } as never)
      const signed = { ...operation, signature }
      const normalized = normalizeOperation(signed)
      const nextIntent = buildERC4337UserOperationIntent({ chainId: PILOT_CHAIN_ID, entryPoint: PILOT_ENTRY_POINT, entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH, entryPointVersion: '0.7', eip7702: { delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH }, userOperation: normalized, intentId: `metamask-7702-pilot-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, validUntil: Math.floor(Date.now() / 1000) + 3600, constraints: eip7702FinalityConstraints(capabilities) })
      setOperation(signed); setIntent(nextIntent); setPhase('signed')
      setLookupStatus(`MetaMask signature recovered to ${address}. PriorSeal is not authorized yet.`)
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function authorizeOperation() {
    setBusy(true); setError('')
    const declined = new Error('PriorSeal authorization review declined')
    try {
      const { provider, address } = await walletContext(false)
      if (!intent || !capabilities || address.toLowerCase() !== accountAddress.toLowerCase()) throw new Error('The signed UserOperation, wallet account or PriorSeal capabilities are missing.')
      const now = Math.floor(Date.now() / 1000)
      const { accepted } = await api.authorizeWithWallet({ intent, principal: { type: 'user', id: `wallet:${address.slice(2).toLowerCase()}` }, delegate: { agentId: `agent:${address.slice(2).toLowerCase()}`, executor: address }, account: address, issuedAt: now, notBefore: now, expiresAt: intent.validUntil, authorizationNonce: generateAuthorizationNonce(), maxUses: '1', audience: capabilities.audience }, provider, {
        onCheckpoint(checkpoint) {
          if (checkpoint.stage === 'PREPARED' && !window.confirm(`Review the canonical PriorSeal authorization before MetaMask opens:\n\n${JSON.stringify({ ...checkpoint.prepared.authorization.intent, intentHash: checkpoint.prepared.authorization.intentHash }, null, 2)}`)) throw declined
        },
      })
      const record: AuthorizationRecord = { authorization: accepted.authorization, acceptance: accepted.acceptance, policyEvidence: accepted.policyEvidence, timestampEvidence: accepted.timestampEvidence, witnessEvidence: accepted.witnessEvidence, status: 'ACCEPTED', boundTxHash: null, uses: 0 }
      setAuthorization(record); session.saveIntent(accepted.authorization.intent); session.saveAuthorization(record)
      if (!operation) throw new Error('Signed UserOperation is unavailable after authorization.')
      save(createEip7702RecoveryRecord({ sender: accountAddress, userOperation: normalizeOperation(operation), authorizationId: accepted.authorization.authorizationId }))
      setPhase('authorized'); setLookupStatus('PriorSeal accepted the authorization for this exact operation hash. Review it again before submission.')
    } catch (caught) { if (caught !== declined) setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function findEvent(userOperationHash: string, sender: string) {
    const latestBlock = await rpc(RPC_URL, 'eth_getBlockByNumber', ['latest', false])
    if (!isRecord(latestBlock) || typeof latestBlock.number !== 'string' || !/^0x[0-9a-f]+$/i.test(latestBlock.number)) throw new Error('Base Sepolia RPC returned an invalid latest block.')
    const latest = BigInt(latestBlock.number)
    const from = latest > 9999n ? latest - 9999n : 0n
    const logs = await rpc(RPC_URL, 'eth_getLogs', [{ address: PILOT_ENTRY_POINT, fromBlock: `0x${from.toString(16)}`, toBlock: latestBlock.number, topics: [PILOT_7702_USER_OPERATION_EVENT_TOPIC, userOperationHash] }])
    if (!Array.isArray(logs) || logs.length > 1) throw new Error('EntryPoint event lookup returned an ambiguous result.')
    if (!logs.length) return null
    const log = logs[0]
    if (!isRecord(log) || typeof log.address !== 'string' || log.address.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase() || !Array.isArray(log.topics) || log.topics.length !== 4 || !log.topics.every((topic) => typeof topic === 'string') || (log.topics[0] as string).toLowerCase() !== PILOT_7702_USER_OPERATION_EVENT_TOPIC.toLowerCase() || (log.topics[1] as string).toLowerCase() !== userOperationHash.toLowerCase() || (log.topics[2] as string).toLowerCase() !== `0x${sender.slice(2).toLowerCase().padStart(64, '0')}` || typeof log.transactionHash !== 'string' || !hashPattern.test(log.transactionHash) || log.removed === true) throw new Error('EntryPoint event is malformed or belongs to a different operation/account.')
    return { userOperationHash, sender, transactionHash: log.transactionHash.toLowerCase() }
  }

  async function lookups(record: Eip7702RecoveryRecord) {
    const tasks = await Promise.allSettled([
      withEip7702LookupTimeout(rpc(BUNDLER_URL, 'eth_getUserOperationReceipt', [record.userOperationHash]), 'Bundler receipt lookup'),
      withEip7702LookupTimeout(rpc(BUNDLER_URL, 'eth_getUserOperationByHash', [record.userOperationHash]), 'Bundler operation lookup'),
      withEip7702LookupTimeout(findEvent(record.userOperationHash, record.sender), 'EntryPoint event lookup'),
    ])
    return reconcileEip7702Lookups({ expectedUserOperationHash: record.userOperationHash, expectedSender: record.sender, bundlerReceipt: tasks[0], bundlerOperation: tasks[1], entryPointEvent: tasks[2] })
  }

  async function pollForInclusion(record: Eip7702RecoveryRecord) {
    const deadline = Date.now() + 120_000
    let attempt = 0
    while (Date.now() < deadline) {
      const result = await lookups(record)
      if (result.kind === 'INCLUDED') return result
      if (result.kind === 'PENDING') setLookupStatus('The bundler knows the operation but has not included it yet. Continuing read-only checks…')
      else if (result.kind === 'INDETERMINATE') setLookupStatus('A receipt or chain RPC lookup is temporarily unavailable. Retrying read-only checks for this hash…')
      else setLookupStatus('No receipt or matching EntryPoint event is visible yet. Continuing read-only checks; no repeat submission will occur.')
      const delay = Math.min(2000 * 2 ** Math.min(attempt, 2), 8000, deadline - Date.now())
      attempt += 1
      if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
    }
    return null
  }

  async function finishObservation(record: Eip7702RecoveryRecord, txHash: string) {
    const normalized = txHash.toLowerCase() as `0x${string}`
    const submitted = { ...record, stage: 'SUBMITTED' as const, transactionHash: normalized }
    save(submitted); setLookupStatus('The outer transaction hash is saved. PriorSeal is checking finality and EIP-7702 execution evidence.')
    const result = await api.observeExecutionUntilFinal({ authorizationId: record.authorizationId, chainId: PILOT_CHAIN_ID, txHash: normalized, confirmations: eip7702FinalityConstraints(capabilities).minConfirmations }, { timeoutMs: 120_000 })
    const assessment = assessEip7702Observation(result, submitted, normalized)
    if (assessment.kind === 'REORGED') { const { transactionHash: _removed, ...withoutHash } = submitted; save(withoutHash); setPhase('submitted'); setObservation(null); setLookupStatus('The inclusion was reorganized. The hash was cleared; resume read-only reconciliation before any further action.'); return }
    if (assessment.kind === 'PENDING') { setPhase('submitted'); setObservation(null); setLookupStatus('PriorSeal still reports pending finality. The saved hash is retained; resume observation later.'); return }
    if (assessment.kind !== 'FINAL') throw new Error(`PriorSeal returned ${assessment.status} without final execution evidence; recovery is retained.`)
    session.saveObservation(result.observation); if (result.receipt) session.saveReceipt(result.receipt); if (result.observationJob) session.saveObservationJob(result.observationJob)
    setObservation(result); setTransactionHash(normalized); setPhase('complete')
    setLookupStatus(assessment.status === 'REVERTED' ? 'The operation is final but reverted or failed; preserve the failure evidence and do not retry it automatically.' : 'PriorSeal confirmed the UserOperation, delegate state and required finality. Export the evidence bundle to complete the run.')
  }

  async function resume() {
    const saved = recovered.current.record
    if (!saved) { setError('There is no verified recovery record in this tab.'); return }
    setBusy(true); setError('')
    try {
      const accepted = authorization ?? await api.getAuthorization(saved.authorizationId)
      if (accepted.acceptance.status !== 'ACCEPTED' || accepted.acceptance.authorizationId !== saved.authorizationId || accepted.authorization.intent.userOperationHash?.toLowerCase() !== saved.userOperationHash.toLowerCase()) throw new Error('Saved PriorSeal authorization does not accept this exact UserOperation.')
      if (saved.transactionHash) { await finishObservation(saved, saved.transactionHash); return }
      const found = await pollForInclusion(saved)
      if (found?.kind === 'INCLUDED') { await finishObservation(saved, found.transactionHash); return }
      if (found) return
      setLookupStatus('The inclusion is still unknown after bounded read-only checks. The checkpoint remains saved; refresh can only follow a clean negative reconciliation and unchanged nonce.')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function submit() {
    const saved = recovered.current.record
    if (!saved || !isEip7702SubmissionEligible(saved)) { setError('Only a saved, accepted, eligible UserOperation can be submitted.'); return }
    setBusy(true); setError('')
    try {
      const accepted = authorization ?? await api.getAuthorization(saved.authorizationId)
      if (accepted.acceptance.status !== 'ACCEPTED' || accepted.acceptance.authorizationId !== saved.authorizationId || accepted.authorization.intent.userOperationHash?.toLowerCase() !== saved.userOperationHash.toLowerCase() || Date.now() / 1000 >= accepted.authorization.intent.validUntil) throw new Error('PriorSeal authorization is not active for this exact UserOperation.')
      const { address } = await walletContext(false)
      if (address.toLowerCase() !== saved.sender.toLowerCase()) throw new Error('MetaMask account changed after authorization.')
      const checked = await inspectDelegation(address)
      if (!checked.delegated) throw new Error('The expected EIP-7702 delegation is no longer active.')
      const nonce = await checked.client.readContract({ address: PILOT_ENTRY_POINT, abi: entryPointAbi, functionName: 'getNonce', args: [address, 0n] })
      if (nonce !== asQuantity(saved.userOperation.nonce, 'nonce')) throw new Error('The EntryPoint nonce changed after authorization; prepare a new operation.')
      const [balance, deposit] = await Promise.all([
        checked.client.getBalance({ address }),
        checked.client.readContract({ address: PILOT_ENTRY_POINT, abi: entryPointAbi, functionName: 'balanceOf', args: [address] }),
      ])
      const currentGas = summarize(saved.userOperation, balance + deposit)
      if (currentGas.maxCost >= currentGas.balance) throw new Error('Current EOA balance plus EntryPoint deposit cannot cover the saved maximum gas fee.')
      setGas(currentGas)
      const found = await lookups(saved)
      if (found.kind === 'INCLUDED') { await finishObservation(saved, found.transactionHash); return }
      if (found.kind !== 'ABSENT') throw new Error(found.kind === 'PENDING' ? 'The bundler still knows this operation. Reconcile by hash; do not submit again.' : 'Read-only reconciliation was incomplete. Retry it later; do not submit while status is unknown.')
      const review = [`Submit the exact signed UserOperation to Base Sepolia?`, '', `EOA: ${saved.sender}`, `Delegate: ${PILOT_7702_DELEGATE}`, `EntryPoint: ${PILOT_ENTRY_POINT} v0.7`, `Call: zero-value empty call to ${zeroAddress}`, `Maximum fee: ${formatEther(currentGas.maxCost)} ETH`, `EOA balance + EntryPoint deposit: ${formatEther(currentGas.balance)} ETH`, `UserOperation hash: ${saved.userOperationHash}`, `PriorSeal authorization: ${saved.authorizationId}`, '', 'All three read-only lookups report no inclusion or pending operation. This broadcasts the operation and may spend test ETH.'].join('\n')
      if (!window.confirm(review)) return
      const attempted = { ...saved, stage: 'SUBMITTING' as const, submissionAttempts: saved.submissionAttempts + 1 }
      save(attempted); setPhase('submitted'); setLookupStatus('Submission started. If the browser disconnects, recovery will reconcile this exact hash and will not auto-submit.')
      const result = await rpc(BUNDLER_URL, 'eth_sendUserOperation', [toBundlerOperation(saved.userOperation), PILOT_ENTRY_POINT])
      if (typeof result !== 'string' || !hashPattern.test(result) || result.toLowerCase() !== saved.userOperationHash.toLowerCase()) throw new Error('Bundler did not return the exact saved UserOperation hash. Keep the checkpoint and reconcile it by hash.')
      const submitted = { ...attempted, stage: 'SUBMITTED' as const }
      save(submitted)
      const inclusion = await pollForInclusion(submitted)
      if (inclusion) await finishObservation(submitted, inclusion.transactionHash)
      else setLookupStatus(`No final inclusion source was available for ${result}; the submission checkpoint is retained and no resubmission occurred.`)
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function refreshAuthorization() {
    const saved = recovered.current.record
    if (!saved || saved.transactionHash || saved.submissionAttempts < 1 || saved.submissionAttempts >= 2) { setError('The saved operation is not eligible for a one-time fresh authorization.'); return }
    setBusy(true); setError('')
    const declined = new Error('Fresh PriorSeal authorization review declined')
    try {
      const { provider, address } = await walletContext(false)
      if (address.toLowerCase() !== saved.sender.toLowerCase()) throw new Error('Reconnect the same MetaMask EOA before recovery.')
      const checked = await inspectDelegation(address)
      if (!checked.delegated) throw new Error('The pinned EIP-7702 delegate is no longer active.')
      const found = await lookups(saved)
      if (found.kind !== 'ABSENT') throw new Error(found.kind === 'INCLUDED' ? 'The operation is included; finish its observation instead of refreshing authorization.' : found.kind === 'PENDING' ? 'The bundler still knows the operation; continue read-only recovery.' : 'At least one lookup failed. Absence is not established, so authorization refresh is paused.')
      const nonce = await checked.client.readContract({ address: PILOT_ENTRY_POINT, abi: entryPointAbi, functionName: 'getNonce', args: [address, 0n] })
      if (nonce !== asQuantity(saved.userOperation.nonce, 'nonce')) throw new Error('The EntryPoint nonce changed. Do not retry the saved UserOperation.')
      const [balance, deposit] = await Promise.all([checked.client.getBalance({ address }), checked.client.readContract({ address: PILOT_ENTRY_POINT, abi: entryPointAbi, functionName: 'balanceOf', args: [address] })])
      const currentGas = summarize(saved.userOperation, balance + deposit)
      if (currentGas.maxCost >= currentGas.balance) throw new Error('Current EOA balance plus EntryPoint deposit cannot cover the saved maximum gas fee.')
      const freshIntent = buildERC4337UserOperationIntent({ chainId: PILOT_CHAIN_ID, entryPoint: PILOT_ENTRY_POINT, entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH, entryPointVersion: '0.7', eip7702: { delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH }, userOperation: saved.userOperation, intentId: `metamask-7702-recovery-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, validUntil: Math.floor(Date.now() / 1000) + 3600, constraints: eip7702FinalityConstraints(capabilities) })
      if (freshIntent.userOperationHash?.toLowerCase() !== saved.userOperationHash.toLowerCase()) throw new Error('Fresh authorization would not bind the exact saved UserOperation.')
      if (!window.confirm(`Review a fresh PriorSeal authorization for the exact saved UserOperation.\n\nThe bundler receipt, bundler operation lookup and EntryPoint event search all report no inclusion. The EntryPoint nonce is unchanged. A prior submitted request could still have been delayed, so this recovery has one attempt remaining and still requires a separate submission review.\n\nUserOperation hash: ${saved.userOperationHash}\nMaximum fee: ${formatEther(currentGas.maxCost)} ETH\n\nContinue to the authorization signature?`)) return
      const now = Math.floor(Date.now() / 1000)
      const { accepted } = await api.authorizeWithWallet({ intent: freshIntent, principal: { type: 'user', id: `wallet:${address.slice(2).toLowerCase()}` }, delegate: { agentId: `agent:${address.slice(2).toLowerCase()}`, executor: address }, account: address, issuedAt: now, notBefore: now, expiresAt: freshIntent.validUntil, authorizationNonce: generateAuthorizationNonce(), maxUses: '1', audience: capabilities?.audience ?? 'priorseal' }, provider, { onCheckpoint(checkpoint) { if (checkpoint.stage === 'PREPARED' && !window.confirm(`Review the new authorization before MetaMask opens:\n\n${JSON.stringify({ ...checkpoint.prepared.authorization.intent, intentHash: checkpoint.prepared.authorization.intentHash }, null, 2)}`)) throw declined } })
      const nextAuthorization: AuthorizationRecord = { authorization: accepted.authorization, acceptance: accepted.acceptance, policyEvidence: accepted.policyEvidence, timestampEvidence: accepted.timestampEvidence, witnessEvidence: accepted.witnessEvidence, status: 'ACCEPTED', boundTxHash: null, uses: 0 }
      setAuthorization(nextAuthorization); setIntent(freshIntent); setOperation(saved.userOperation); setGas(currentGas)
      session.saveIntent(accepted.authorization.intent); session.saveAuthorization(nextAuthorization)
      save(createEip7702RecoveryRecord({ sender: saved.sender, userOperation: saved.userOperation, authorizationId: accepted.authorization.authorizationId, stage: 'AUTHORIZED', submissionAttempts: saved.submissionAttempts }))
      setPhase('authorized'); setLookupStatus('Fresh PriorSeal authorization accepted for the exact saved UserOperation. Review the operation and fee before its final allowed submission attempt.')
    } catch (caught) { if (caught !== declined) setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function exportEvidence() {
    const saved = recovered.current.record
    if (!saved || !observation || !saved.transactionHash) { setError('A final PriorSeal observation is required before export.'); return }
    setBusy(true); setError('')
    try {
      if (assessEip7702Observation(observation, saved, saved.transactionHash).kind !== 'FINAL') throw new Error('Only a final, canonical EIP-7702 observation can be exported.')
      const accepted = authorization ?? await api.getAuthorization(saved.authorizationId)
      downloadJson({ schema: 'priorseal.metamask-eip7702-pilot-evidence.v1', exportedAt: new Date().toISOString(), chain: { id: PILOT_CHAIN_ID, name: 'Base Sepolia' }, entryPoint: { address: PILOT_ENTRY_POINT, version: '0.7', runtimeCodeHash: PILOT_ENTRY_POINT_CODE_HASH }, delegation: { delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH }, userOperation: { hash: saved.userOperationHash, operation: saved.userOperation }, authorization: accepted.authorization, acceptance: accepted.acceptance, observation: observation.observation, receipt: observation.receipt, observationJob: observation.observationJob ?? null }, `priorseal-metamask-eip7702-${saved.userOperationHash.slice(2, 14)}.json`)
      clearEip7702RecoveryRecord(); recovered.current = { record: null, error: null }; setPhase('idle')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  return <>
    <PageHeader eyebrow="LOCAL TESTNET ONLY" title="MetaMask EIP-7702 pilot">Complete a Base Sepolia delegation, sign one zero-value EntryPoint v0.7 UserOperation, authorize its exact hash with PriorSeal, then recover and export independently observed evidence.</PageHeader>
    <div className="operation-sequence" aria-label="MetaMask EIP-7702 pilot workflow"><div><span>01 / DELEGATE</span><strong>Verify EOA and delegate</strong></div><div><span>02 / AUTHORIZE</span><strong>Sign exact operation</strong></div><div><span>03 / EXECUTE</span><strong>Submit, recover, verify</strong></div></div>
    {error && <Notice tone="danger" title="Pilot paused">{cleanError(error)}</Notice>}
    {recovered.current.error && <Notice tone="danger" title="Saved recovery data could not be verified">The page will not start a new operation until the saved data is repaired or reconciled.</Notice>}
    {recovery && <Notice tone="warning" title={recovery.stage === 'SUBMITTING' ? 'Submission status is uncertain' : recovery.stage === 'SUBMITTED' ? 'Operation is awaiting inclusion or finality' : 'Authorized operation saved in this tab'}>{recovery.stage === 'AUTHORIZED' ? 'The signed operation and authorization ID are saved in session storage. It has not been broadcast.' : `Submission attempt ${recovery.submissionAttempts} is saved. Recovery is read-only and never resubmits automatically.`}</Notice>}
    {setup.id && <Notice tone="warning" title="MetaMask wallet setup is awaiting status check">Setup batch <CodeValue value={setup.id} /> is separate from PriorSeal authorization. Complete any MetaMask prompt, then check the status and verify the delegation onchain.</Notice>}
    {!capabilities && <Notice tone="warning" title="Checking PriorSeal API">The local API must report its workflow and Base Sepolia support before authorization.</Notice>}
    {capabilities && !canUse && <Notice tone="danger" title="PriorSeal ERC-4337 is not ready">The API does not report a ready Base Sepolia ERC-4337 EIP-712 workflow. Start the configured local API and reload.</Notice>}
    <section className="panel intent-form" aria-busy={busy}>
      <div className="form-section-heading"><span>TEST OPERATION</span><strong>MetaMask EOA · one no-op call</strong></div>
      <dl className="data-grid"><div><dt>Network</dt><dd>Base Sepolia · 84532</dd></div><div><dt>EOA</dt><dd><CodeValue value={accountAddress || 'Connect MetaMask'} /></dd></div><div><dt>Delegate</dt><dd><CodeValue value={PILOT_7702_DELEGATE} /></dd></div><div><dt>EntryPoint</dt><dd>v0.7 · <CodeValue value={PILOT_ENTRY_POINT} /></dd></div><div><dt>Operation</dt><dd>zero-value empty call to zero address</dd></div><div><dt>Stage</dt><dd><Status value={phase.toUpperCase()} small /></dd></div></dl>
      <Notice tone="warning" title="MetaMask setup is a separate wallet action">The initial EIP-7702 wallet-upgrade batch and the later signed UserOperation are distinct. Verify the delegate onchain before the pilot will prepare an authorization.</Notice>
      {gas && <><div className="form-section-heading"><span>GAS REVIEW</span><strong>Bundler estimate</strong></div><dl className="data-grid"><div><dt>EntryPoint nonce</dt><dd>{gas.nonce.toString()}</dd></div><div><dt>Call gas limit</dt><dd>{gas.callGasLimit.toString()}</dd></div><div><dt>Verification gas limit</dt><dd>{gas.verificationGasLimit.toString()}</dd></div><div><dt>Pre-verification gas</dt><dd>{gas.preVerificationGas.toString()}</dd></div><div><dt>Maximum gas price</dt><dd>{gas.maxFeePerGas.toString()} wei</dd></div><div><dt>Conservative maximum fee</dt><dd>{formatEther(gas.maxCost)} ETH</dd></div><div><dt>EOA balance + EntryPoint deposit</dt><dd>{formatEther(gas.balance)} ETH</dd></div></dl></>}
      {intent?.userOperationHash && <><div className="form-section-heading"><span>AUTHORIZATION</span><strong>Bound UserOperation</strong></div><p className="mono"><CodeValue value={intent.userOperationHash} /></p></>}
      {authorizationId && <p>PriorSeal authorization: <CodeValue value={authorizationId} /></p>}{transactionHash && <p>Outer transaction hash: <CodeValue value={transactionHash} /></p>}
      {lookupStatus && <p role="status">{lookupStatus}</p>}
      {!setup.id && phase === 'idle' && <button className="button primary" type="button" disabled={busy || Boolean(recovered.current.error)} onClick={() => void prepareDelegation()}>{busy ? 'Checking MetaMask and delegation…' : 'Connect MetaMask and verify or prepare delegation'}</button>}
      {setup.id && <button className="button primary" type="button" disabled={busy} onClick={() => void checkSetupStatus()}>{busy ? 'Checking wallet batch…' : 'Check MetaMask setup status'}</button>}
      {phase === 'idle' && !setup.id && accountAddress && <button className="button secondary" type="button" disabled={busy || !canUse || Boolean(recovered.current.error)} onClick={() => void estimateOperation()}>{busy ? 'Checking bundler and estimating…' : 'Estimate the delegated UserOperation'}</button>}
      {phase === 'estimated' && <button className="button primary" type="button" disabled={busy} onClick={() => void signOperation()}>{busy ? 'Waiting for MetaMask signature…' : 'Review and sign UserOperation'}</button>}
      {phase === 'signed' && <button className="button primary" type="button" disabled={busy} onClick={() => void authorizeOperation()}>{busy ? 'Preparing PriorSeal authorization…' : 'Review and authorize with PriorSeal'}</button>}
      {phase === 'authorized' && <button className="button primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Reconciling and preparing…' : 'Review and submit saved UserOperation'}</button>}
      {phase === 'submitted' && <><button className="button primary" type="button" disabled={busy} onClick={() => void resume()}>{busy ? 'Checking read-only status…' : 'Resume receipt, event and finality checks'}</button>{recovery && !recovery.transactionHash && recovery.submissionAttempts > 0 && recovery.submissionAttempts < 2 && <button className="button secondary" type="button" disabled={busy} onClick={() => void refreshAuthorization()}>{busy ? 'Reconciling…' : 'Reconcile and request a fresh authorization'}</button>}</>}
      {phase === 'complete' && observation && <><Notice tone={observation.observation.status === 'CONFIRMED' ? 'success' : 'danger'} title={observation.observation.status === 'CONFIRMED' ? 'UserOperation confirmed' : 'UserOperation failed or reverted'}>{observation.observation.status === 'CONFIRMED' ? 'PriorSeal verified operation identity, delegate execution evidence and required finality.' : 'The final failure is preserved as evidence; gas may have been charged.'} Receipt {observation.receipt?.receiptId ?? 'is not available'}.</Notice><button className="button primary" type="button" disabled={busy} onClick={() => void exportEvidence()}>{busy ? 'Preparing evidence…' : 'Download pilot evidence bundle'}</button></>}
    </section>
  </>
}
