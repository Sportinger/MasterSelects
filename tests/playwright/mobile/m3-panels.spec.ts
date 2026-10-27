import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { PHONE_HOME_TEST_IDS } from '../../../src/components/mobileSkin/home/phoneHomeTestIds'
import { PHONE_PANELS } from '../../../src/components/mobileSkin/panels/phonePanelCatalog'
import { PHONE_PANELS_TEST_IDS as PANELS } from '../../../src/components/mobileSkin/panels/phonePanelsTestIds'
import { PHONE_PREVIEW_TEST_IDS as PREVIEW } from '../../../src/components/mobileSkin/preview/phonePreviewMode'
import { PHONE_SPEED_TEST_IDS as SPEED } from '../../../src/components/mobileSkin/speed/phoneSpeedTestIds'
import {
  PHONE_TRANSITION_TEST_IDS as TRANSITION, phoneTransitionCategoryTestId, phoneTransitionChoiceTestId,
} from '../../../src/components/mobileSkin/transition/phoneTransitionTestIds'
import {
  expect, IDS, importViaSheet, M1_IDS, seek, tapAction, tapClip, tapOn, test, TOPBAR_PROJECTS, type M1Session,
} from './m1Fixture'
import { clipSnapshot, importClipA, openClipSheet, regionMean, REGIONS, stablePixels, tapCancel, tapDone, tapUndo, waitForPixels, waitForSettledHistory } from './m2DesignFixture'
import { checkPanelGroup, entry, host, openAllTools } from './m3PanelsFixture'
import { readPreviewFrame } from './phoneTouch'

/**
 * M3 "Profi-Blätter", packet All tools and desktop panels (PLAN.md section 5): the All tools sheet
 * reaches everything the phone has (toolbar actions, pro sheets, the fullscreen preview, every desktop
 * panel; landscape panels open their landscape editor), each sheet-presented desktop panel opens on the phone
 * with content, no sideways overflow, vertical scrolling, finger-sized controls and no page errors; a
 * real edit through the Properties panel lands in the timeline and one Undo restores it; the former
 * "(M3)" rows of the M2 sheets now open their panel or phone control; and the fullscreen preview.
 * Shared M1 world (fresh empty 1080x1920 composition per test), real touch, the bridge only arranges
 * and inspects, the preview's pixels are the truth where a picture changes.
 */
test.describe.configure({ timeout: 240_000 })

interface ClipDetails {
  duration: number; startTime: number; speed: number
  opacity?: number; transform?: { opacity?: number }
  transitionOut?: { id: string; type: string } | null
}
const details = (m1: M1Session, clipId: string) => m1.bridge.toolData<ClipDetails>('getClipDetails', { clipId })
const opacityOf = (clip: ClipDetails) => clip.transform?.opacity ?? clip.opacity ?? 1

/** phoneAllToolsCatalog.ts PHONE_ALL_TOOLS_BADGE_TEST_ID (that module pulls in shader imports Node cannot load). */
const PHONE_ALL_TOOLS_BADGE_TEST_ID = 'phone-alltools-badge'

async function expectExplained(m1: M1Session, pattern: RegExp): Promise<void> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice).toContainText(pattern)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
}

/** Selects the clip by touch (unless it already is) and taps one of its clip tools. */
async function openClipTool(m1: M1Session, clipId: string, actionId: string): Promise<void> {
  const selected = (await m1.timeline()).selectedIds
  if (!(selected.length === 1 && selected[0] === clipId)) await tapClip(m1, clipId)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'the clip did not get selected' }).toEqual([clipId])
  await tapAction(m1, phoneActionTestId(actionId))
  await expect(m1.sheet, `the ${actionId} tool did not open a sheet`).toBeVisible()
}

async function closeSheet(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
}

async function expectFrame(m1: M1Session, frame: number, what: string): Promise<void> {
  let agreed = 0
  await expect.poll(async () => {
    const read = (await readPreviewFrame(m1.probe)).frame
    agreed = read === frame ? agreed + 1 : 0
    return agreed >= 2
  }, { message: what, timeout: 20_000 }).toBe(true)
}

// ---------------------------------------------------------------------------
// All tools
// ---------------------------------------------------------------------------

