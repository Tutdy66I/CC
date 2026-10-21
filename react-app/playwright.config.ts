import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run test:e2e:server',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30000,
    // Never inherit real provider credentials into the test server.
    env: { AI_API_KEY: '', AI_BASE_URL: '', AI_MODEL: '', PORT: '4175' },
  },
})
