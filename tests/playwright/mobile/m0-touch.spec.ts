import { chromium } from '@playwright/test'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import {
  IDS, FPS, clipRowPoint, expect, expectedFrameAt, settledTimeline, signatureOf, test, visibleCentre,
  type PhoneSession,
} from './phoneFixture'
import { readPreviewFrame, startLongTaskRecording, stopLongTaskRecording } from './phoneTouch'
import { chromeLaunchArgs, resolveRuntimeProfile } from '../config/runtimeProfile'

/**
 * M0 "Touch-Spike" acceptance of the phone skin (PLAN.md section 5), one case
 * per test in one shared Sammeltest project (phoneFixture.ts). Pattern as in
 * foundation/preview-truth.spec.ts: the preview's real pixels are the truth
 * (frame code), conditions are awaited and never slept on, the action under
 * test is real touch input through DevTools (phoneTouch.ts), and every case
 * resets what it depends on first. A real product defect stays visible as
 * `test.fail(true, '<defect>')`, never as a weaker oracle.
 */
test.describe.configure({ timeout: 120_000 })

const SPLIT = phoneActionTestId('split')

/** The frame code under the fixed playhead must be the one the clips say for the playhead's time. */
async function expectPreviewMatchesTime(phone: PhoneSession, time: number, clips: Awaited<ReturnType<PhoneSession['timeline']>>['clips']) {
  const expected = expectedFrameAt(clips, time)
  expect(expected, `the playhead time ${time.toFixed(4)} s lies outside every clip`).not.toBeNull()
  phone.probe.mark()
  await phone.probe.waitForFrame(expected!.frame, { allowed: () => true, timeoutMs: 10_000 })
  for (let read = 0; read < 3; read++) {
    expect((await readPreviewFrame(phone.probe)).frame, `preview frame while the playhead rests at ${time.toFixed(4)} s. ${phone.probe.summary()}`).toBe(expected!.frame)
  }
  return expected!
}

async function playheadX(phone: PhoneSession): Promise<number> {
  const box = await phone.playhead.boundingBox()
  if (!box) throw new Error('the playhead marker is not rendered')
  return box.x + box.width / 2
}

test('/m shows top bar, preview, transport, timeline and toolbar and no desktop dock chrome @phone', async ({ phone }) => {
  const { page } = phone
  const strips = [IDS.topBar, IDS.previewRegion, IDS.transport, IDS.timeline, IDS.toolbar]
  const boxes = []
  for (const id of strips) {
    const strip = page.getByTestId(id)
    await expect(strip, `strip ${id} is not visible`).toBeVisible()
    const box = await strip.boundingBox()
    expect(box, `strip ${id} has no box`).not.toBeNull()
    boxes.push({ id, ...box! })
  }
  const viewport = page.viewportSize()!
  // Five strips, top to bottom, inside the screen.
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index].y, `${boxes[index].id} must start below ${boxes[index - 1].id}`).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height - 1)
  }
  for (const box of boxes) {
    expect(box.x, `${box.id} left edge`).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width, `${box.id} right edge`).toBeLessThanOrEqual(viewport.width + 1)
  }
  expect(boxes.at(-1)!.y + boxes.at(-1)!.height, 'toolbar bottom edge').toBeLessThanOrEqual(viewport.height + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page scrolls horizontally').toBe(true)
  await expect(page.getByTestId(IDS.previewCanvas)).toBeVisible()
  await expect(page.getByTestId(IDS.play)).toBeVisible()
  await expect(page.getByTestId(IDS.time)).toContainText(/\d/)
  await expect(phone.playhead).toBeVisible()
  await expect(phone.clips.first()).toBeVisible()
  // No desktop chrome: not the editor layout, no dock, no desktop toolbar.
  for (const selector of ['.app--editor-layout', '.dock-root', '.dock-guided-resize-corner']) {
    await expect(page.locator(selector), `desktop chrome ${selector} is present on /m`).toHaveCount(0)
  }
  // Touch targets of the controls a thumb must hit: at least 44 x 44 CSS px.
  const small: string[] = []
  for (const control of [page.getByTestId(IDS.play), page.getByTestId(IDS.undo), page.getByTestId(IDS.redo), ...await phone.toolbar.getByRole('button').all()]) {
    const box = await control.boundingBox()
    if (box && (box.width < 43.5 || box.height < 43.5)) small.push(`${await control.getAttribute('data-testid') ?? await control.getAttribute('aria-label')} ${Math.round(box.width)}x${Math.round(box.height)}`)
  }
  expect(small, 'touch targets under 44 px').toEqual([])
})