test('all-tools: lists every toolbar action, pro sheet and desktop panel; search narrows it @phone', async ({ m1 }) => {
  await openAllTools(m1)
  const entries = m1.page.getByTestId(PANELS.allToolsEntry)
  const ids = await entries.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-entry-id')))
  for (const sheet of ['compositions', 'tracks', 'markers', 'captions', 'audioFx', 'library', 'settings']) expect(ids).toContain(`sheet:${sheet}`)
  for (const panel of PHONE_PANELS) expect(ids, `panel ${panel.type} listed`).toContain(`panel:${panel.type}`)
  for (const action of ['split', 'speed', 'text', 'captions', 'properties', 'all-tools']) expect(ids).toContain(`action:${action}`)
  expect(ids).toContain('view:fullscreen')

  await m1.page.getByTestId(PANELS.allToolsSearch).fill('subtitles')
  await expect(entry(m1, 'sheet:captions')).toBeVisible()
  await expect(entry(m1, 'panel:media')).toHaveCount(0)
  await m1.page.getByTestId(PANELS.allToolsSearch).fill('zzqx')
  await expect(m1.page.getByTestId(PANELS.allToolsEmpty)).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(PANELS.allToolsClear))
  await expect(entries).toHaveCount(ids.length)
  await closeSheet(m1)
})

test('all-tools: landscape panels open their landscape editor; clip tools explain themselves @phone', async ({ m1 }) => {
  await openAllTools(m1)
  for (const id of ['panel:node-workspace', 'panel:audio-mixer', 'panel:color-scopes']) {
    await expect(entry(m1, id)).not.toHaveAttribute('aria-disabled', 'true')
  }
  await tapOn(m1, entry(m1, 'panel:audio-mixer'))
  const workspace = m1.page.getByTestId('phone-workspace')
  await expect(workspace, 'Audio Mixer opens the landscape Mixer editor').toHaveAttribute('data-workspace', 'mixer')
  await expect(m1.page.getByTestId(PANELS.allToolsSearch), 'All tools gave way to the editor').toHaveCount(0)
  await tapOn(m1, m1.page.getByTestId('phone-workspace-back'))
  await expect(workspace, 'Back returns to the timeline').toHaveCount(0)
  await openAllTools(m1)
  await expect(entry(m1, 'action:speed')).toHaveAttribute('aria-disabled', 'true')
  await expect(entry(m1, 'action:speed').getByTestId(PHONE_ALL_TOOLS_BADGE_TEST_ID), 'a greyed row says why in a word').toHaveText('Select a clip')
  const badges = await m1.page.getByTestId(PHONE_ALL_TOOLS_BADGE_TEST_ID).allTextContents()
  expect(badges.filter(text => /^M\d$/.test(text)), 'no greyed row shows a milestone name').toEqual([])
  await tapOn(m1, entry(m1, 'action:speed'))
  await expectExplained(m1, /Select a clip/)
  await expect(m1.sheet, 'explaining keeps All tools open').toBeVisible()
  await closeSheet(m1)
})

test('all-tools: a sheet entry and an action entry open their tool @phone', async ({ m1 }) => {
  await openAllTools(m1)
  await tapOn(m1, entry(m1, 'action:text'))
  await expect(m1.page.getByTestId(M1_IDS.titleInput), 'Text from All tools opens the title sheet').toBeVisible()
  await tapCancel(m1)
  await openAllTools(m1)
  await m1.page.getByTestId(PANELS.allToolsSearch).fill('compositions')
  await tapOn(m1, entry(m1, 'sheet:compositions'))
  await expect(m1.page.getByTestId(PANELS.allToolsSearch), 'All tools gave way to the compositions sheet').toHaveCount(0)
  await expect(m1.sheet).toBeVisible()
  await expect(m1.sheet.getByRole('heading', { level: 2 })).toContainText(/Composition/i)
  await closeSheet(m1)
})

// ---------------------------------------------------------------------------
// Desktop panels on the phone, one case per group
// ---------------------------------------------------------------------------

test('panels-edit: Properties, Transitions, Layers, Tools, History, Annotations and Story fit the phone @phone', async ({ m1 }, testInfo) => {
  await checkPanelGroup(m1, ['clip-properties', 'transitions', 'layers', 'tools', 'history', 'annotations', 'story'], testInfo)
})

test('panels-media: Media, Discover, Notebook, Export and Stats fit the phone @phone', async ({ m1 }, testInfo) => {
  await checkPanelGroup(m1, ['media', 'discover', 'documents', 'export', 'stats'], testInfo)
})

