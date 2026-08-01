import { defineConfig } from '@playwright/test'
import { moduleGrepForGate } from './tests/playwright/config/moduleGates'
import { resolveRuntimeProfile } from './tests/playwright/config/runtimeProfile'

const runtime = resolveRuntimeProfile()
const bridgeTokenFile = process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE?.trim()
  || `test-results/playwright/.ai-bridge-token-${runtime.port}`
const gateGrep = runtime.activeGate === 'all'
  ? undefined
  : moduleGrepForGate(runtime.activeGate)

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/built-editor-shell.spec.ts',
  outputDir: 'test-results/playwright/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  grep: gateGrep,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright/junit.xml' }],
  ],
  use: {
    acceptDownloads: true,
    baseURL: runtime.baseURL,
    channel: runtime.browserChannel,
    headless: runtime.headless,
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      args: ['--window-size=1920,1080'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome-headed-dev',
    },
  ],
  webServer: runtime.startWebServer
    ? {
        command: `npm run dev -- --host ${runtime.host} --port ${runtime.port} --strictPort`,
        url: runtime.baseURL,
        env: {
          MASTERSELECTS_E2E_FREEZE_SOURCE: '1',
          MASTERSELECTS_BRIDGE_TOKEN_FILE: bridgeTokenFile,
        },
        reuseExistingServer: runtime.reuseExistingServer,
        timeout: 120_000,
      }
    : undefined,
})
