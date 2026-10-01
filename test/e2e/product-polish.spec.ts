import { expect, test } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildReviewManifest } from '../../sdk/dist/verifier.js'
import type { ReviewResult } from '../../sdk/dist/verifier.js'
import { privateKeyToAccount } from 'viem/accounts'
import { V3_SINGLE_SWAP_ABI, buildExactCallIntent, buildV3SwapIntent, createV3SwapApproval, swapApprovalCommitment } from '../../sdk/dist/index.js'
import { encodeFunctionData, keccak256 } from 'viem'
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildVerificationBundle, createMemoryStore } from '../../src/index.mjs'
import { signReceipt } from '../../src/domain/receipt.mjs'
import { createJointReviewFixture } from '../helpers/joint-review-fixture.mjs'

const caps = { schema: 'priorseal.capabilities.v1', issuer: 'fixture', audience: 'partner-deployment', executionProfiles: ['priorseal.execution-profile.exact-call.v1'], chains: [8453, 84532], authorizers: ['eip712'], proofMode: 'issuer', policyHash: `0x${'0'.repeat(64)}`, minConfirmations: 12, dependencies: { issuer: 'configured', timestamp: 'not_required', rpc: 'configured', storage: 'available' }, workflowReady: true, checkedAt: 1_800_000_000, archive: { enabled: true, retention: 'until_operator_deletion', scope: 'project_uploaded_evidence' } }
declare global {
  interface Window {
    __walletCalls: string[]
    __signFixture: (data: unknown) => Promise<string>
    ethereum: { request: (input: { method: string; params?: unknown[] }) => Promise<unknown> }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('priorseal.storage-preference.v1', JSON.stringify({ choice: 'denied', updatedAt: Date.now() })) })
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: caps }))
})