test('panels-ai: AI Studio, AI Segment and AI Scene Description fit the phone @phone', async ({ m1 }, testInfo) => {
  await checkPanelGroup(m1, ['ai-studio', 'ai-segment', 'scene-description'], testInfo)
})

test('panels-live: Capture, Go Live, Stream Chat, Stream Analytics and MIDI Mapping fit the phone @phone', async ({ m1 }, testInfo) => {
  await checkPanelGroup(m1, ['capture', 'go-live', 'stream-chat', 'stream-analytics', 'midi-mapping'], testInfo)
})

test('panels-properties: an opacity typed into Properties lands in the timeline and the preview, one Undo restores both @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  await openClipTool(m1, clip.id, 'properties')
  await expect(host(m1)).toHaveAttribute('data-panel-type', 'clip-properties')
  const field = host(m1).getByRole('slider', { name: 'Opacity', exact: true })
  await field.scrollIntoViewIfNeeded()
  const box = (await field.boundingBox())!
  expect(box.height, 'the opacity field is finger-sized').toBeGreaterThanOrEqual(31.5)
  await tapOn(m1, field)
  const input = host(m1).getByRole('textbox', { name: 'Opacity', exact: true })
  await expect(input, 'a tap on the number opens it for typing').toBeVisible()
  await input.fill('40')
  await input.press('Enter')
  await expect.poll(async () => opacityOf(await details(m1, clip.id)), { message: 'the typed opacity did not reach the clip' }).toBeCloseTo(0.4, 3)
  const dimmed = await waitForPixels(m1, px => regionMean(px, REGIONS.bars).luma < regionMean(before, REGIONS.bars).luma * 0.75, 'the preview did not get darker')
  expect(regionMean(dimmed, REGIONS.bars).luma).toBeGreaterThan(5)
  await closeSheet(m1)

  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => opacityOf(await details(m1, clip.id)), { message: 'one Undo did not restore the opacity' }).toBeCloseTo(1, 4)
  await waitForPixels(m1, px => Math.abs(regionMean(px, REGIONS.bars).luma - regionMean(before, REGIONS.bars).luma) < 3, 'one Undo did not restore the picture')
})

test('panels-properties-drag: an opacity drag in Properties lands in the timeline and one Undo restores it @phone', async ({ m1 }) => {
  // Regression guard (was test.fail 'inspector-drag-undo-per-frame'): a browser runs microtasks between
  // the window capture listener and React's root listener, and the input owner used to end there, so
  // every slider frame became its own revision. editorGestureOwnership now keeps it for the whole dispatch.
  const clip = await importClipA(m1)
  const before = await stablePixels(m1)
  await openClipTool(m1, clip.id, 'properties')
  await expect(host(m1)).toHaveAttribute('data-panel-type', 'clip-properties')
  const slider = host(m1).getByRole('slider', { name: 'Opacity slider' })
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  if (!box) throw new Error('the opacity slider is not rendered')
  expect(box.height, 'the opacity slider is finger-sized').toBeGreaterThanOrEqual(31.5)
  // Thumb at 100 %: drag it to about 40 %.
  const thumbX = box.x + 3.5 + (box.width - 7)
  await m1.touch.pan({ x: thumbX - 1, y: box.y + box.height / 2 }, { x: -(box.width - 7) * 0.6, y: 0 }, { steps: 14 })
  await expect.poll(async () => opacityOf(await details(m1, clip.id)), { message: 'the opacity drag did not reach the clip' }).toBeLessThan(0.6)
  const dimmed = await waitForPixels(m1, px => regionMean(px, REGIONS.bars).luma < regionMean(before, REGIONS.bars).luma * 0.75, 'the preview did not get darker')
  expect(regionMean(dimmed, REGIONS.bars).luma).toBeGreaterThan(5)

  await closeSheet(m1)

  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => opacityOf(await details(m1, clip.id)), { message: 'one Undo did not restore the opacity' }).toBeCloseTo(1, 4)
  await waitForPixels(m1, px => Math.abs(regionMean(px, REGIONS.bars).luma - regionMean(before, REGIONS.bars).luma) < 3, 'one Undo did not restore the picture')
})

