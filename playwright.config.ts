import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  // Linux and macOS rasterize the bundled web fonts differently. Keep local review strict while allowing only the stable CI renderer delta.
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: process.env.CI ? 0.06 : 0.015 } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' },
  }],
  webServer: {
    command: 'npm run preview:web',
    url: 'http://127.0.0.1:4173/health/live',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
