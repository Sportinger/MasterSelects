import { defineConfig } from '@playwright/test';

const host = process.env.MASTERSELECTS_E2E_BUILT_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.MASTERSELECTS_E2E_BUILT_PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid MASTERSELECTS_E2E_BUILT_PORT: ${process.env.MASTERSELECTS_E2E_BUILT_PORT}`);
}
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: '**/built-editor-shell.spec.ts',
  outputDir: 'test-results/playwright-built/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-built-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-built/junit.xml' }],
  ],
  use: {
    acceptDownloads: true,
    baseURL,
    channel: process.env.MASTERSELECTS_E2E_BROWSER_CHANNEL?.trim() || 'chrome',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ['--window-size=1920,1080'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chrome-headed-built-smoke' }],
  webServer: {
    command: `npm run preview -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
