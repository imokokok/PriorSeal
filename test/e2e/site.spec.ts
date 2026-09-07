import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('priorseal:test-storage-cleared')) {
      localStorage.clear()
      sessionStorage.setItem('priorseal:test-storage-cleared', 'true')
    }
  })
})

test('asks for the real local-storage choice without setting cookies', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByRole('dialog', { name: 'Keep evidence on this device?' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Use without saving' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Allow local saving' })).toBeVisible()
  expect(await page.evaluate(() => document.cookie)).toBe('')
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v4'))).toBeNull()

  await panel.getByRole('button', { name: 'Use without saving' }).click()
  await expect(panel).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.storage-preference.v1') ?? '{}').choice)).toBe('denied')
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v4'))).toBeNull()
  await page.reload()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'Privacy & storage' }).click()
  await expect(page.getByRole('dialog', { name: 'Your storage choice' })).toBeVisible()
  await page.getByRole('button', { name: 'Allow local saving' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.storage-preference.v1') ?? '{}').choice)).toBe('granted')
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v4'))).not.toBeNull()

  await page.getByRole('button', { name: 'Privacy & storage' }).click()
  await page.getByRole('button', { name: 'Delete saved local evidence' }).click()
  await page.getByRole('button', { name: 'Delete evidence' }).click()
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v4'))).toBeNull()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.storage-preference.v1') ?? '{}').choice)).toBe('granted')

  await page.getByRole('link', { name: 'Read privacy and storage details' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy in plain language' })).toBeFocused()
})

