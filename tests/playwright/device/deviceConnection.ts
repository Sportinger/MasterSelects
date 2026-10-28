import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { DeviceAdb } from './deviceAdb'
import { resolveDeviceEnv, type DeviceEnv } from './deviceEnv'
import { DeviceMediaServer } from './deviceMediaServer'
import { editorTabPaths } from './deviceParsing'
import { installProgressRecorder } from './deviceTelemetry'

/**
 * Connects to Chrome on the owner's phone over wireless adb and opens ONE NEW TAB for the run.
 *
 * - DevTools: `adb forward tcp:<port> localabstract:chrome_devtools_remote`, then
 *   `chromium.connectOverCDP`. The phone's default browser context is used, because a context
 *   Playwright creates on Android Chrome has no network.
 * - The owner's tabs are never touched: the harness records which pages existed, opens its own tab
 *   with `newPage()` and works only there. It never navigates, reloads or closes another tab, and
 *   leaves its own tab open at the end (repository rule: never close tabs). Disconnecting closes
 *   only the DevTools connection.
 * - The phone must be unlocked before the run; the wake key keeps the screen on while connected.
 *   No device setting is changed.
 * - The new tab restores the phone's last project on /m (there is no way around the boot restore),
 *   and the journeys then create a new "Device test" project. If the owner already has a
 *   MasterSelects tab open, both tabs would work on one project's storage, so the run refuses to
 *   start (reading the tab URLs only) unless MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS=1.
 */
export interface DeviceSession {
  env: DeviceEnv
  adb: DeviceAdb
  browser: Browser
  context: BrowserContext
  page: Page
  server: DeviceMediaServer | null
  /** Pages that were open before the run (never used; only counted for the report). */
  foreignPages: number
  device: { model: string; android: string; sdk: string; chrome: string }
  /** Date.now() right before the first navigation to /m. */
  navigationStartedAt: number
}

export async function connectDevice(env: DeviceEnv = resolveDeviceEnv()): Promise<DeviceSession> {
  if (!env.enabled) throw new Error('Real-device runs need MASTERSELECTS_DEVICE=1 (see tests/playwright/README.md, "Real device").')
  const adb = await DeviceAdb.connect(env)
  let server: DeviceMediaServer | null = null
  let browser: Browser | null = null
  try {
    await adb.assertUnlocked()
    await adb.forwardDevTools(env.cdpPort)
    for (const port of env.reversePorts) await adb.reverse(port)
    if (env.transport !== 'route') {
      server = new DeviceMediaServer(env.mediaPort)
      await server.start()
      await adb.reverse(env.mediaPort)
    }
    const device = await adb.describe()
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.cdpPort}`, { timeout: 30_000 })
    } catch (error) {
      throw new Error(`Could not reach Chrome's DevTools on the phone through tcp:${env.cdpPort}: ${(error as Error).message.split('\n')[0]}. `
        + 'Open Chrome on the phone once (it must be running) and keep USB/wireless debugging enabled.')
    }
    const context = browser.contexts()[0]
    if (!context) throw new Error('Chrome on the phone exposes no default browser context')
    const existing = new Set(context.pages())
    const editorTabs = editorTabPaths([...existing].map(item => item.url()), env.baseURL)
    if (editorTabs.length > 0 && !env.allowEditorTabs) {
      throw new Error(`The phone's Chrome already has ${editorTabs.length} MasterSelects tab(s) open (${editorTabs.join(', ')}). `
        + 'The test tab restores the last project, and two tabs on one project compete for its storage. Close those tabs on the phone yourself, '
        + 'or set MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS=1 if they hold nothing that matters. The harness never closes or navigates them.')
    }
    const page = await context.newPage()
    if (existing.has(page)) throw new Error('newPage() returned an existing tab; refusing to use it')
    await page.bringToFront().catch(() => undefined)
    adb.startKeepAwake(env.keepAwakeMs)
    await installScreenWakeLock(page)
    await installProgressRecorder(page)
    const navigationStartedAt = Date.now()
    await page.goto(`${env.baseURL}/m`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await reportScreenWakeLock(page)
    return { env, adb, browser, context, page, server, foreignPages: existing.size, device: { model: device.model, android: device.android, sdk: device.sdk, chrome: device.chrome }, navigationStartedAt }
  } catch (error) {
    adb.stopKeepAwake()
    await browser?.close().catch(() => undefined)
    await server?.stop().catch(() => undefined)
    await adb.release().catch(() => undefined)
    throw error
  }
}

/**
 * Ends the run: stops the keep-awake loop, removes the port mappings this run added, stops the media
 * server and disconnects DevTools. The test tab stays open on the phone.
 */
export async function disconnectDevice(session: DeviceSession): Promise<void> {
  session.adb.stopKeepAwake()
  // For a browser reached with connectOverCDP, close() closes the DevTools connection only; the
  // phone's Chrome, its default context and every tab (ours included) stay as they are.
  await session.browser.close().catch(() => undefined)
  await session.server?.stop().catch(() => undefined)
  await session.adb.release().catch(() => undefined)
}

/**
 * KEYCODE_WAKEUP does nothing on an awake screen, so it cannot reset the screen-off timer: an idle phone
 * dims, locks mid-run and freezes the hidden tab (first Pixel run, 2026-10-28). The test tab holds a
 * Screen Wake Lock instead. No device setting changes; Chrome releases it when the tab is hidden or closed,
 * and it is requested again whenever the tab becomes visible.
 */
async function installScreenWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as Window & { __msDeviceWakeLock?: string }
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      if (!('wakeLock' in navigator)) { state.__msDeviceWakeLock = 'unsupported'; return }
      navigator.wakeLock.request('screen').then((lock) => {
        state.__msDeviceWakeLock = 'held'
        lock.addEventListener('release', () => { state.__msDeviceWakeLock = 'released' })
      }, (error: unknown) => { state.__msDeviceWakeLock = `refused: ${String(error)}` })
    }
    document.addEventListener('visibilitychange', acquire)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', acquire, { once: true })
    else acquire()
  })
}

async function reportScreenWakeLock(page: Page): Promise<void> {
  const state = await page.waitForFunction(() => (window as Window & { __msDeviceWakeLock?: string }).__msDeviceWakeLock ?? null,
    undefined, { timeout: 5_000 }).then(handle => handle.jsonValue(), () => null)
  if (state !== 'held') {
    process.stdout.write(`[device] screen wake lock not held (${state ?? 'no answer'}); the phone may lock during the run.\n`)
  }
}
