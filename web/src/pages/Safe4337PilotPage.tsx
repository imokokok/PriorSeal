import { useEffect, useRef, useState } from 'react'
import { GenericFeeEstimator, Safe4337Pack } from '@safe-global/relay-kit'
import { formatEther } from 'viem'
import { buildERC4337UserOperationIntent, generateAuthorizationNonce } from 'priorseal-sdk'
import { CodeValue, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, type Capabilities } from '../lib/api'
import { session } from '../lib/storage'
import type { AuthorizationRecord, Eip1193Provider, Intent, ObservationResult } from '../types'

const CHAIN_ID = 84532
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const ENTRY_POINT_CODE_HASH = '0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58'
const MODULE = '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226'
const SAFE = '0xDBad58d4340E1CF5ADec9aF02E494EE9f9174C0f'
const OWNER = '0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC'
const BUNDLER_URL = new URL('/__priorseal_bundler', window.location.origin).toString()
const RPC_URL = new URL('/__priorseal_rpc', window.location.origin).toString()

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
  for (const field of ['factory', 'factoryData', 'paymaster', 'paymasterData', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) {
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

export function Safe4337PilotPage() {
  const packRef = useRef<Safe4337Pack | null>(null)
  const operationRef = useRef<SafeOperation | null>(null)
  const signedOperationRef = useRef<SafeOperation | null>(null)
  const intentRef = useRef<Intent | null>(null)
  const authorizationRef = useRef<AuthorizationRecord | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [account, setAccount] = useState('')
  const [phase, setPhase] = useState<PilotPhase>('idle')
  const [gas, setGas] = useState<GasSummary | null>(null)
  const [userOperationHash, setUserOperationHash] = useState('')
  const [authorizationId, setAuthorizationId] = useState('')
  const [transactionHash, setTransactionHash] = useState('')
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getCapabilities().then(setCapabilities).catch((caught) => setError(cleanError(caught))) }, [])

  function wallet() {
    const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum
    if (!provider) throw new Error('Open this local pilot in Chrome with MetaMask enabled.')
    return provider
  }

  async function connectAndEstimate() {
    setBusy(true); setError(''); setObservation(null); setTransactionHash(''); setAuthorizationId(''); setUserOperationHash('')
    try {
      const provider = wallet()
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
      const walletAccount = accounts[0]?.toLowerCase()
      if (!walletAccount || walletAccount !== OWNER.toLowerCase()) throw new Error('Connect the MetaMask owner account shown in this pilot.')
      const chain = await provider.request({ method: 'eth_chainId' })
      if (typeof chain !== 'string' || Number(BigInt(chain)) !== CHAIN_ID) throw new Error('Switch MetaMask to Base Sepolia (chain ID 84532), then retry.')
      const safeBalanceHex = await provider.request({ method: 'eth_getBalance', params: [SAFE, 'latest'] })
      if (typeof safeBalanceHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(safeBalanceHex)) throw new Error('MetaMask did not return a valid Safe balance.')
      const pack = await Safe4337Pack.init({
        provider: provider as never,
        signer: OWNER,
        bundlerUrl: BUNDLER_URL,
        safeModulesVersion: '0.3.0',
        customContracts: { entryPointAddress: ENTRY_POINT, safe4337ModuleAddress: MODULE },
        options: { safeAddress: SAFE },
      })
      if (Number(await pack.getChainId()) !== CHAIN_ID) throw new Error('The configured bundler is not connected to Base Sepolia.')
      const supported = await pack.getSupportedEntryPoints()
      if (!supported.some((address) => address.toLowerCase() === ENTRY_POINT.toLowerCase())) throw new Error('The configured bundler does not support the pinned EntryPoint v0.7.')
      const operation = await pack.createTransaction({
        transactions: [{ to: OWNER, value: '0', data: '0x', operation: 0 }],
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
    if (!window.confirm(`Review Safe operation on Base Sepolia:\n\nSafe: ${SAFE}\nTarget: ${OWNER}\nValue: 0 ETH\nCalldata: empty\nMode: CALL\nEstimated maximum gas fee: ${formatEth(gas.maxCost)}\nSafe balance: ${formatEth(gas.balance)}\n\nThe next MetaMask prompt signs this exact Safe operation. It does not submit it.`)) return
    setBusy(true); setError('')
    try {
      const signed = await pack.signSafeOperation(operation)
      const validUntil = Math.floor(Date.now() / 1000) + 3600
      const nextIntent = buildERC4337UserOperationIntent({
        chainId: CHAIN_ID,
        entryPoint: ENTRY_POINT,
        entryPointCodeHash: ENTRY_POINT_CODE_HASH,
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
      if (!capabilities.workflowReady || !capabilities.chains.includes(CHAIN_ID) || !capabilities.executionProfiles.includes('priorseal.execution-profile.erc4337-user-operation.v1') || !capabilities.authorizers.includes('eip712')) throw new Error('The local PriorSeal API is not configured for Base Sepolia ERC-4337 EIP-712 authorization.')
      const now = Math.floor(Date.now() / 1000)
      const { accepted } = await api.authorizeWithWallet({
        intent,
        principal: { type: 'user', id: `wallet:${account.slice(2)}` },
        delegate: { agentId: `agent:${SAFE.slice(2)}`, executor: SAFE },
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
      setPhase('authorized')
    } catch (caught) { if (caught !== reviewDeclined) setError(cleanError(caught)) } finally { setBusy(false) }
  }

  async function submitAndObserve() {
    const pack = packRef.current
    const operation = signedOperationRef.current
    const authorization = authorizationRef.current
    if (!pack || !operation || !authorization || !gas || !userOperationHash) { setError('Sign and authorize the operation first.'); return }
    if (!window.confirm(`Submit this signed UserOperation to the Base Sepolia bundler now?\n\nSafe: ${SAFE}\nTarget: ${OWNER}\nValue: 0 ETH\nEstimated maximum gas fee: ${formatEth(gas.maxCost)}\nAvailable Safe balance: ${formatEth(gas.balance)}\nUserOperation hash: ${userOperationHash}\n\nThis broadcasts the operation and consumes test ETH for gas.`)) return
    setBusy(true); setError('')
    try {
      const submittedHash = await pack.executeTransaction({ executable: operation })
      if (submittedHash.toLowerCase() !== userOperationHash.toLowerCase()) throw new Error('Bundler returned a different UserOperation hash; stop and investigate before retrying.')
      setTransactionHash(submittedHash)
      setPhase('submitted')
      const deadline = Date.now() + 120_000
      let receipt = await pack.getUserOperationReceipt(submittedHash)
      while (!receipt && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        receipt = await pack.getUserOperationReceipt(submittedHash)
      }
      if (!receipt) throw new Error(`UserOperation ${submittedHash} is still pending. Keep this hash and resume observation later.`)
      const result = await api.observeExecutionUntilFinal({ authorizationId: authorization.authorization.authorizationId, chainId: CHAIN_ID, txHash: receipt.receipt.transactionHash, confirmations: capabilities?.minConfirmations ?? 0 }, { timeoutMs: 120_000 })
      session.saveObservation(result.observation)
      if (result.receipt) session.saveReceipt(result.receipt)
      if (result.observationJob) session.saveObservationJob(result.observationJob)
      setObservation(result)
      setPhase('complete')
    } catch (caught) { setError(cleanError(caught)) } finally { setBusy(false) }
  }

  const canUse = Boolean(capabilities?.workflowReady && capabilities.chains.includes(CHAIN_ID) && capabilities.executionProfiles.includes('priorseal.execution-profile.erc4337-user-operation.v1') && capabilities.authorizers.includes('eip712'))
  return <>
    <PageHeader eyebrow="LOCAL TESTNET ONLY" title="Safe ERC-4337 pilot">Prepare one zero-value CALL, bind it to a PriorSeal authorization, then submit only after reviewing the exact operation and estimated fee.</PageHeader>
    <div className="operation-sequence" aria-label="Safe ERC-4337 pilot workflow"><div><span>01 / ESTIMATE</span><strong>Review call and fee</strong></div><div><span>02 / AUTHORIZE</span><strong>Sign Safe and PriorSeal data</strong></div><div><span>03 / EXECUTE</span><strong>Submit and observe</strong></div></div>
    {error && <Notice tone="danger" title="Pilot paused">{error}</Notice>}
    {!capabilities && <Notice tone="warning" title="Checking the local PriorSeal API">The Safe operation can be estimated after the local API reports its supported chains and execution profiles.</Notice>}
    {capabilities && !canUse && <Notice tone="danger" title="PriorSeal ERC-4337 is not ready">The local API does not report a ready Base Sepolia ERC-4337 EIP-712 workflow. Start the configured local PriorSeal API and reload.</Notice>}
    <section className="panel intent-form" aria-busy={busy}>
      <div className="form-section-heading"><span>TEST OPERATION</span><strong>One zero-value Safe CALL</strong></div>
      <dl className="data-grid">
        <div><dt>Network</dt><dd>Base Sepolia · 84532</dd></div>
        <div><dt>Safe</dt><dd><CodeValue value={SAFE} /></dd></div>
        <div><dt>Owner wallet</dt><dd><CodeValue value={OWNER} /></dd></div>
        <div><dt>Target</dt><dd><CodeValue value={OWNER} /></dd></div>
        <div><dt>Value</dt><dd>0 ETH</dd></div>
        <div><dt>Calldata</dt><dd>empty</dd></div>
        <div><dt>EntryPoint</dt><dd>v0.7</dd></div>
        <div><dt>Current stage</dt><dd><Status value={phase === 'idle' ? 'NOT_STARTED' : phase.toUpperCase().replace('-', '_')} small /></dd></div>
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
      {transactionHash && <p>Bundler UserOperation hash: <CodeValue value={transactionHash} /></p>}
      {phase === 'idle' && <button className="button primary" type="button" disabled={busy || !canUse} onClick={() => void connectAndEstimate()}>{busy ? 'Checking wallet and estimating…' : 'Connect owner wallet and estimate'}</button>}
      {phase === 'estimated' && <button className="button primary" type="button" disabled={busy} onClick={() => void signSafeOperation()}>{busy ? 'Waiting for Safe signature…' : 'Review and sign Safe operation'}</button>}
      {phase === 'safe-signed' && <button className="button primary" type="button" disabled={busy} onClick={() => void authorizeWithPriorSeal()}>{busy ? 'Preparing PriorSeal authorization…' : 'Review and authorize with PriorSeal'}</button>}
      {phase === 'authorized' && <button className="button primary" type="button" disabled={busy} onClick={() => void submitAndObserve()}>{busy ? 'Submitting and observing…' : 'Review and submit UserOperation'}</button>}
      {phase === 'submitted' && <p role="status">Submitted. Waiting for the bundler receipt and PriorSeal observation…</p>}
      {phase === 'complete' && observation && <Notice tone={observation.observation.status === 'CONFIRMED' ? 'success' : 'warning'} title="PriorSeal observation received">The UserOperation was observed with status {observation.observation.status}; receipt {observation.receipt?.receiptId ?? 'is not yet available'}.</Notice>}
    </section>
  </>
}