test('standard authorization reviews the canonical intent before the SDK signs or accepts it', async ({ page }, testInfo) => {
  const signer = privateKeyToAccount(`0x${'5'.repeat(64)}`)
  const sender = `0x${'a'.repeat(40)}`
  let approve = false
  let acceptRequests = 0
  await page.exposeFunction('__signFixture', (data: unknown) => signer.signTypedData(data as Parameters<typeof signer.signTypedData>[0]))
  await page.addInitScript((address) => { window.__walletCalls = []; window.ethereum = { request: async ({ method, params }) => { window.__walletCalls.push(method); return method === 'eth_requestAccounts' ? [address] : window.__signFixture(JSON.parse(String(params?.[1]))) } } }, signer.address)
  page.on('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Review canonical intent:')
    if (approve) await dialog.accept()
    else await dialog.dismiss()
  })
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: { ...caps, executionProfiles: ['priorseal.intent.v1'] } }))
  await page.route('**/v1/authorizations/prepare', async (route) => {
    const input = route.request().postDataJSON()
    expect(input.intent.sender).toBe(sender)
    expect(input.audience).toBe(caps.audience)
    const authorization = buildAuthorization({ ...input, policyHash: caps.policyHash })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authorization, typedData: authorizationTypedData(authorization) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value) })
  })
  await page.route('**/v1/authorizations', async (route) => {
    acceptRequests += 1
    const authorization = route.request().postDataJSON()
    await route.fulfill({ json: { authorization, acceptance: { acceptedAt: Math.floor(Date.now() / 1000), status: 'ACCEPTED', authorizationId: authorization.authorizationId } } })
  })
  await page.goto('/app/intents/new')
  await page.getByLabel('Amount', { exact: true }).fill('1')
  await page.getByLabel('Transaction nonce').fill('7')
  await page.getByLabel('Agent execution wallet').fill(sender)
  await page.getByLabel('Authorized recipient').fill(`0x${'b'.repeat(40)}`)
  await page.getByRole('button', { name: 'Review canonical intent' }).click()
  await expect(page.getByRole('button', { name: 'Review canonical intent' })).toBeEnabled()
  expect(await page.evaluate(() => window.__walletCalls)).toEqual(['eth_requestAccounts'])
  expect(acceptRequests).toBe(0)

  approve = true
  await page.getByRole('button', { name: 'Review canonical intent' }).click()
  await expect(page.getByRole('heading', { name: 'Authorization accepted' })).toBeVisible()
  await expect(page.locator('.outcome-path')).toContainText('Observe separately')
  await page.screenshot({ path: testInfo.outputPath('authorization-accepted-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(await page.evaluate(() => window.__walletCalls)).toEqual(['eth_requestAccounts', 'eth_requestAccounts', 'eth_signTypedData_v4'])
  expect(acceptRequests).toBe(1)
})

test('exact-call canonical preview uses SDK binding and resumes identical acceptance after refresh and expiry without another signature', async ({ page }) => {
  const transaction = { chainId: 84532, from: `0x${'a'.repeat(40)}`, to: `0x${'b'.repeat(40)}`, nonce: '7', value: '0', data: '0x1234' as const }
  const contexts = [{ namespace: 'agent-call-envelope.v1', algorithm: 'sha256' as const, digest: `0x${'c'.repeat(64)}` }]
  const requests: { body: unknown; key: string }[] = []
  const signer = privateKeyToAccount(`0x${'3'.repeat(64)}`)
  await page.exposeFunction('__signFixture', (data: unknown) => signer.signTypedData(data as Parameters<typeof signer.signTypedData>[0]))
  await page.addInitScript((address) => { window.__walletCalls = []; window.ethereum = { request: async ({ method, params }) => { window.__walletCalls.push(method); return method === 'eth_requestAccounts' ? [address] : window.__signFixture(JSON.parse(String(params?.[1]))) } } }, signer.address)
  await page.route('**/v1/authorizations/prepare', async (route) => {
    const input = route.request().postDataJSON()
    expect(input.intent).toEqual(buildExactCallIntent({ transaction, intentId: input.intent.intentId, asset: 'eip155:84532/native', amount: '0', validUntil: input.intent.validUntil, constraints: { minConfirmations: 12 }, contextCommitments: contexts }))
    expect(input.audience).toBe('partner-deployment')
    const prepared = buildAuthorization({ ...input, policyHash: caps.policyHash })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authorization: prepared, typedData: authorizationTypedData(prepared) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value) })
  })
  await page.route('**/v1/authorizations', async (route) => {
    requests.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
    if (requests.length === 1) await route.fulfill({ status: 503, json: { error: { message: 'Acceptance response temporarily unavailable' } } })
    else await route.fulfill({ json: { authorization: requests[1].body, acceptance: { acceptedAt: Math.floor(Date.now() / 1000), status: 'ACCEPTED', authorizationId: (requests[1].body as { authorizationId: string }).authorizationId } } })
  })
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify(transaction))
  await page.getByLabel('Context commitments (optional)').fill(JSON.stringify(contexts))
  await page.getByRole('button', { name: 'Prepare canonical intent' }).click()
  await expect(page.getByRole('heading', { name: 'Review canonical authorization' })).toBeVisible()
  expect(await page.evaluate(() => window.__walletCalls)).toEqual(['eth_requestAccounts'])
  await page.getByRole('button', { name: 'Confirm and sign authorization' }).click()
  await expect(page.getByText('Acceptance response temporarily unavailable', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__walletCalls)).toEqual(['eth_requestAccounts', 'eth_signTypedData_v4'])
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export recovery checkpoint' }).click()
  const checkpointFile = await (await exported).path()
  await page.reload()
  await page.clock.install({ time: new Date(Date.now() + 2 * 60 * 60_000) })
  await page.getByLabel('Authorization checkpoint file').setInputFiles(checkpointFile!)
  await page.getByRole('button', { name: 'Retry acceptance of the same signed bytes' }).click()
  await expect(page.getByRole('heading', { name: 'Authorization accepted' })).toBeVisible()
  await expect(page.getByText('Authorization window is not active', { exact: true })).toBeVisible()
  expect(requests[0]).toEqual(requests[1])
  expect(await page.evaluate(() => window.__walletCalls)).toEqual([])
})

test('unsupported exact-call workflow is rejected before any wallet request', async ({ page }) => {
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: { ...caps, chains: [1] } }))
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify({ chainId: 8453, from: `0x${'a'.repeat(40)}`, to: `0x${'b'.repeat(40)}`, nonce: '7', value: '0', data: '0x' }))
  await expect(page.getByText('This chain is not supported by the selected deployment.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prepare canonical intent' })).toBeDisabled()
})