test('panning the timeline moves time and the preview shows the frame code of the frame under the fixed playhead @phone', async ({ phone }) => {
  const { touch, page } = phone
  const start = await clipRowPoint(phone)
  const x0 = await playheadX(phone)
  const surface = (await phone.surface.boundingBox())!
  expect(Math.abs(x0 - (surface.x + surface.width / 2)), 'the playhead is not at the centre of the timeline surface').toBeLessThanOrEqual(8)
  const timeBefore = await page.getByTestId(IDS.time).innerText()

  let last = (await phone.timeline()).playhead
  // Content follows the finger: dragging left moves time forward, dragging right moves it back.
  for (const dx of [-120, -150, 90, -60]) {
    await touch.pan(start, { x: dx, y: 0 })
    const state = await settledTimeline(phone)
    expect(Math.sign(state.playhead - last), `a pan by ${dx} px moved time from ${last.toFixed(3)} to ${state.playhead.toFixed(3)} s`).toBe(Math.sign(-dx))
    last = state.playhead
    expect(Math.abs(await playheadX(phone) - x0), `the playhead marker moved after the pan by ${dx} px`).toBeLessThanOrEqual(0.5)
    await expectPreviewMatchesTime(phone, state.playhead, state.clips)
    expect(state.selectedIds, 'releasing a pan that started on a clip selected it (click-through)').toEqual([])
  }
  expect(await page.getByTestId(IDS.time).innerText(), 'the time display did not change').not.toBe(timeBefore)
})

test('pinch zoom changes the clip tile widths and the frame under the playhead stays the same @phone', async ({ phone }) => {
  const { touch } = phone
  const centre = await clipRowPoint(phone)
  await touch.pan(centre, { x: -120, y: 0 })
  const before = await settledTimeline(phone)
  const underPlayhead = await expectPreviewMatchesTime(phone, before.playhead, before.clips)
  const tile = phone.clip(underPlayhead.clip.id)
  const widthBefore = (await tile.boundingBox())!.width

  await touch.pinch(centre, 80, 240)
  const zoomedIn = await settledTimeline(phone)
  const widthIn = (await tile.boundingBox())!.width
  expect(widthIn / widthBefore, `spreading two fingers 3x apart changed the tile from ${widthBefore.toFixed(0)} to ${widthIn.toFixed(0)} px`).toBeGreaterThan(1.5)
  expect(Math.abs(zoomedIn.playhead - before.playhead), 'zooming moved the time under the playhead').toBeLessThan(0.5 / FPS)
  expect((await expectPreviewMatchesTime(phone, zoomedIn.playhead, zoomedIn.clips)).frame).toBe(underPlayhead.frame)

  await touch.pinch(centre, 240, 80)
  const zoomedOut = await settledTimeline(phone)
  const widthOut = (await tile.boundingBox())!.width
  expect(widthOut / widthIn, `pinching in changed the tile from ${widthIn.toFixed(0)} to ${widthOut.toFixed(0)} px`).toBeLessThan(0.7)
  expect(Math.abs(zoomedOut.playhead - before.playhead), 'pinching in moved the time under the playhead').toBeLessThan(0.5 / FPS)
  expect((await expectPreviewMatchesTime(phone, zoomedOut.playhead, zoomedOut.clips)).frame).toBe(underPlayhead.frame)
  expect(zoomedOut.selectedIds, 'a pinch selected a clip').toEqual([])
})

