import { defineConfig } from '@playwright/test'
import { resolveDeviceEnv } from './tests/playwright/device/deviceEnv'

/**
 * Journeys on a REAL Android phone (tested on a Pixel 10 Pro, Android 16, Chrome) over wireless adb, see
 * tests/playwright/README.md, "Real device". Playwright launches no browser: the fixture forwards
 * the phone's DevTools socket with adb, connects over CDP and works in one new tab of the phone's
 * Chrome (tests/playwright/device/deviceConnection.ts). No web server is started; the phone opens
 * production (https://www.masterselects.com/m) or MASTERSELECTS_DEVICE_BASE_URL.
 *
 * Refuses to load without MASTERSELECTS_DEVICE=1, so no normal run ever touches a phone. The journey
 * files end in `.device.ts`, so the desktop and phone configs (`*.spec.ts`) never pick them up.
 */
const env = resolveDeviceEnv()
if (!env.enabled) {
  throw new Error('playwright.device.config.ts drives a real phone and runs only with MASTERSELECTS_DEVICE=1 '
    + '(see tests/playwright/README.md, "Real device").')
}

export default defineConfig({
  testDir: './tests/playwright/device',
  testMatch: '**/*.device.ts',
  outputDir: 'test-results/playwright-device/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    // Under test-results/ (gitignored) rather than a new playwright-report-* folder.
    ['html', { outputFolder: 'test-results/playwright-device/report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-device/junit.xml' }],
  ],
  use: {
    // Traces and videos are not recorded: a connected phone is not a launched browser, and the
    // screenshots of the page would carry the phone user's Chrome UI state. Failures attach their own
    // device screenshot and adb state (deviceFixture.ts).
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'real-device' }],
})