test('swap review decodes the call, checks router code, and signs the same approved fields', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000)
  const signer = privateKeyToAccount(`0x${'3'.repeat(64)}`)
  const sender = signer.address.toLowerCase() as `0x${string}`
  const router = `0x${'2'.repeat(40)}` as const
  const inputToken = '0x4200000000000000000000000000000000000006' as const
  const outputToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const
  const recipient = `0x${'6'.repeat(40)}` as const
  const routerCode = '0x60006000'
  const transaction = { chainId: 8453, from: sender, to: router, nonce: '7', value: '0', data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: inputToken, tokenOut: outputToken, fee: 3000, recipient, deadline: BigInt(now + 7200), amountIn: 1_000_000n, amountOutMinimum: 900_000n, sqrtPriceLimitX96: 0n }] }) }
  const approval = createV3SwapApproval(transaction, keccak256(routerCode))
  const walletCalls: string[] = []
  await page.exposeFunction('__signFixture', (data: unknown) => signer.signTypedData(data as Parameters<typeof signer.signTypedData>[0]))
  await page.addInitScript(({ address, code, inputToken }) => { window.ethereum = { request: async ({ method, params }) => {
    window.__walletCalls ??= []; window.__walletCalls.push(method)
    if (method === 'eth_chainId') return '0x2105'
    if (method === 'eth_getCode') return code
    if (method === 'eth_call') return (params?.[0] as { to?: string })?.to?.toLowerCase() === inputToken ? '0x12' : '0x6'
    if (method === 'eth_requestAccounts') return [address]
    if (method === 'eth_signTypedData_v4') return window.__signFixture(JSON.parse(String(params?.[1])))
    throw new Error(`Unexpected wallet method ${method}`)
  } } }, { address: signer.address, code: routerCode, inputToken })
  await page.route('**/v1/authorizations/prepare', async (route) => {
    const input = route.request().postDataJSON()
    const expected = buildV3SwapIntent({ approval, transaction, intentId: input.intent.intentId, validUntil: input.intent.validUntil, constraints: { minConfirmations: 12 }, now })
    expect(input.intent).toEqual(expected)
    const prepared = buildAuthorization({ ...input, policyHash: caps.policyHash })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authorization: prepared, typedData: authorizationTypedData(prepared) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value) })
  })
  let acceptanceCalls = 0
  await page.route('**/v1/authorizations', async (route) => {
    acceptanceCalls += 1
    if (acceptanceCalls === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Acceptance response temporarily unavailable' } } }); return }
    const signed = route.request().postDataJSON()
    await route.fulfill({ json: { authorization: signed, acceptance: { acceptedAt: now, status: 'ACCEPTED', authorizationId: signed.authorizationId } } })
  })
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Review as a single-pool ERC-20 swap').check()
  await page.getByLabel('Trusted router runtime code hash').fill(approval.routerCodeHash)
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify(transaction))
  await expect(page.getByRole('heading', { name: 'Swap you are approving' })).toBeVisible()
  await expect(page.locator('.preview')).toContainText('1000000 atomic units')
  await expect(page.locator('.preview')).toContainText('900000 atomic units')
  await expect(page.locator('.preview')).toContainText('contract decimals: 6')
  await expect(page.locator('.preview')).toContainText('WETH')
  await expect(page.locator('.preview')).toContainText('USDC')
  await page.getByRole('button', { name: 'Prepare canonical intent' }).click()
  await expect(page.getByRole('heading', { name: 'Review canonical authorization' })).toBeVisible()
  const checkpointDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export recovery checkpoint' }).click()
  const checkpointFile = await (await checkpointDownload).path()
  await page.reload()
  await page.getByLabel('Authorization checkpoint file').setInputFiles(checkpointFile!)
  await expect(page.getByRole('heading', { name: 'Review canonical authorization' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Swap you are approving' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm and sign authorization' }).click()
  await expect(page.getByText('Acceptance response temporarily unavailable', { exact: true })).toBeVisible()
  walletCalls.push(...await page.evaluate(() => window.__walletCalls))
  const signedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export recovery checkpoint' }).click()
  const signedCheckpointFile = await (await signedDownload).path()
  await page.reload()
  await page.clock.install({ time: new Date(Date.now() + 3 * 60 * 60_000) })
  await page.getByLabel('Authorization checkpoint file').setInputFiles(signedCheckpointFile!)
  await page.getByRole('button', { name: 'Retry acceptance of the same signed bytes' }).click()
  await expect(page.getByRole('heading', { name: 'Authorization accepted' })).toBeVisible()
  const replanned = { ...transaction, data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: inputToken, tokenOut: outputToken, fee: 3000, recipient: sender, deadline: BigInt(now + 7200), amountIn: 1_000_000n, amountOutMinimum: 900_000n, sqrtPriceLimitX96: 0n }] }) }
  await page.getByLabel('Proposed transaction JSON').fill(JSON.stringify(replanned))
  await expect(page.getByText('New authorization required')).toBeVisible()
  await expect(page.getByText('recipient', { exact: true })).toBeVisible()
  await expect(page.getByText('Authorization window is not active', { exact: true })).toBeVisible()
  expect(acceptanceCalls).toBe(2)
  expect(walletCalls).toContain('eth_getCode')
  expect(walletCalls).toContain('eth_signTypedData_v4')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download swap approval package' }).click()
  const exported = await download
  expect(exported.suggestedFilename()).toContain('-swap-approval.json')
  const packagePath = await exported.path()
  expect(packagePath).toBeTruthy()
  const saved = JSON.parse(await readFile(packagePath!, 'utf8'))
  expect(saved.approval).toEqual(approval)
  expect(saved.transaction).toEqual(transaction)
  expect(saved.authorization.authorization.intent.contextCommitments).toContainEqual(swapApprovalCommitment(approval))
})

