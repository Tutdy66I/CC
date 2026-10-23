import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-cloud',
  outputDir: 'test-results/cloud',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177/CC/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'cloud-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'cloud-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'cloud-webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node scripts/cloud-e2e-server.mjs',
    url: 'http://127.0.0.1:4177/CC/',
    reuseExistingServer: false,
    timeout: 60000,
  },
})