test('panels-scroll: a vertical swipe scrolls the Properties panel and edits nothing @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  const snapshot = await clipSnapshot(m1, clip.id)
  await openClipTool(m1, clip.id, 'properties')
  await expect(host(m1)).toHaveAttribute('data-panel-type', 'clip-properties')
  const scroller = host(m1).locator('.properties-content').first()
  await expect(scroller).toBeVisible()
  await expect.poll(() => scroller.evaluate(node => node.scrollHeight > node.clientHeight + 4), { message: 'Properties has nothing to scroll' }).toBe(true)
  const area = (await scroller.boundingBox())!
  const startTop = await scroller.evaluate(node => node.scrollTop)
  // A finger on the row labels, moving up: the way a person scrolls a list.
  await m1.touch.pan({ x: area.x + 16, y: area.y + area.height * 0.8 }, { x: 0, y: -area.height * 0.5 }, { steps: 10 })
  await expect.poll(() => scroller.evaluate(node => node.scrollTop), { message: 'a finger swipe did not scroll the panel' }).toBeGreaterThan(startTop + 20)
  await closeSheet(m1)
  expect(await clipSnapshot(m1, clip.id), 'scrolling changed a value of the clip').toBe(snapshot)
})

// ---------------------------------------------------------------------------
// The former "(M3)" rows of the M2 sheets
// ---------------------------------------------------------------------------

test('effects-all-parameters: opens Properties on the Effects tab of the clip @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await m1.bridge.toolData('addEffect', { clipId: clip.id, effectType: 'glow' })
  await openClipSheet(m1, clip.id, 'effects')
  await expect(m1.page.getByTestId(FX.effectsAllParameters)).toBeVisible()
  await expect(m1.page.getByTestId(FX.effectsAllParameters)).not.toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(FX.effectsAllParameters))
  await expect(host(m1)).toHaveAttribute('data-panel-type', 'clip-properties')
  await expect(host(m1).locator('.tab-btn.active')).toContainText(/Effects/)
  await expect(host(m1)).toContainText(/Glow/i)
  expect((await m1.timeline()).selectedIds).toEqual([clip.id])
  await closeSheet(m1)
})

test('transition-settings: keeps the chosen transition as one undo step and opens its settings @phone', async ({ m1 }) => {
  const state = await importViaSheet(m1, { visual: [m1.media.a.path, m1.media.b.path] }, { main: 2, total: 2 })
  const [a] = state.main
  await waitForSettledHistory(m1)
  const cut = m1.page.locator(`[data-testid="${TRANSITION.cutButton}"][data-clip-a="${a.id}"]`)
  await tapOn(m1, cut)
  await expect(m1.page.getByTestId(TRANSITION.settings)).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, m1.page.getByTestId(TRANSITION.settings))
  await expectExplained(m1, /Pick a transition first/)
  await tapOn(m1, m1.page.getByTestId(phoneTransitionCategoryTestId('dissolve')))
  await tapOn(m1, m1.page.getByTestId(phoneTransitionChoiceTestId('dip-to-white')))
  await tapOn(m1, m1.page.getByTestId(TRANSITION.settings))
  await expect(host(m1)).toHaveAttribute('data-panel-type', 'clip-properties')
  await expect(host(m1)).toContainText(/dip|white/i)
  expect((await details(m1, a.id)).transitionOut?.type).toBe('dip-to-white')
  await closeSheet(m1)
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await details(m1, a.id)).transitionOut ?? null, { message: 'one Undo did not remove the transition' }).toBeNull()
})

test('speed-freeze: freezes the clip on the playhead frame; one Undo brings the motion back @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await seek(m1, 2)
  await expectFrame(m1, 60, 'A frame 60 at 2 s')
  await openClipSheet(m1, clip.id, 'speed')
  await tapOn(m1, m1.page.getByTestId(SPEED.freeze))
  await expect(m1.sheet, 'Freeze frame closes the sheet').toBeHidden()
  await seek(m1, 0.5)
  await expectFrame(m1, 60, 'the frozen clip shows frame 60 at 0.5 s')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await seek(m1, 0.5)
  await expectFrame(m1, 15, 'A frame 15 at 0.5 s again')
})