test('swap signing stops when wallet RPC router code differs from the reviewed hash', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000)
  const transaction = { chainId: 8453, from: `0x${'1'.repeat(40)}`, to: `0x${'2'.repeat(40)}`, nonce: '7', value: '0', data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: `0x${'3'.repeat(40)}`, tokenOut: `0x${'4'.repeat(40)}`, fee: 3000, recipient: `0x${'5'.repeat(40)}`, deadline: BigInt(now + 7200), amountIn: 1_000_000n, amountOutMinimum: 900_000n, sqrtPriceLimitX96: 0n }] }) }
  await page.addInitScript(() => { window.__walletCalls = []; window.ethereum = { request: async ({ method }) => { window.__walletCalls.push(method); return method === 'eth_chainId' ? '0x2105' : method === 'eth_getCode' ? '0x6001' : [] } } })
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Review as a single-pool ERC-20 swap').check()
  await page.getByLabel('Trusted router runtime code hash').fill(keccak256('0x60006000'))
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify(transaction))
  await page.getByRole('button', { name: 'Prepare canonical intent' }).click()
  await expect(page.getByText('SWAP_ROUTER_CODE_MISMATCH')).toBeVisible()
  expect(await page.evaluate(() => window.__walletCalls)).toContain('eth_getCode')
  expect(await page.evaluate(() => window.__walletCalls)).not.toContain('eth_signTypedData_v4')
})

async function nativeFixture() {
  const now = Math.floor(Date.now() / 1000)
  const keys = generateKeyPairSync('ed25519')
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`)
  const executor = `0x${'a'.repeat(40)}`
  const intent = { intentId: 'e2e-trust', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender: executor, recipient: `0x${'b'.repeat(40)}`, validUntil: now + 3600, nonce: '7' }
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: now - 100, notBefore: now - 100, expiresAt: now + 3600, authorizationNonce: `0x${'7'.repeat(64)}`, maxUses: '1', audience: 'partner-deployment', policyHash: `0x${'0'.repeat(64)}` })
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) })
  const accepted = await authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => (now - 90) * 1000 }), privateKeyPem: privateKey, issuer: 'fixture', keyId: 'key-1', audience: 'partner-deployment', now: () => (now - 90) * 1000 })
  const execution = { chainId: 8453, txHash: `0x${'7'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, executedAt: now - 50, observedAt: now - 40, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' }
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: 'fixture', keyId: 'key-1', issuedAt: now - 40 }), privateKey)
  const key = { issuer: 'fixture', keyId: 'key-1', algorithm: 'Ed25519', publicKey, status: 'active', validFrom: null, validUntil: null }
  const bundle = buildVerificationBundle({ receipt, keyRegistry: { schema: 'priorseal.keys.v1', issuer: 'fixture', keys: [key] }, assembledAt: now })
  const profile = { schema: 'priorseal.trust-profile.v1', name: 'Fixture trust', issuer: 'fixture', audience: 'partner-deployment', keys: [key], source: 'Independent test provisioning', confirmedAt: now }
  return { bundle, profile }
}

