import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { baseURL: 'http://localhost:5191', headless: true, channel: 'chromium', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'npm run dev -- --port 5191 --strictPort', url: 'http://localhost:5191', reuseExistingServer: false },
});