test('a tap on a clip selects it and switches the toolbar to the clip scope, a tap on empty space deselects @phone', async ({ phone }) => {
  const { touch } = phone
  const { clips } = await phone.timeline()
  const first = clips[0]
  const tile = phone.clip(first.id)
  await expect(phone.toolbar).toHaveAttribute('data-scope', 'root')
  await expect(phone.toolbar.getByTestId(SPLIT)).toHaveCount(0)

  await touch.tap(await visibleCentre(tile, phone.surface))
  await expect(tile).toHaveAttribute('aria-selected', 'true')
  await expect(phone.page.locator(`[data-testid="${IDS.clip}"][aria-selected="true"]`), 'exactly one tile is marked selected').toHaveCount(1)
  await expect(phone.toolbar).toHaveAttribute('data-scope', 'clip')
  await expect(phone.toolbar.getByTestId(SPLIT)).toBeVisible()
  expect((await phone.timeline()).selectedIds, 'the store selection must be the tapped clip').toEqual([first.id])

  // Before the clip starts (time < 0) the surface is empty: left of the centre playhead at t = 0.
  const surface = (await phone.surface.boundingBox())!
  const row = await clipRowPoint(phone)
  await touch.tap({ x: surface.x + surface.width * 0.15, y: row.y })
  await expect(tile).toHaveAttribute('aria-selected', 'false')
  await expect(phone.toolbar).toHaveAttribute('data-scope', 'root')
  expect((await phone.timeline()).selectedIds).toEqual([])
})

