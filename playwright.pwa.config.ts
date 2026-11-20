import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa', timeout: 60000, workers: 1,
  use: { baseURL: 'http://localhost:4173', headless: true, channel: 'chromium', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'node scripts/serve-https.mjs --http-test --port 4173', url: 'http://localhost:4173', reuseExistingServer: false },
});
