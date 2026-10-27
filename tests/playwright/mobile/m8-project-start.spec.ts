import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { PHONE_M1_TEST_IDS as HOME, PHONE_TEST_IDS as IDS } from '../../../src/components/mobileSkin/contracts'
import { PHONE_HOME_TEST_IDS } from '../../../src/components/mobileSkin/home/phoneHomeTestIds'
import { PHONE_PROJECT_TEST_IDS as PROJ } from '../../../src/components/mobileSkin/project/phoneProjectTestIds'
import { PHONE_PROJECT_LOADING_TEST_ID as LOADING } from '../../../src/components/mobileSkin/runtime/phoneProjectLoadingTestIds'
import { PHONE_SETTINGS_TEST_IDS as SETTINGS } from '../../../src/components/mobileSkin/settings/phoneSettingsTestIds'
import { warmGpu } from '../fixtures/frameCodeProject'
import { installDeterministicStorage } from './phoneFixture'

/**
 * M8 project start of the phone editor (owner decisions 2026-10-27):
 * - New project never asks for a folder, even in a browser that has showDirectoryPicker (Android
 *   Chrome): the project lands in browser storage.
 * - An opaque loading view names the project and the step while it creates or opens, then resolves.
 * - Reopening works from the phone home, also for a folder project whose access the browser asks
 *   for again after a restart (opaque "Reopen … allow folder access" card, no overlay on the editor).
 * - Settings > Diagnostics lists the recent project loads as seconds per phase.
 */
test.describe.configure({ mode: 'serial', timeout: 240_000 })

interface LoadingSighting { step: string; kind: string; title: string; background: string }

/** Pickers exist (as on Android Chrome) but only count their calls; a folder pick returns `window.__e2ePickFolder`. */
async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>
    win.__e2ePickerCalls = 0
    win.showDirectoryPicker = async () => {
      win.__e2ePickerCalls = (win.__e2ePickerCalls as number) + 1
      const name = win.__e2ePickFolder
      if (typeof name !== 'string') throw new DOMException('The user aborted a request.', 'AbortError')
      return (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    }
    win.showSaveFilePicker = async () => {
      win.__e2ePickerCalls = (win.__e2ePickerCalls as number) + 1
      throw new DOMException('The user aborted a request.', 'AbortError')
    }
    // A browser restart: folder access asks again until the person allows it (localStorage flag).
    const proto = (globalThis as unknown as { FileSystemHandle?: { prototype: Record<string, unknown> } }).FileSystemHandle?.prototype
    if (proto) {
      const query = proto.queryPermission as ((this: unknown, d?: unknown) => Promise<PermissionState>) | undefined
      proto.queryPermission = function (this: unknown, descriptor?: unknown) {
        if (localStorage.getItem('e2e-folder-prompt') === '1') return Promise.resolve('prompt')
        return query ? query.call(this, descriptor) : Promise.resolve('granted')
      }
      // The browser prompt stays open until the test answers it (window.__e2eAllowFolder()).
      proto.requestPermission = function () {
        win.__e2ePermissionRequests = ((win.__e2ePermissionRequests as number | undefined) ?? 0) + 1
        return new Promise<PermissionState>((resolve) => {
          win.__e2eAllowFolder = () => { localStorage.removeItem('e2e-folder-prompt'); resolve('granted') }
        })
      }
    }
    // Records every appearance of the loading view, however short.
    const sightings: LoadingSighting[] = []
    win.__e2eLoadingSightings = sightings
    const seen = new WeakSet<Element>()
    const record = () => {
      const view = document.querySelector('[data-testid="phone-project-loading"]')
      if (!view || seen.has(view)) return
      seen.add(view)
      sightings.push({
        step: view.getAttribute('data-step') ?? '', kind: view.getAttribute('data-kind') ?? '',
        title: view.querySelector('h1')?.textContent ?? '', background: getComputedStyle(view).backgroundColor,
      })
    }
    new MutationObserver(record).observe(document, { childList: true, subtree: true })
  })
}

async function newPhone(browser: import('@playwright/test').Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page; baseURL: string }> {
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Phone project with baseURL and viewport required')
  const context = await browser.newContext({ viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: use.userAgent })
  const page = await context.newPage()
  await warmGpu(page, use.baseURL)
  await installDeterministicStorage(page, randomUUID())
  await installPickers(page)
  return { context, page, baseURL: use.baseURL }
}

