import { defineConfig, devices } from '@playwright/test'

const liveUrl = process.env.PAGES_URL

export default defineConfig({
  testDir: './e2e-pages',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: liveUrl || 'http://127.0.0.1:4176/CC/',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pages-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pages-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: liveUrl
    ? undefined
    : {
        command:
          'npm run preview -- --host 127.0.0.1 --port 4176 --strictPort --base=/CC/',
        url: 'http://127.0.0.1:4176/CC/',
        reuseExistingServer: false,
      },
})
