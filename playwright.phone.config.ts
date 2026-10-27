import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { chromeLaunchArgs, resolveRuntimeProfile } from './tests/playwright/config/runtimeProfile'

/**
 * Phone journeys for the /m skin. Same runtime profile (host, port, channel,
 * headless) and Linux GPU launch flags as the desktop suite; one worker.
 *
 * Both projects run in Chromium. 'pixel-7' is a Pixel 7 emulation (viewport,
 * pixel ratio, mobile user agent, touch). 'iphone-viewport' is ONLY a viewport
 * and touch emulation of an iPhone-sized screen in Chromium: it is not Safari
 * and proves nothing about WebKit; genuine Safari stays a real-device gate.
 * The fixture reads the device settings from the project's `use` block and
 * builds its own context from them (tests/playwright/mobile/phoneFixture.ts).
 */
const runtime = resolveRuntimeProfile()
const bridgeTokenFile = process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE?.trim()
  || `test-results/playwright/.ai-bridge-token-${runtime.port}`

// No Android user agent: the engine applies its Linux/Mesa presentation path only when the
// user agent does not say Android (src/engine/core/WebGPUContext.ts). Spoofing Android on a
// Linux test host switches that path off and the WebGPU preview stays black, although the
// real phone needs no such path. Viewport, pixel ratio and touch are what the skin reacts to.

export default defineConfig({
  testDir: './tests/playwright/mobile',
  globalSetup: fileURLToPath(new URL('./tests/playwright/mobile/warmPhoneServer.ts', import.meta.url)),
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/playwright-phone/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-phone', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-phone/junit.xml' }],
  ],
  use: {
    acceptDownloads: true,
    baseURL: runtime.baseURL,
    channel: runtime.browserChannel,
    headless: runtime.headless,
    launchOptions: { args: chromeLaunchArgs(process.platform, runtime.headless) },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'pixel-7',
      use: {
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      // Viewport/touch emulation of an iPhone-sized screen, running in Chromium (not Safari).
      name: 'iphone-viewport',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
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