test('native bundle never self-trusts and custom audience is enforced after independent profile import', async ({ page }) => {
  const { bundle, profile } = await nativeFixture()
  await page.route('**/.well-known/priorseal-keys.json', (route) => route.fulfill({ json: { schema: 'priorseal.keys.v1', issuer: 'fixture', keys: [] } }))
  await page.goto('/app/verify')
  await page.getByLabel('Evidence JSON', { exact: true }).fill(JSON.stringify(bundle))
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result')).toContainText('UNKNOWN_KEY')
  await page.getByText('Import a trust profile', { exact: true }).click()
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify(profile))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result')).toContainText('TRUST SOURCE REQUIRED')
  await page.getByLabel('I confirmed this issuer, audience and public key configuration through an independent trusted channel.').check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result > .status')).toHaveText(/VALID/)
  await expect(page.locator('.verification-result')).toContainText('Independently confirmed configuration')
  await expect(page.getByRole('heading', { name: 'Evidence relationship' })).toBeVisible()
  await expect(page.locator('.evidence-relationship')).toContainText('External decision use')
  await expect(page.locator('.evidence-relationship')).toContainText('NOT ESTABLISHED')
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify({ ...profile, audience: 'wrong-deployment' }))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result')).toContainText('AUTHORIZATION_AUDIENCE_MISMATCH')
})

test('a trust profile draft without confirmedAt stays untrusted until explicit confirmation', async ({ page }) => {
  const { bundle, profile } = await nativeFixture()
  const { confirmedAt: _confirmedAt, ...draft } = profile
  await page.goto('/app/verify')
  await page.getByLabel('Evidence JSON', { exact: true }).fill(JSON.stringify(bundle))
  await page.getByText('Import a trust profile', { exact: true }).click()
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify(draft))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await expect(page.getByText('Not recorded', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save confirmed profile' })).toBeDisabled()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result')).toContainText('TRUST SOURCE REQUIRED')

  // Browser storage is input too: an old or injected draft cannot be selected as saved trust.
  await page.goto('/app')
  await page.evaluate((storedDraft) => {
    localStorage.setItem('priorseal.storage-preference.v1', JSON.stringify({ choice: 'granted', updatedAt: Date.now() }))
    localStorage.setItem('priorseal.trust-profiles.v1', JSON.stringify([storedDraft]))
  }, { ...draft, confirmedAt: 0 })
  await page.locator('a[href="/app/verify"]').first().click()
  await expect(page.getByLabel('Saved trust profile').locator('option')).toHaveCount(1)
})

test('receipt detail presents unverified receipt fields as signed claims', async ({ page }) => {
  const { bundle } = await nativeFixture()
  await page.route(`**/v1/receipts/${encodeURIComponent(bundle.receipt.receiptId)}`, route => route.fulfill({ json: bundle.receipt }))
  await page.goto(`/app/receipts/${encodeURIComponent(bundle.receipt.receiptId)}`)
  const relationship = page.locator('.evidence-relationship')
  await expect(relationship.getByRole('heading', { name: 'Evidence relationship' })).toBeVisible()
  await expect(relationship.locator('.relationship-chain li').filter({ hasText: 'Receipt identifier' })).toContainText('SIGNED CLAIM')
  await expect(relationship.locator('.relationship-assessments > div').filter({ hasText: 'Cryptographic evidence' })).toContainText('NOT VERIFIED HERE')
  await expect(relationship.locator('.relationship-assessments > div').filter({ hasText: 'External decision use' })).toContainText('NOT ESTABLISHED')
})

