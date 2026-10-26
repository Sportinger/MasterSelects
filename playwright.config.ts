import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { moduleGrepForGate } from './tests/playwright/config/moduleGates'
import { chromeLaunchArgs, resolveRuntimeProfile } from './tests/playwright/config/runtimeProfile'

const runtime = resolveRuntimeProfile()
const bridgeTokenFile = process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE?.trim()
  || `test-results/playwright/.ai-bridge-token-${runtime.port}`
const gateGrep = runtime.activeGate === 'all'
  ? undefined
  : moduleGrepForGate(runtime.activeGate)

export default defineConfig({
  testDir: './tests/playwright',
  globalSetup: fileURLToPath(new URL('./tests/playwright/config/warmDevServer.ts', import.meta.url)),
  testMatch: '**/*.spec.ts',
  // `nightly/` holds long journeys (large exports, long sources). They stay out of
  // every other run, including the auto-repair acceptance, which resets grep but
  // keeps testIgnore; run them with `npm run test:e2e:nightly`.
  testIgnore: [
    '**/built-editor-shell.spec.ts',
    '**/beta/**',
    ...(runtime.includeNightly ? [] : ['**/nightly/**']),
  ],
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
      args: chromeLaunchArgs(process.platform, runtime.headless),
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