test('preserves the console shell, resets scroll and moves focus on navigation', async ({ page }) => {
  let healthRequests = 0
  page.on('request', (request) => { if (request.url().endsWith('/health/live')) healthRequests += 1 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Use without saving' }).click()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.locator('.museum-closing a[href="/app"]').click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('.api-state')).toContainText('online')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.locator('.shell').evaluate((element) => { (window as Window & { __priorsealShell?: Element }).__priorsealShell = element })

  await page.getByRole('link', { name: 'Quickstart' }).click()
  await expect(page).toHaveURL(/\/app\/quickstart$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Create your first execution proof.' })).toBeFocused()
  expect(await page.locator('.shell').evaluate((element) => (window as Window & { __priorsealShell?: Element }).__priorsealShell === element)).toBe(true)
  expect(healthRequests).toBe(1)
})

test('mobile navigation traps focus, closes with Escape and does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app')
  await page.getByRole('button', { name: 'Use without saving' }).click()
  const menu = page.getByRole('button', { name: 'Open navigation' })
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#console-navigation')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('reduced-motion preference disables route and reveal animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Use without saving' }).click()
  const duration = await page.locator('.museum-hero__copy').evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(['0.01ms', '1e-05s']).toContain(duration)
})

test('persists and resumes a pending observation until a receipt is issued', async ({ page }) => {
  const authorizationId = 'auth_pending_test'
  const txHash = `0x${'1'.repeat(64)}`
  const execution = { chainId: 8453, txHash, status: 'PENDING', confirmations: 0, finalityState: 'PENDING', observedAt: 1_700_000_000 }
  const authorization = {
    schema: 'priorseal.authorization.v2', domain: 'priorseal.authorization', authorizationId,
    intent: { intentId: 'intent_pending_test', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: `0x${'2'.repeat(40)}`, recipient: `0x${'3'.repeat(40)}`, validUntil: 4_102_444_800, nonce: '1' },
    intentHash: `0x${'4'.repeat(64)}`, principal: { type: 'user', id: 'user:test', account: `0x${'5'.repeat(40)}` },
    authorizer: { type: 'eip712', address: `0x${'5'.repeat(40)}` }, delegate: { agentId: 'agent:test', executor: `0x${'2'.repeat(40)}` },
    issuedAt: 1_700_000_000, notBefore: 1_700_000_000, expiresAt: 4_102_444_800, authorizationNonce: `0x${'6'.repeat(64)}`, maxUses: '1', audience: 'priorseal.test', policyHash: `0x${'7'.repeat(64)}`, signature: '0xtest',
  }
  const receipt = { schema: 'priorseal.execution-receipt.v2', domain: 'priorseal.execution-receipt', receiptId: 'psr_pending_completed', intentHash: authorization.intentHash, executionHash: `0x${'8'.repeat(64)}`, execution: { ...execution, status: 'CONFIRMED', confirmations: 12, finalityState: 'CONFIRMED' }, issuer: 'priorseal.test', issuedAt: 1_700_000_100, validUntil: 4_102_444_800, outcome: 'COMPLETED', reasonCodes: [], binding: { bound: true, reasonCodes: [] }, algorithm: 'Ed25519', keyId: 'test-1', verifierVersion: 'test', signature: 'test' }

  await page.goto('/')
  await page.getByRole('button', { name: 'Allow local saving' }).click()
  await page.evaluate(({ authorization }) => localStorage.setItem('priorseal.local-session.v4', JSON.stringify({ intents: [authorization.intent], authorizations: [{ authorization, acceptance: { acceptedAt: 1_700_000_000 } }], receipts: [], observations: [], observationJobs: [] })), { authorization })

  let complete = false
  await page.route('**/v1/executions/observe', async (route) => route.fulfill({ json: { observation: execution, receipt: null, observationJob: { jobId: 'job-pending-test', input: { authorizationId, chainId: 8453, txHash, confirmations: 12 }, state: 'QUEUED', attempts: 0, createdAt: 1_700_000_000_000, nextAttemptAt: 1_700_000_001_000, observation: execution, result: null, error: null } } }))
  await page.route('**/v1/observation-jobs/job-pending-test', async (route) => route.fulfill({ json: complete
    ? { jobId: 'job-pending-test', input: { authorizationId, chainId: 8453, txHash, confirmations: 12 }, state: 'COMPLETED', attempts: 2, createdAt: 1_700_000_000_000, nextAttemptAt: 1_700_000_002_000, observation: receipt.execution, result: { observation: receipt.execution, receipt }, error: null }
    : { jobId: 'job-pending-test', input: { authorizationId, chainId: 8453, txHash, confirmations: 12 }, state: 'RETRY_WAIT', attempts: 1, createdAt: 1_700_000_000_000, nextAttemptAt: Date.now() + 1_000, observation: execution, result: null, error: null } }))

  await page.goto('/app/observe')
  await page.getByLabel('Transaction hash').fill(txHash)
  await page.getByRole('button', { name: 'Observe authorized execution' }).click()
  await expect(page.getByText('Observation continues in the background', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.local-session.v4') ?? '{}').observationJobs?.[0]?.jobId)).toBe('job-pending-test')

  complete = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Open receipt detail' })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.local-session.v4') ?? '{}').receipts?.[0]?.receiptId)).toBe('psr_pending_completed')
})

test('does not mark a pending observation as a completed quickstart step', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow local saving' }).click()
  await page.evaluate(() => localStorage.setItem('priorseal.local-session.v4', JSON.stringify({ intents: [], authorizations: [], receipts: [], observations: [{ chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'PENDING' }], observationJobs: [] })))
  await page.goto('/app/quickstart')
  const observeStep = page.locator('.onboarding-steps li').filter({ hasText: 'Observe one transaction' })
  await expect(observeStep.locator('.step-number')).toHaveText('2')
})

test('key product views match reviewed visual baselines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Keep evidence on this device?' })).toHaveScreenshot('privacy-choice-mobile.png')
  await page.getByRole('button', { name: 'Use without saving' }).click()
  await expect(page).toHaveScreenshot('landing-mobile.png')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/app')
  await expect(page.locator('.api-state')).toContainText('online')
  await expect(page).toHaveScreenshot('console-overview.png')
})