test('archive reviewer access is scoped, excludes upload, and keeps token out of browser storage', async ({ page }) => {
  await page.route('**/v1/archive?*', async (route) => { expect(route.request().headers().authorization).toBe('Bearer fixture-review-token'); await route.fulfill({ json: { schema: 'priorseal.archive-page.v1', projectId: 'project-a', environment: 'test', role: 'reviewer', items: [], nextCursor: null, scope: 'uploaded_evidence', retention: 'until_operator_deletion' } }) })
  await page.goto('/app/archive')
  await page.getByLabel('Archive access token').fill('fixture-review-token')
  await page.getByRole('button', { name: 'Search project evidence' }).click()
  await expect(page.getByRole('heading', { name: 'project-a / test' })).toBeVisible()
  await expect(page.locator('.archive-result-summary')).toContainText('project-a')
  await expect(page.getByRole('heading', { name: 'Upload evidence' })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain('fixture-review-token')
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('missing timestamp configuration never appears ready and exact-call mobile preview stays within viewport', async ({ page }, testInfo) => {
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: { ...caps, workflowReady: false, dependencies: { ...caps.dependencies, timestamp: 'unavailable' } } }))
  await page.goto('/app/quickstart')
  await expect(page.getByText('Required configuration is missing', { exact: true })).toBeVisible()
  await expect(page.locator('.status').filter({ hasText: 'NEEDS CONFIGURATION' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify({ chainId: 8453, from: `0x${'a'.repeat(40)}`, to: `0x${'b'.repeat(40)}`, nonce: '7', value: '0', data: `0x${'ab'.repeat(500)}` }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('priorseal-exact-call-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})


test('combined review preserves original bytes and keeps unsupported attachments explicitly partial', async ({ page }, testInfo) => {
  const { bundle, profile } = await nativeFixture()
  const manifest = await buildReviewManifest({ bundle: bundle as Parameters<typeof buildReviewManifest>[0]['bundle'], attachments: [{ id: 'optional-note', role: 'partner.note', profile: 'partner.unknown.v1', rawJson: '{ "note": "not independently verified" }' }] })
  const raw = JSON.stringify(manifest, null, 4) + '\n'
  await page.goto('/app/verify')
  await page.getByLabel('Evidence JSON file').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(raw) })
  await page.getByText('Import a trust profile', { exact: true }).click()
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify(profile))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await page.getByLabel('I confirmed this issuer, audience and public key configuration through an independent trusted channel.').check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.getByRole('heading', { name: 'Combined evidence review' })).toBeVisible()
  await expect(page.locator('.verification-result')).toContainText('PARTIAL REVIEW')
  await expect(page.locator('.verification-result')).toContainText('UNSUPPORTED_VERIFIER_PROFILE')
  await expect(page.locator('.relationship-assessments > div').filter({ hasText: 'Cross-evidence relationships' })).toContainText('NOT ESTABLISHED')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export original bytes' }).click()
  const download = await downloaded
  expect(await readFile((await download.path())!, 'utf8')).toBe(raw)
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: testInfo.outputPath('priorseal-combined-review.png'), fullPage: true })
})

test('v5 combined review requires independent protocol trust and exposes exact snapshot scope', async ({ page }, testInfo) => {
  const { manifest, options } = await createJointReviewFixture()
  const key = options.trustedKeys
  const profile = { schema: 'priorseal.trust-profile.v1', name: 'Joint v5 review', issuer: key.issuer, audience: options.expectedAudience, keys: [key], source: 'Independent synthetic test fixture', confirmedAt: 0, insightKeyRegistry: options.insightKeyRegistry, insightProtocolTrust: options.insightProtocolTrust }
  await page.route('**/.well-known/priorseal-keys.json', route => route.fulfill({ json: { schema: 'priorseal.keys.v1', issuer: key.issuer, keys: [] } }))
  await page.goto('/app/verify')
  await page.getByLabel('Evidence JSON', { exact: true }).fill(JSON.stringify(manifest))
  await page.getByText('Import a trust profile', { exact: true }).click()
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify(profile))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await page.getByLabel('I confirmed this issuer, audience and public key configuration through an independent trusted channel.').check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result > .status')).toHaveText(/PARTIAL REVIEW$/)
  await expect(page.locator('.verification-result')).toContainText('INSIGHT_PROTOCOL_TRUST_REQUIRED')
  await page.getByText('Insight trust for a combined review', { exact: true }).click()
  const confirmed = page.getByLabel('I independently confirmed these Insight keys, registry bytes and consumer policy.')
  await expect(confirmed).not.toBeChecked()
  await confirmed.check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result > .status')).toHaveText('✓VALID')
  await expect(page.locator('.verification-result')).toContainText('SIGNED_PROFILE_VERIFIED')
  await expect(page.locator('.relationship-assessments')).toContainText('Cross-evidence relationships')
  await expect(page.locator('.relationship-assessments')).toContainText('MATCHED')
  await expect(page.locator('.verification-result').getByTitle(options.insightProtocolTrust.registrySnapshot.sha256, { exact: true })).toBeVisible()
  await expect(page.locator('.verification-result')).toContainText('signed-profile')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export review report' }).click()
  const download = await downloaded
  const report = JSON.parse(await readFile((await download.path())!, 'utf8')) as { complete: boolean; review: ReviewResult }
  expect(report.complete).toBe(true)
  expect(report.review.artifacts[2].protocol!.registrySnapshotSha256).toBe(options.insightProtocolTrust.registrySnapshot.sha256)
  expect(report.review.artifacts[2].protocol!.registrySnapshotByteLength).toBe(options.insightProtocolTrust.registrySnapshot.byteLength)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect.poll(() => page.locator('#console-navigation').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0)
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: testInfo.outputPath('priorseal-v5-protocol-review.png'), fullPage: true, animations: 'disabled' })
  const wrong = structuredClone(options.insightProtocolTrust)
  wrong.registrySnapshot.byteLength++
  await page.getByLabel('Independent Insight protocol trust', { exact: true }).fill(JSON.stringify(wrong))
  await expect(confirmed).not.toBeChecked()
  await expect(page.locator('.verification-result')).toHaveCount(0)
  await confirmed.check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result > .status')).toHaveText(/PARTIAL REVIEW$/)
  await expect(page.locator('.verification-result')).toContainText('REGISTRY_SNAPSHOT_MISMATCH')
})

