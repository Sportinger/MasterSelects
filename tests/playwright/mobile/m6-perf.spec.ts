import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS, phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { installDeterministicStorage } from './phoneFixture'
import {
  addFrameCodeClips, bootMarks, widenResourceBuffer, createPhoneProject, openPerfContext, readLongTasks, scriptBytes,
} from './m6PerfFixture'

/**
 * M6 performance of the phone skin (packet N5) on the phone profiles. Each case boots its own
 * fresh page (a boot cannot be measured on the shared Sammeltest page). The budgets are generous
 * (the suite runs on the Vite dev server with unbundled modules and a software-ish GPU) but real:
 * a regression that doubles a number shows. Every number is attached to the result as `n5-perf`.
 *
 * Budgets, dev server:
 * - /m home interactive (navigation start to a usable home): BOOT_HOME_MS;
 * - stored project reopened, timeline visible: BOOT_TIMELINE_MS; first preview frame: FIRST_FRAME_MS;
 * - JS loaded by /m stays below JS_RATIO of what the desktop /editor loads;
 * - while playing, only the running time re-renders every frame (render probe).
 */
test.describe.configure({ timeout: 240_000 })

const BOOT_HOME_MS = 12_000
const BOOT_TIMELINE_MS = 15_000
const FIRST_FRAME_MS = 20_000
const WORST_LONG_TASK_MS = 1_500
const JS_RATIO = 0.9

function note(testInfo: TestInfo, values: Record<string, unknown>): void {
  testInfo.annotations.push({ type: 'n5-perf', description: `${testInfo.project.name} ${JSON.stringify(values)}` })
  console.log(`[n5-perf] ${testInfo.project.name} ${testInfo.title.split(':')[0]} ${JSON.stringify(values)}`)
}

/** ms since navigation start once the home shows its create command. */
async function homeInteractiveAt(page: Page): Promise<number> {
  const handle = await page.waitForFunction((ids) => {
    const home = document.querySelector(`[data-testid="${ids.home}"]`)
    const command = document.querySelector(`[data-testid="${ids.newProject}"], [data-testid="${ids.createProject}"]`)
    return home && command && command.getClientRects().length > 0 ? performance.now() : false
  }, { home: PHONE_M1_TEST_IDS.home, newProject: PHONE_M1_TEST_IDS.newProject, createProject: PHONE_M1_TEST_IDS.createProject }, { timeout: 90_000, polling: 'raf' })
  return Math.round(await handle.jsonValue() as number)
}

test('N5/perf-boot-home: a fresh /m reaches an interactive home within budget, without long blocking tasks @phone', async ({ browser }, testInfo) => {
  const world = await openPerfContext(browser, testInfo)
  try {
    const { page } = world
    await page.goto(new URL('/m', world.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const homeAt = await homeInteractiveAt(page)
    // Interactive, not just painted: the create form answers a tap.
    const create = page.getByTestId(PHONE_M1_TEST_IDS.createProject)
    if (!await create.isVisible()) await page.getByTestId(PHONE_M1_TEST_IDS.newProject).tap()
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.projectNameInput)).toBeEditable()
    const tasks = await readLongTasks(page)
    note(testInfo, { homeAt, ...tasks })
    expect(homeAt, 'the phone home took too long to become interactive').toBeLessThan(BOOT_HOME_MS)
    expect(tasks.worstMs, 'one task blocked the main thread too long during the boot').toBeLessThan(WORST_LONG_TASK_MS)
  } finally {
    await world.context.close()
  }
})

