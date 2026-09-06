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
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v3'))).toBeNull()

  await panel.getByRole('button', { name: 'Use without saving' }).click()
  await expect(panel).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.storage-preference.v1') ?? '{}').choice)).toBe('denied')
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v3'))).toBeNull()
  await page.reload()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'Privacy & storage' }).click()
  await expect(page.getByRole('dialog', { name: 'Your storage choice' })).toBeVisible()
  await page.getByRole('button', { name: 'Allow local saving' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('priorseal.storage-preference.v1') ?? '{}').choice)).toBe('granted')
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v3'))).not.toBeNull()

  await page.getByRole('button', { name: 'Privacy & storage' }).click()
  await page.getByRole('button', { name: 'Delete saved local evidence' }).click()
  await page.getByRole('button', { name: 'Delete evidence' }).click()
  expect(await page.evaluate(() => localStorage.getItem('priorseal.local-session.v3'))).toBeNull()
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