test('combined review exposes a cross-evidence mismatch without upgrading external decision use', async ({ page }) => {
  const fixture = await createJointReviewFixture()
  const manifest = await buildReviewManifest({ bundle: fixture.bundle as Parameters<typeof buildReviewManifest>[0]['bundle'], attachments: fixture.attachments, expectedTxHash: `0x${'2'.repeat(64)}`, assembledAt: fixture.manifest.assembledAt })
  const key = fixture.options.trustedKeys
  const profile = { schema: 'priorseal.trust-profile.v1', name: 'Mismatch review', issuer: key.issuer, audience: fixture.options.expectedAudience, keys: [key], source: 'Independent synthetic test fixture', confirmedAt: 0, insightKeyRegistry: fixture.options.insightKeyRegistry, insightProtocolTrust: fixture.options.insightProtocolTrust }
  await page.route('**/.well-known/priorseal-keys.json', route => route.fulfill({ json: { schema: 'priorseal.keys.v1', issuer: key.issuer, keys: [] } }))
  await page.goto('/app/verify')
  await page.getByLabel('Evidence JSON', { exact: true }).fill(JSON.stringify(manifest))
  await page.getByText('Import a trust profile', { exact: true }).click()
  await page.getByLabel('Trust profile JSON', { exact: true }).fill(JSON.stringify(profile))
  await page.getByRole('button', { name: 'Import profile', exact: true }).click()
  await page.getByLabel('I confirmed this issuer, audience and public key configuration through an independent trusted channel.').check()
  await page.getByText('Insight trust for a combined review', { exact: true }).click()
  await page.getByLabel('I independently confirmed these Insight keys, registry bytes and consumer policy.').check()
  await page.getByRole('button', { name: 'Verify locally' }).click()
  await expect(page.locator('.verification-result')).toContainText('EVIDENCE_RELATION_MISMATCH')
  await expect(page.locator('.relationship-assessments > div').filter({ hasText: 'Cross-evidence relationships' })).toContainText('MISMATCH')
  await expect(page.locator('.relationship-assessments > div').filter({ hasText: 'External decision use' })).toContainText('NOT ESTABLISHED')
})

test('undetermined observation preserves reconciliation and never suggests another broadcast', async ({ page }) => {
  const authorizationId = 'auth_reconcile'
  const txHash = `0x${'9'.repeat(64)}`
  await page.addInitScript(({ authorizationId }) => {
    localStorage.setItem('priorseal.storage-preference.v1', JSON.stringify({ choice: 'granted', updatedAt: Date.now() }))
    const authorization = { authorizationId, intent: { intentId: 'intent_reconcile', chainId: 8453, action: 'TRANSFER', asset: 'native', amount: '1', sender: `0x${'2'.repeat(40)}`, recipient: `0x${'3'.repeat(40)}`, validUntil: 4_102_444_800, nonce: '1' }, principal: { type: 'user', id: 'user:reconcile', account: `0x${'1'.repeat(40)}` }, authorizer: { address: `0x${'1'.repeat(40)}` }, delegate: { agentId: 'fixture', executor: `0x${'2'.repeat(40)}` }, expiresAt: 4_102_444_800 }
    localStorage.setItem('priorseal.local-session.v4', JSON.stringify({ intents: [], authorizations: [{ authorization, acceptance: { acceptedAt: 1_800_000_000 } }], receipts: [], observations: [], observationJobs: [] }))
  }, { authorizationId })
  await page.route('**/v1/executions/observe', (route) => route.fulfill({ json: { observation: { chainId: 8453, txHash, status: 'RPC_TIMEOUT' }, receipt: null, observationJob: { jobId: 'job_reconcile', input: { authorizationId, txHash, chainId: 8453 }, state: 'UNDETERMINED', attempts: 5, nextAttemptAt: Date.now(), observation: { chainId: 8453, txHash, status: 'RPC_TIMEOUT' }, error: null } } }))
  await page.goto('/app/observe')
  await page.getByLabel('Transaction hash').fill(txHash)
  await expect(page.getByRole('button', { name: 'Observe authorized execution' })).toBeEnabled()
  await page.getByRole('button', { name: 'Observe authorized execution' }).click()
  await expect(page.getByText('Reconciliation required', { exact: true })).toBeVisible()
  await expect(page.getByText(/do not infer that the transaction failed or broadcast it again/)).toBeVisible()
  await expect(page.getByText('No automatic attempt scheduled', { exact: true })).toBeVisible()
})