test('speed-fit-length: Done fits the clip to a typed length, one Undo restores, Cancel changes nothing @phone', async ({ m1 }) => {
  const clip = await importClipA(m1)
  await openClipSheet(m1, clip.id, 'speed')
  await tapOn(m1, m1.page.getByTestId(SPEED.fitLength))
  await m1.page.getByTestId(PANELS.fitLengthInput).fill('2')
  await tapOn(m1, m1.page.getByTestId(PANELS.fitLengthApply))
  await expect.poll(async () => (await details(m1, clip.id)).duration, { message: 'the clip did not get the typed length live' }).toBeCloseTo(2, 2)
  await tapDone(m1)
  const fitted = await details(m1, clip.id)
  expect(fitted.speed).toBeCloseTo(2, 3)
  await seek(m1, 0.5)
  await expectFrame(m1, 30, 'at 2x the clip shows frame 30 at 0.5 s')
  await waitForSettledHistory(m1)
  await tapUndo(m1)
  await expect.poll(async () => (await details(m1, clip.id)).duration, { message: 'one Undo did not restore the length' }).toBeCloseTo(4, 3)

  await openClipSheet(m1, clip.id, 'speed')
  await tapOn(m1, m1.page.getByTestId(SPEED.fitLength))
  await m1.page.getByTestId(PANELS.fitLengthInput).fill('8')
  await tapOn(m1, m1.page.getByTestId(PANELS.fitLengthApply))
  await expect.poll(async () => (await details(m1, clip.id)).duration).toBeCloseTo(8, 2)
  await tapCancel(m1)
  await expect.poll(async () => (await details(m1, clip.id)).duration, { message: 'Cancel did not restore the length' }).toBeCloseTo(4, 3)
  expect((await details(m1, clip.id)).speed).toBeCloseTo(1, 6)
})

// ---------------------------------------------------------------------------
// Fullscreen preview and home
// ---------------------------------------------------------------------------

test('fullscreen-preview: fills the screen, plays and pauses, and a tap on the picture goes back @phone', async ({ m1 }) => {
  await importClipA(m1)
  const region = m1.page.getByTestId(IDS.previewRegion)
  await tapOn(m1, m1.page.getByTestId(PREVIEW.fullscreenButton))
  await expect(region).toHaveAttribute('data-fullscreen', 'true')
  const viewport = m1.page.viewportSize()!
  await expect.poll(async () => (await region.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(viewport.width - 1)
  await expect.poll(async () => (await region.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(viewport.height * 0.95)
  const canvas = (await region.getByTestId(IDS.previewCanvas).boundingBox())!
  expect(canvas.height, 'the picture grows with the screen').toBeGreaterThan(viewport.height * 0.6)

  await tapOn(m1, m1.page.getByTestId(PREVIEW.fullscreenPlay))
  await expect(m1.page.getByTestId(PREVIEW.fullscreenPlay), 'the timeline plays').toHaveAttribute('data-playing', 'true')
  await expect(m1.page.getByTestId(PREVIEW.fullscreenTime)).toHaveText('Playing')
  await tapOn(m1, m1.page.getByTestId(PREVIEW.fullscreenPlay))
  await expect(m1.page.getByTestId(PREVIEW.fullscreenPlay), 'the timeline paused').toHaveAttribute('data-playing', 'false')
  await expect(region, 'the play button keeps the fullscreen preview').toHaveAttribute('data-fullscreen', 'true')

  const box = (await region.boundingBox())!
  await m1.touch.tap({ x: box.x + box.width / 2, y: box.y + box.height * 0.4 })
  await expect(region).toHaveAttribute('data-fullscreen', 'false')
  await expect(m1.page.getByTestId(IDS.timeline)).toBeVisible()

  await tapOn(m1, m1.page.getByTestId(PREVIEW.fullscreenButton))
  await expect(region).toHaveAttribute('data-fullscreen', 'true')
  await tapOn(m1, m1.page.getByTestId(PREVIEW.fullscreenExit))
  await expect(region).toHaveAttribute('data-fullscreen', 'false')
})

test('home-templates: Templates / Looks stays visible and says precisely where looks are @phone', async ({ m1 }) => {
  await tapOn(m1, m1.page.getByTestId(TOPBAR_PROJECTS))
  const tile = m1.page.getByTestId(PHONE_HOME_TEST_IDS.templates)
  await expect(tile).toBeVisible()
  await expect(tile).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, tile)
  await expect(m1.page.getByTestId(M1_IDS.home)).toContainText(/project templates are not in MasterSelects yet/)
  await expect(m1.page.getByTestId(M1_IDS.home)).toContainText(/Filters/)
  await tapOn(m1, m1.page.getByRole('button', { name: 'Back to editing' }))
  await expect(m1.page.getByTestId(M1_IDS.home)).toHaveCount(0)
})
