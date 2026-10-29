import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { DeviceAdb } from './deviceAdb'
import { resolveDeviceEnv, type DeviceEnv } from './deviceEnv'
import { DeviceMediaServer } from './deviceMediaServer'
import { DEVICE_TAB_MARKER, PARKED_DEVICE_TAB_URL, deviceTabURL, hasDeviceTabMarker, planDeviceTabs } from './deviceParsing'
import { installActionTimeline, installProgressRecorder } from './deviceTelemetry'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PROJECT_LOADING_TEST_ID } from '../../../src/components/mobileSkin/runtime/phoneProjectLoadingTestIds'

/**
 * Connects to Chrome on the owner's phone over wireless adb and works in ONE TEST TAB of its own.
 *
 * - DevTools: `adb forward tcp:<port> localabstract:chrome_devtools_remote`, then
 *   `chromium.connectOverCDP`. The phone's default browser context is used, because a context
 *   Playwright creates on Android Chrome has no network.
 * - The test tab carries a marker: its URL fragment (`/m#masterselects-device-test`, see
 *   DEVICE_TAB_MARKER) plus window.name. A run reuses the marked tab (bring to front, boot /m again)
 *   and opens a new tab only when there is none, so runs never pile up editor tabs that share one
 *   project storage (a second harness tab once restored the previous run's project, Pixel run
 *   2026-10-28). A further marked editor tab is parked on about:blank#… (never closed).
 * - The owner's tabs are never touched: unmarked tabs are only read for their URL. The harness never
 *   navigates, reloads or closes them, and leaves its own tab open at the end (repository rule: never
 *   close tabs). Disconnecting closes only the DevTools connection.
 * - The phone must be unlocked before the run; the wake key keeps the screen on while connected.
 *   No device setting is changed.
 * - The test tab restores the phone's last project on /m (there is no way around the boot restore),
 *   and the journeys then create a new "Device test" project. If the owner has an (unmarked)
 *   MasterSelects tab open, both tabs would work on one project's storage, so the run refuses to
 *   start unless MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS=1.
 */
export interface DeviceSession {
  env: DeviceEnv
  adb: DeviceAdb
  browser: Browser
  context: BrowserContext
  page: Page
  server: DeviceMediaServer | null
  /** Unmarked pages that were open before the run (never used; only counted for the report). */
  foreignPages: number
  /** 'reused': the marked test tab of an earlier run; 'new': no marked tab existed. */
  tab: 'reused' | 'new'
  /** Older harness tabs moved to about:blank by this run. */
  parkedTabs: number
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
    const existing = context.pages()
    // The window.name check runs script in a tab, so it is only tried on tabs of the editor's own origin:
    // the owner's other tabs (mail, banking, messengers) are never evaluated.
    const editorOrigin = new URL(env.baseURL).origin
    const tabs = await Promise.all(existing.map(async item => ({ url: item.url(),
      marked: hasDeviceTabMarker(item.url()) || (originOf(item.url()) === editorOrigin && await isMarkedTestTab(item)) })))
    const plan = planDeviceTabs(tabs, env.baseURL)
    if (plan.ownerEditorPaths.length > 0 && !env.allowEditorTabs) {
      throw new Error(`The phone's Chrome has ${plan.ownerEditorPaths.length} MasterSelects tab(s) open that are not the harness's test tab (${plan.ownerEditorPaths.join(', ')}). `
        + 'The test tab restores the last project, and two tabs on one project compete for its storage. Close those tabs on the phone yourself, '
        + 'or set MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS=1 if they hold nothing that matters. The harness never closes or navigates them.')
    }
    for (const index of plan.park) {
      // A second marked editor tab left on /m would share project storage with the test tab: stop loudly.
      await existing[index].goto(PARKED_DEVICE_TAB_URL, { timeout: 30_000 }).catch((error: unknown) => {
        throw new Error(`Could not park an older harness test tab (${String(error).split('\n')[0]}); it would share project storage with this run.`)
      })
    }
    let page: Page
    if (plan.reuse !== null) {
      page = existing[plan.reuse]
    } else {
      page = await context.newPage()
      if (existing.includes(page)) throw new Error('newPage() returned an existing tab; refusing to use it')
    }
    await markTestTab(page)
    await page.bringToFront().catch(() => undefined)
    adb.startKeepAwake(env.keepAwakeMs)
    await installScreenWakeLock(page)
    await installProgressRecorder(page)
    await installActionTimeline(page, [PHONE_M1_TEST_IDS.home, PHONE_TEST_IDS.timeline, PHONE_PROJECT_LOADING_TEST_ID, PHONE_TEST_IDS.sheet, PHONE_TEST_IDS.clip])
    // A reused tab may already show /m#marker, where goto would only move the fragment: leave the
    // document first so every run measures a full boot.
    if (plan.reuse !== null) await page.goto(PARKED_DEVICE_TAB_URL, { timeout: 30_000 }).catch(() => undefined)
    const navigationStartedAt = Date.now()
    await page.goto(deviceTabURL(env.baseURL), { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await reportScreenWakeLock(page)
    return { env, adb, browser, context, page, server, foreignPages: tabs.filter(tab => !tab.marked).length,
      tab: plan.reuse !== null ? 'reused' : 'new', parkedTabs: plan.park.length, device: { model: device.model, android: device.android, sdk: device.sdk, chrome: device.chrome }, navigationStartedAt }
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

function originOf(url: string): string | null {
  try { return new URL(url).origin } catch { return null }
}

/** Second marker, window.name (an unresponsive or frozen tab counts as not marked). */
async function isMarkedTestTab(page: Page): Promise<boolean> {
  const check = page.evaluate((marker) => {
    let stored: string | null = null
    try { stored = sessionStorage.getItem(marker) } catch { /* storage blocked: window.name decides */ }
    return window.name === marker || stored === '1'
  }, DEVICE_TAB_MARKER).catch(() => false)
  return Promise.race([check, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5_000))])
}

/**
 * Sets the window.name marker now and on every later document of the tab (the URL fragment is the
 * main marker; the sessionStorage copy helps where Chrome restores it).
 */
async function markTestTab(page: Page): Promise<void> {
  const mark = (marker: string) => {
    window.name = marker
    try { sessionStorage.setItem(marker, '1') } catch { /* about:blank or blocked storage: window.name is enough */ }
  }
  await page.addInitScript(mark, DEVICE_TAB_MARKER)
  await page.evaluate(mark, DEVICE_TAB_MARKER).catch(() => undefined)
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