async function sightings(page: Page): Promise<LoadingSighting[]> {
  return page.evaluate(() => (window as unknown as { __e2eLoadingSightings: LoadingSighting[] }).__e2eLoadingSightings)
}

async function pickerCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __e2ePickerCalls: number }).__e2ePickerCalls)
}

/** The loading view appeared for `kind`, named `name`, was opaque, and is gone again. */
async function expectLoadingResolved(page: Page, kind: string, name: string, seen: number): Promise<void> {
  await expect.poll(async () => (await sightings(page)).slice(seen).find(entry => entry.kind === kind)?.title ?? null,
    { timeout: 30_000, message: `the loading view appeared for ${kind}` }).toContain(name)
  const sighting = (await sightings(page)).slice(seen).find(entry => entry.kind === kind)!
  expect(sighting.background, 'the loading view is opaque').toMatch(/^rgb\(/)
  await expect(page.getByTestId(LOADING), 'the loading view resolved').toHaveCount(0, { timeout: 60_000 })
}

/** Writes a screenshot only when PHONE_VISUAL_SWEEP_DIR is set. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.PHONE_VISUAL_SWEEP_DIR
  if (!dir) return
  await page.screenshot({ path: path.join(dir, testInfo.project.name, `p4-${name}.png`) })
}

async function createViaHome(page: Page, name: string): Promise<void> {
  const create = page.getByTestId(HOME.createProject)
  if (!await create.isVisible()) await page.getByTestId(HOME.newProject).tap()
  await page.getByTestId(HOME.projectNameInput).fill(name)
  await create.tap()
  await expect(page.getByTestId(IDS.timeline), 'the new project opens in the editor').toBeVisible({ timeout: 60_000 })
}

async function backToProjects(page: Page): Promise<void> {
  await page.getByTestId(IDS.projectName).tap()
  await expect(page.getByTestId(PROJ.tools)).toBeVisible()
  await page.getByRole('button', { name: 'Back to projects' }).tap()
  await expect(page.getByTestId(HOME.home), 'back on the phone home').toBeVisible({ timeout: 60_000 })
}

test('M8/project-start: create without a folder dialog, opaque loading view, reopen from the home, diagnostics lists the loads @phone', async ({ browser }, testInfo) => {
  const { context, page, baseURL } = await newPhone(browser, testInfo)
  try {
    await page.goto(new URL('/m', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(HOME.home), 'the phone home appears on a fresh /m').toBeVisible({ timeout: 90_000 })
    expect(await page.evaluate(() => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker), 'this browser has a folder picker').toBe('function')
    await expect(page.getByTestId(PHONE_HOME_TEST_IDS.openFolder), 'Open a project folder is offered as the secondary action').toBeVisible()
    await expect(page.getByTestId(LOADING), 'the background scratch open does not cover the home').toHaveCount(0)

    // Create: no picker call, the project lives in browser storage, the loading view names it.
    const name = `Start ${randomUUID().slice(0, 6)}`
    let seen = (await sightings(page)).length
    await createViaHome(page, name)
    await expectLoadingResolved(page, 'create', name, seen)
    expect(await pickerCalls(page), 'New project asked for no folder').toBe(0)
    await expect.poll(() => page.evaluate(() => {
      const list = (globalThis as { __MS_PROJECT_LOAD__?: Array<{ kind: string; outcome: string; storage: string }> }).__MS_PROJECT_LOAD__ ?? []
      return list.find(entry => entry.kind === 'create' && entry.outcome === 'ready')?.storage ?? null
    }), { timeout: 30_000, message: 'the create reported its storage' }).toMatch(/^(opfs|indexeddb)$/)

    // Reopen from the home: the project row opens it behind the loading view.
    await backToProjects(page)
    seen = (await sightings(page)).length
    await page.getByTestId(HOME.projectRow).filter({ hasText: name }).first().tap()
    await expect(page.getByTestId(IDS.timeline), 'the project opens again').toBeVisible({ timeout: 60_000 })
    await expectLoadingResolved(page, 'open', name, seen)
    await expect(page.getByTestId(IDS.projectName)).toContainText(name)
    expect(await pickerCalls(page), 'reopening a browser project asked for no folder').toBe(0)

    // Diagnostics: the create and the open are listed as seconds per phase.
    await page.getByTestId(IDS.projectName).tap()
    await page.getByTestId(PROJ.openSettings).tap()
    await expect(page.getByTestId(SETTINGS.diagnostics)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(SETTINGS.autoMobileLayout), 'the compact layout toggle is hidden while the legacy Mobile layout is off').toHaveCount(0)
    await page.getByTestId(SETTINGS.diagnostics).tap()
    const loads = page.getByTestId(SETTINGS.recentLoads)
    await expect(loads).toBeVisible({ timeout: 15_000 })
    await loads.scrollIntoViewIfNeeded()
    await shot(page, testInfo, 'diagnostics-recent-loads')
    const rows = page.getByTestId(SETTINGS.recentLoad)
    await expect(rows.filter({ hasText: 'Create' }).first(), 'the create is listed').toBeVisible()
    await expect(rows.filter({ hasText: 'Open' }).first(), 'the open is listed').toBeVisible()
    await expect(rows.first(), 'phases are in seconds').toContainText(/\d+\.\d{1,2} s/)
  } finally {
    await context.close()
  }
})

test('M8/project-start: a folder project that needs access again is reopened from an opaque home card, never an overlay @phone', async ({ browser }, testInfo) => {
  const { context, page, baseURL } = await newPhone(browser, testInfo)
  try {
    await page.goto(new URL('/m', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(HOME.home)).toBeVisible({ timeout: 90_000 })

    // Setup: a project, then opened through "Open a project folder" so it is a folder project.
    const name = `Folder ${randomUUID().slice(0, 6)}`
    await createViaHome(page, name)
    await backToProjects(page)
    await page.evaluate((folder) => { (window as unknown as Record<string, unknown>).__e2ePickFolder = folder }, name)
    let seen = (await sightings(page)).length
    await page.getByTestId(PHONE_HOME_TEST_IDS.openFolder).tap()
    await expect(page.getByTestId(IDS.timeline), 'the folder project opens').toBeVisible({ timeout: 60_000 })
    await expectLoadingResolved(page, 'folder', '', seen)
    await expect(page.getByTestId(IDS.projectName)).toContainText(name)

    // A browser restart: the folder asks for access again.
    await page.evaluate(() => localStorage.setItem('e2e-folder-prompt', '1'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    const card = page.getByTestId(PHONE_HOME_TEST_IDS.resumeCard)
    await expect(card, 'the home offers to reopen the folder project').toBeVisible({ timeout: 90_000 })
    await expect(card).toHaveAttribute('data-project-name', name)
    await expect(page.getByRole('heading', { name: 'Choose project' }), 'no desktop chooser over the editor').toHaveCount(0)

    await expect(page.getByTestId(LOADING), 'nothing covers the reopen card (a background scratch open stays out of sight)').toHaveCount(0)
    await shot(page, testInfo, 'home-resume-card')

    // While the browser prompt is open, the opaque loading view says so and, after 5 s, the elapsed time.
    seen = (await sightings(page)).length
    await page.getByTestId(PHONE_HOME_TEST_IDS.resume).tap()
    const loading = page.getByTestId(LOADING)
    await expect(loading).toBeVisible({ timeout: 15_000 })
    await expect(loading).toHaveAttribute('data-step', 'waiting')
    await expect(loading).toContainText(name)
    await expect(page.getByTestId(`${LOADING}-elapsed`), 'the elapsed time shows after 5 s').toHaveText(/^\d+ s$/, { timeout: 10_000 })
    await shot(page, testInfo, 'loading-waiting-for-access')
    await page.evaluate(() => (window as unknown as { __e2eAllowFolder: () => void }).__e2eAllowFolder())
    await expect(page.getByTestId(IDS.timeline), 'the folder project reopens').toBeVisible({ timeout: 90_000 })
    await expectLoadingResolved(page, 'resume', name, seen)
    expect(await page.evaluate(() => (window as unknown as { __e2ePermissionRequests?: number }).__e2ePermissionRequests ?? 0), 'folder access was asked once').toBeGreaterThan(0)
    await expect(card).toHaveCount(0)
  } finally {
    await context.close()
  }
})