test.describe('local authorization time', () => {
  test.use({ timezoneId: 'Asia/Shanghai' })
  test('default expiry remains one hour ahead in the user timezone', async ({ page }) => {
    await page.goto('/app/intents/exact-call')
    const input = page.getByLabel('Valid until')
    const remaining = await input.evaluate((element) => new Date((element as HTMLInputElement).value).getTime() - Date.now())
    expect(remaining).toBeGreaterThan(50 * 60_000)
    expect(remaining).toBeLessThan(70 * 60_000)
  })
})


test('complete archive export follows a single snapshot and contains every matching artifact', async ({ page }) => {
  const ids = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)]
  const items = ids.map((id) => ({ id, kind: 'verification-bundle', createdAt: 1_800_000_000, txHash: null, authorizationId: null, status: 'CONFIRMED', artifactHash: id, supersedesId: null }))
  const requestedCursors: string[] = []
  let limitedOnce = false
  await page.route(/\/v1\/archive(?:\/export)?\?/, async (route) => {
    const url = new URL(route.request().url())
    const cursor = url.searchParams.get('cursor') ?? ''
    const exporting = url.pathname.endsWith('/export')
    if (exporting) {
      requestedCursors.push(cursor)
      expect(url.searchParams.get('limit')).toBe('10')
      if (!limitedOnce) { limitedOnce = true; await route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { error: { message: 'Fixture rate limit' } } }); return }
    }
    await route.fulfill({ json: { schema: 'priorseal.archive-page.v1', projectId: 'project-a', environment: 'test', role: 'reviewer', items: (cursor ? items.slice(2) : items.slice(0, 2)).map((item) => exporting ? { ...item, artifact: { fixture: item.id } } : item), nextCursor: cursor ? null : 'fixture-cursor', snapshot: 3, scope: 'uploaded_evidence', retention: 'process_lifetime' } })
  })
  await page.route(/\/v1\/archive\/[123]{64}$/, async (route) => { const id = route.request().url().split('/').at(-1)!; await route.fulfill({ json: { ...items.find((item) => item.id === id), artifact: { fixture: id } } }) })
  await page.goto('/app/archive')
  await page.getByLabel('Archive access token').fill('fixture-token')
  await page.getByRole('button', { name: 'Search project evidence' }).click()
  await expect(page.getByText(/evidence is lost when this server process restarts/)).toBeVisible()
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all matches with artifacts' }).click()
  const download = await exported
  const report = JSON.parse(await readFile((await download.path())!, 'utf8')) as { complete: boolean; snapshot: number; entries: Array<{ artifact: { fixture: string } }> }
  expect(report.complete).toBe(true)
  expect(report.snapshot).toBe(3)
  expect(report.entries.map((entry) => entry.artifact.fixture)).toEqual(ids)
  expect(requestedCursors).toEqual(['', '', 'fixture-cursor'])
  expect(JSON.stringify(report)).not.toContain('fixture-token')
})

test('server typed-data substitution cannot reach the wallet signing request', async ({ page }) => {
  const account = privateKeyToAccount(`0x${'4'.repeat(64)}`)
  await page.addInitScript((address) => { window.__walletCalls = []; window.ethereum = { request: async ({ method }) => { window.__walletCalls.push(method); return [address] } } }, account.address)
  await page.route('**/v1/authorizations/prepare', async (route) => {
    const authorization = buildAuthorization({ ...route.request().postDataJSON(), policyHash: caps.policyHash })
    const typedData = authorizationTypedData(authorization)
    typedData.message.expiresAt += 1n
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authorization, typedData }, (_key, value) => typeof value === 'bigint' ? value.toString() : value) })
  })
  await page.goto('/app/intents/exact-call')
  await page.getByLabel('Transaction JSON', { exact: true }).fill(JSON.stringify({ chainId: 8453, from: `0x${'a'.repeat(40)}`, to: `0x${'b'.repeat(40)}`, nonce: '7', data: '0x' }))
  await page.getByRole('button', { name: 'Prepare canonical intent' }).click()
  await page.getByRole('button', { name: 'Confirm and sign authorization' }).click()
  await expect(page.getByText('Prepared authorization or wallet typed data is inconsistent', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__walletCalls)).toEqual(['eth_requestAccounts'])
})