test('N5/perf-reopen-project: a stored project reopens, the timeline and the first preview frame arrive within budget @phone', async ({ browser }, testInfo) => {
  const world = await openPerfContext(browser, testInfo)
  try {
    const { page } = world
    await page.goto(new URL('/m', world.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toBeVisible({ timeout: 90_000 })
    await createPhoneProject(page, `Perf ${randomUUID().slice(0, 8)}`)
    await addFrameCodeClips(world)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(PHONE_TEST_IDS.clip).first(), 'the stored project did not reopen').toBeVisible({ timeout: 90_000 })
    await expect.poll(async () => Boolean((await bootMarks(page))['first-preview-frame']), { timeout: 90_000, message: 'no first preview frame after the reopen' }).toBe(true)
    const marks = await bootMarks(page)
    const tasks = await readLongTasks(page)
    note(testInfo, { ...marks, ...tasks })
    expect(marks['stores-hydrated'], 'the project was not hydrated').toBeGreaterThan(0)
    expect(marks['timeline-visible'], 'timeline visible too late').toBeLessThan(BOOT_TIMELINE_MS)
    expect(marks['first-preview-frame'], 'first preview frame too late').toBeLessThan(FIRST_FRAME_MS)
    expect(marks['timeline-visible'], 'the timeline must not wait for the GPU').toBeLessThanOrEqual(marks['first-preview-frame'])
    expect(tasks.worstMs).toBeLessThan(WORST_LONG_TASK_MS)
  } finally {
    await world.context.close()
  }
})

test('N5/perf-js-bytes: /m loads clearly less JavaScript than the desktop /editor @phone', async ({ browser }, testInfo) => {
  const phone = await openPerfContext(browser, testInfo)
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await phone.page.goto(new URL('/m', phone.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await homeInteractiveAt(phone.page)
    await phone.page.waitForLoadState('networkidle', { timeout: 60_000 })
    const phoneJs = await scriptBytes(phone.page)

    const page = await desktop.newPage()
    await installDeterministicStorage(page, randomUUID())
    await widenResourceBuffer(page)
    await page.goto(new URL('/editor', phone.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page, 'a desktop browser must stay on /editor').toHaveURL(/\/editor/)
    await expect(page.getByRole('button', { name: 'Mobile mode' }), 'the desktop editor did not load').toBeVisible({ timeout: 90_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
    const editorJs = await scriptBytes(page)

    note(testInfo, { phoneKB: Math.round(phoneJs.bytes / 1024), phoneFiles: phoneJs.files, editorKB: Math.round(editorJs.bytes / 1024), editorFiles: editorJs.files })
    expect(phoneJs.bytes, 'no script bytes were measured for /m').toBeGreaterThan(0)
    expect(phoneJs.bytes, '/m loads nearly as much JS as the desktop editor').toBeLessThan(editorJs.bytes * JS_RATIO)
    // The landscape editors (and the desktop dock panels inside them) are not part of the home boot.
    const loaded = await phone.page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(entry => new URL(entry.name).pathname))
    expect(loaded.filter(path => /mobileSkin\/workspace\/PhoneWorkspace\.tsx|components\/dock\/DockPanelContent/.test(path)), 'landscape editor code loaded at boot').toEqual([])
  } finally {
    await desktop.close()
    await phone.context.close()
  }
})

test('N5/boot-gpu-late: home, project, timeline and sheets work while the GPU is still starting @phone', async ({ browser }, testInfo) => {
  const world = await openPerfContext(browser, testInfo, { gateGpu: true })
  const { page } = world
  const gpuRequests = () => page.evaluate(() => (window as unknown as { __n5GpuRequests?: number }).__n5GpuRequests ?? 0)
  const release = () => page.evaluate(() => (window as unknown as { __n5ReleaseGpu?: () => void }).__n5ReleaseGpu?.())
  try {
    await page.goto(new URL('/m', world.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home), 'the home waited for the GPU').toBeVisible({ timeout: 90_000 })
    await expect.poll(gpuRequests, { message: 'the engine never asked for a GPU adapter' }).toBeGreaterThan(0)
    await createPhoneProject(page, `Late GPU ${randomUUID().slice(0, 8)}`)
    expect((await bootMarks(page))['gpu-ready'], 'the GPU must still be starting').toBeUndefined()
    await release()
    await expect.poll(async () => (await bootMarks(page))['gpu-ready'], { timeout: 60_000, message: 'the engine did not finish after the GPU was released' }).toBeGreaterThan(0)
    await addFrameCodeClips(world)

    // Reopen with the GPU held again: the stored project and its timeline come first.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(PHONE_TEST_IDS.clip).first(), 'the stored project waited for the GPU').toBeVisible({ timeout: 60_000 })
    await expect.poll(gpuRequests).toBeGreaterThan(0)
    let marks = await bootMarks(page)
    expect(marks['timeline-visible'], 'timeline-visible mark missing').toBeGreaterThan(0)
    expect(marks['gpu-ready'], 'the GPU must still be starting while the timeline is used').toBeUndefined()
    await expect(page.getByTestId(PHONE_TEST_IDS.previewRegion)).toBeVisible()

    // Usable while starting: a clip selects, a sheet opens and closes, the home opens and returns.
    const clip = page.getByTestId(PHONE_TEST_IDS.clip).first()
    await clip.tap()
    await expect(clip).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('phone-toolbar-back').tap()
    await expect(page.getByTestId(PHONE_TEST_IDS.toolbar)).toHaveAttribute('data-scope', 'root')
    await page.getByTestId(phoneActionTestId('format')).tap()
    await expect(page.getByTestId(PHONE_TEST_IDS.sheet)).toBeVisible()
    await page.getByTestId(PHONE_TEST_IDS.sheetCancel).tap()
    await expect(page.getByTestId(PHONE_TEST_IDS.sheet)).toHaveCount(0)
    await page.getByTestId('phone-topbar-projects').tap()
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toBeVisible()
    await page.getByRole('button', { name: 'Back to editing' }).tap()
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toHaveCount(0)
    expect((await bootMarks(page))['gpu-ready'], 'the GPU finished on its own; the gate did not hold').toBeUndefined()

    await release()
    await expect.poll(async () => (await bootMarks(page))['first-preview-frame'], { timeout: 60_000, message: 'no preview frame after the GPU came up' }).toBeGreaterThan(0)
    marks = await bootMarks(page)
    note(testInfo, marks)
    expect(marks['timeline-visible']).toBeLessThan(marks['gpu-ready'])
  } finally {
    await release().catch(() => undefined)
    await world.context.close()
  }
})

test('N5/perf-playback-renders: while playing only the running time re-renders every frame @phone', async ({ browser }, testInfo) => {
  const world = await openPerfContext(browser, testInfo, { renderProbe: true })
  const { page } = world
  try {
    await page.goto(new URL('/m', world.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home)).toBeVisible({ timeout: 90_000 })
    await createPhoneProject(page, `Renders ${randomUUID().slice(0, 8)}`)
    await addFrameCodeClips(world)
    await expect.poll(async () => (await bootMarks(page))['first-preview-frame'], { timeout: 60_000 }).toBeGreaterThan(0)

    await page.evaluate(() => { const probe = (window as unknown as { __n5Renders: { armed: boolean; commits: number; counts: Record<string, number> } }).__n5Renders; probe.commits = 0; for (const key of Object.keys(probe.counts)) delete probe.counts[key]; probe.armed = true })
    await page.getByTestId(PHONE_TEST_IDS.play).tap()
    await expect(page.getByTestId(PHONE_TEST_IDS.play)).toHaveAttribute('data-playing', 'true')
    // Two seconds of playback, read from the running time (a condition, not a sleep).
    await page.waitForFunction((id) => {
      const text = document.querySelector(`[data-testid="${id}"] .phone-transport__now`)?.textContent ?? ''
      const match = text.match(/(\d+):(\d+)\./)
      return match ? Number(match[1]) * 60 + Number(match[2]) >= 2 : false
    }, PHONE_TEST_IDS.time, { timeout: 30_000 })
    const result = await page.evaluate(() => { const probe = (window as unknown as { __n5Renders: { armed: boolean; commits: number; counts: Record<string, number> } }).__n5Renders; probe.armed = false; return { commits: probe.commits, counts: { ...probe.counts } } })
    await page.getByTestId(PHONE_TEST_IDS.play).tap()
    const pick = (name: string) => result.counts[name] ?? 0
    const watched = ['PhoneTransportTime', 'PhoneTransport', 'PhoneContextToolbar', 'PhoneTopBar', 'PhoneTimeline', 'PhoneClipStrip', 'PhoneClipTile', 'PhonePreview', 'PhoneShell']
    note(testInfo, { commits: result.commits, ...Object.fromEntries(watched.map(name => [name, pick(name)])) })
    expect(pick('PhoneTransportTime'), 'the render probe saw no running-time renders (probe broken?)').toBeGreaterThan(20)
    expect(pick('PhoneTransport'), 'the whole transport re-renders while playing').toBeLessThanOrEqual(4)
    expect(pick('PhoneTopBar')).toBeLessThanOrEqual(4)
    expect(pick('PhoneShell')).toBeLessThanOrEqual(2)
    expect(pick('PhoneContextToolbar'), 'the toolbar re-renders while playing').toBeLessThanOrEqual(10)
    expect(pick('PhoneTimeline'), 'the timeline re-renders too often while playing').toBeLessThanOrEqual(20)
    expect(pick('PhoneClipTile'), 'clip tiles re-render too often while playing').toBeLessThanOrEqual(60)
  } finally {
    await world.context.close()
  }
})
