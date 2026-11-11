import { expect, test } from '@playwright/test'

const baseUsdcPilotCapabilities = {
  schema: 'priorseal.capabilities.v1',
  issuer: 'fixture',
  audience: 'treasury-pilot',
  executionProfiles: ['priorseal.intent.v1'],
  chains: [8453],
  authorizers: ['eip712'],
  proofMode: 'rfc3161',
  policyHash: `0x${'0'.repeat(64)}`,
  minConfirmations: 12,
  dependencies: { issuer: 'configured', timestamp: 'configured', rpc: 'configured', storage: 'available' },
  workflowReady: true,
  chainReadiness: [{ chainId: 8453, rpc: 'configured' }],
  checkedAt: 1_800_000_000,
  archive: { enabled: false, retention: 'operator_defined', scope: 'project_uploaded_evidence' },
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('priorseal:treasury-pilot-storage-cleared')) {
      localStorage.clear()
      sessionStorage.setItem('priorseal:treasury-pilot-storage-cleared', 'true')
      localStorage.setItem('priorseal.storage-preference.v1', JSON.stringify({ choice: 'denied', updatedAt: Date.now() }))
    }
  })
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: baseUsdcPilotCapabilities }))
})

test('guides a configured Base USDC treasury path without implying payment execution', async ({ page }) => {
  await page.goto('/app/treasury-pilot')
  await expect(page.getByRole('heading', { name: 'One approved payment. One provable path.' })).toBeVisible()
  await expect(page.getByText('Base USDC pilot path is configured.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Independent pre-execution proof' })).toBeVisible()
  await expect(page.getByText('PriorSeal never broadcasts or signs the USDC payment.')).toBeVisible()

  await page.getByRole('link', { name: 'Start a Base USDC authorization' }).click()
  await expect(page).toHaveURL(/\/app\/actions\/standard\?template=base-usdc-treasury/)
  await expect(page.getByRole('heading', { name: 'Authorize a bounded Base USDC payment.' })).toBeVisible()
  await expect(page.getByLabel('Chain')).toHaveValue('Base (8453)')
  await expect(page.getByLabel('Chain')).toBeDisabled()
  await expect(page.getByLabel('Asset')).toHaveValue('eip155:8453/erc20:0x833589fcd6edbe08f4c7c32d4f71b54bda02913')
  await expect(page.getByLabel('Asset')).toBeDisabled()
})

test('refuses a Base USDC pilot authorization when only issuer acceptance is configured', async ({ page }) => {
  await page.route('**/v1/capabilities', (route) => route.fulfill({ json: { ...baseUsdcPilotCapabilities, proofMode: 'issuer', dependencies: { ...baseUsdcPilotCapabilities.dependencies, timestamp: 'not_required' } } }))
  await page.goto('/app/treasury-pilot')
  await expect(page.getByText('Witness proof is required')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review deployment requirements' })).toBeVisible()

  await page.goto('/app/actions/standard?template=base-usdc-treasury')
  await page.getByLabel('USDC amount').fill('1000000')
  await page.getByLabel('Transaction nonce').fill('17')
  await page.getByLabel('Agent execution wallet').fill(`0x${'a'.repeat(40)}`)
  await page.getByLabel('Authorized recipient').fill(`0x${'b'.repeat(40)}`)
  await page.getByRole('button', { name: 'Review Base USDC authorization' }).click()
  await expect(page.getByText('The Base USDC treasury pilot requires an independent Witness proof mode.')).toBeVisible()
})

test('carries an accepted treasury authorization into the Match step without changing its boundary', async ({ page }) => {
  const authorizationId = 'auth_base_usdc_pilot'
  const executor = `0x${'a'.repeat(40)}`
  const recipient = `0x${'b'.repeat(40)}`
  const record = {
    authorization: {
      authorizationId,
      intentHash: `0x${'1'.repeat(64)}`,
      expiresAt: 2_000_000_000,
      principal: { id: 'treasury:fixture' },
      authorizer: { address: executor },
      delegate: { executor },
      intent: { intentId: 'intent_base_usdc_pilot', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/erc20:0x833589fcd6edbe08f4c7c32d4f71b54bda02913', amount: '1000000', sender: executor, recipient, nonce: '17', validUntil: 2_000_000_000 },
    },
    acceptance: { acceptedAt: 1_800_000_000 },
    status: 'ACCEPTED',
    boundTxHash: null,
  }
  await page.goto('/')
  await page.evaluate((value) => {
    localStorage.setItem('priorseal.storage-preference.v1', JSON.stringify({ choice: 'granted', updatedAt: Date.now() }))
    localStorage.setItem('priorseal.local-session.v4', JSON.stringify({ intents: [value.authorization.intent], authorizations: [value], receipts: [], observations: [], observationJobs: [] }))
  }, record)
  await page.goto(`/app/observe?authorizationId=${authorizationId}&pilot=base-usdc-treasury`)
  await expect(page.getByLabel('Signed authorization')).toHaveValue(authorizationId)
  await expect(page.locator('[title="eip155:8453/erc20:0x833589fcd6edbe08f4c7c32d4f71b54bda02913"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Observe authorized execution' })).toBeEnabled()
})