test('split at the playhead makes two clips with continuous boundary frames and undo restores one clip @phone', async ({ phone }) => {
  const { touch, bridge } = phone
  const base = await phone.timeline()
  const target = base.clips[0]
  // Arrangement: put the playhead exactly on frame 50 of the first clip, so the cut is on a frame boundary.
  const cutFrame = 50
  const cutTime = target.start + cutFrame / FPS
  await bridge.toolData('setPlayhead', { time: cutTime })
  await expect.poll(async () => (await phone.timeline()).playhead).toBeCloseTo(cutTime, 6)
  await phone.probe.waitForFrame(cutFrame, { allowed: () => true })

  await touch.tap(await visibleCentre(phone.clip(target.id), phone.surface))
  await expect(phone.clip(target.id)).toHaveAttribute('aria-selected', 'true')
  const split = phone.toolbar.getByTestId(SPLIT)
  await expect(split, 'Split must be available with the playhead inside the selected clip').not.toHaveAttribute('aria-disabled', 'true')
  await touch.tap(await visibleCentre(split, phone.page.locator('body')))

  await expect.poll(async () => (await phone.timeline()).clips.length, { message: 'Split did not create a second clip' }).toBe(base.clips.length + 1)
  const after = await phone.timeline()
  const [left, right] = after.clips
  expect(left.start, 'left part starts where the original started').toBeCloseTo(target.start, 4)
  expect(left.duration, 'left part ends at the playhead').toBeCloseTo(cutFrame / FPS, 4)
  expect(right.start, 'right part starts at the cut').toBeCloseTo(cutTime, 4)
  expect(right.start + right.duration, 'right part ends where the original ended').toBeCloseTo(target.start + target.duration, 4)
  expect(right.inPoint, 'right part continues the source at the cut').toBeCloseTo(cutFrame / FPS, 4)
  // The phone timeline renders only clips near the viewport, so check the two parts' tiles, not a total count.
  await expect(phone.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${left.id}"]`), 'left part has a tile').toHaveCount(1)
  await expect(phone.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${right.id}"]`), 'right part has a tile').toHaveCount(1)

  // Frame N on the left of the cut, frame N + 1 on the right: no frame lost or repeated.
  await bridge.toolData('setPlayhead', { time: cutTime - 1 / FPS })
  await phone.probe.waitForFrame(cutFrame - 1, { allowed: () => true })
  await bridge.toolData('setPlayhead', { time: cutTime })
  await phone.probe.waitForFrame(cutFrame, { allowed: () => true })
  await bridge.toolData('setPlayhead', { time: cutTime + 1 / FPS })
  await phone.probe.waitForFrame(cutFrame + 1, { allowed: () => true })

  await touch.tap(await visibleCentre(phone.page.getByTestId(IDS.undo), phone.page.locator('body')))
  await expect.poll(async () => signatureOf((await phone.timeline()).clips), { message: 'Undo did not restore the one original clip' }).toBe(signatureOf(base.clips))
  await expect(phone.page.locator(`[data-testid="${IDS.clip}"][data-clip-id="${right.id}"]`), 'the right part tile is gone after undo').toHaveCount(0)
})

test('a greyed action stays visible and tapping it shows the reason notice @phone', async ({ phone }) => {
  const { touch, page } = phone
  const greyed = phone.toolbar.locator('[aria-disabled="true"]').first()
  await expect(greyed, 'the root toolbar must show later-milestone tools greyed out, not hide them').toBeVisible()
  const traits = await greyed.evaluate(element => ({ nativeDisabled: (element as HTMLButtonElement).disabled === true, tabIndex: (element as HTMLElement).tabIndex, label: element.textContent?.trim() ?? '' }))
  expect(traits.nativeDisabled, 'a greyed action must stay focusable (aria-disabled), not natively disabled').toBe(false)
  expect(traits.tabIndex).toBeGreaterThanOrEqual(0)
  expect(traits.label, 'a greyed action keeps its label').not.toBe('')
  await expect(page.getByTestId(IDS.unavailableNotice)).toHaveCount(0)
  await touch.tap(await visibleCentre(greyed, page.locator('body')))
  const notice = page.getByTestId(IDS.unavailableNotice)
  await expect(notice, 'tapping a greyed action must explain why').toBeVisible()
  expect((await notice.innerText()).trim().length, 'the notice carries a reason text').toBeGreaterThan(10)
  await expect(greyed, 'the greyed action is still there after the notice').toBeVisible()
})

// Soft by default: a headless Linux Chrome without a GPU (software rasteriser, shared desktop) runs main
// thread work slower than a phone would, so the 50 ms limit is only measured and reported there. Set
// MASTERSELECTS_PHONE_PERF=strict on a host with a real GPU to fail on any long task.
const PERF_STRICT = process.env.MASTERSELECTS_PHONE_PERF === 'strict'

test('panning across about 20 clips causes no long task over 50 ms @phone', async ({ phone }, testInfo) => {
  const { touch, page } = phone
  const { clips } = await phone.timeline()
  expect(clips.length, 'the Sammeltest project must hold about 20 clips').toBeGreaterThanOrEqual(20)
  const lastStart = clips.at(-1)!.start
  const surface = (await phone.surface.boundingBox())!
  const row = await clipRowPoint(phone)
  const from = { x: surface.x + surface.width - 24, y: row.y }
  const distance = -(surface.width - 48)

  await startLongTaskRecording(page)
  let swipes = 0, position = 0
  while (position < lastStart && swipes < 20) {
    await touch.pan(from, { x: distance, y: 0 }, { steps: 20 })
    position = (await phone.timeline()).playhead
    swipes++
  }
  const report = await stopLongTaskRecording(page)
  const summary = { project: testInfo.project.name, clips: clips.length, swipes, reachedSeconds: Number(position.toFixed(2)), ...report }
  await testInfo.attach('scroll-performance.json', { body: JSON.stringify(summary, null, 1), contentType: 'application/json' })
  console.log(`scroll performance ${JSON.stringify(summary)}`)

  expect(position, `the pan never reached the last clip (${swipes} swipes)`).toBeGreaterThanOrEqual(lastStart)
  expect(report.supported, 'this Chrome has no long-task observer; the measurement is void').toBe(true)
  expect(report.frames, 'the frame recorder saw no animation frame').toBeGreaterThan(10)
  if (report.count > 0) {
    testInfo.annotations.push({ type: PERF_STRICT ? 'perf-failure' : 'perf-soft', description: `${report.count} long tasks, worst ${report.worstMs} ms, worst frame gap ${report.worstFrameGapMs} ms` })
  }
  if (PERF_STRICT) expect(report.tasksMs, `long tasks while panning over ${clips.length} clips`).toEqual([])
})

test('regression: /editor still boots the desktop layout in a desktop-sized context @phone', async ({ browserName: _browserName }, testInfo) => {
  // Its own desktop context (mouse, 1920x1080): the phone page of the Sammeltest stays untouched.
  const runtime = resolveRuntimeProfile()
  const baseURL = testInfo.project.use.baseURL
  if (!baseURL) throw new Error('Playwright baseURL must be configured')
  const browser = await chromium.launch({ channel: runtime.browserChannel, headless: runtime.headless, args: chromeLaunchArgs(process.platform, runtime.headless) })
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await context.newPage()
    await page.goto(new URL('/editor', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.app--editor-layout'), '/editor lost the desktop layout').toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId(IDS.root), 'the phone skin leaked into /editor').toHaveCount(0)
    await expect(page.locator(`.mobile-skin`)).toHaveCount(0)
  } finally {
    await browser.close()
  }
})

