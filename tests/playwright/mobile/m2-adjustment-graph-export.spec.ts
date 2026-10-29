import type { TestInfo } from '@playwright/test'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_EFFECTS_TEST_IDS as FX } from '../../../src/components/mobileSkin/effects/phoneEffectsTestIds'
import { readVideoFrameCodes, streamVideoFrames, type FramePixels } from '../assertions/frameCodeOracle'
import {
  COMP_HEIGHT, COMP_WIDTH, IDS, M1_IDS, TOPBAR_EXPORT, differingShare, expect, importViaSheet, previewPixels, probeVideo, seek, settled,
  tapAction, tapClip, tapForDownload, tapOn, test, type M1Session,
} from './m1Fixture'
import { stablePixels } from './m2DesignFixture'

/**
 * Graph and texture effects on a phone adjustment layer, through to the export. Production 3.3.9
 * (Android, 2026-10-29): Pixel Sort Bands on the adjustment layer the Effects sheet adds when nothing
 * is selected, the export stopped with "Motion adjustment layer uses unsupported render properties".
 * Switching the effect off and on once in the stack (setClipEffectEnabled) collapses its node group,
 * which writes node-graph layout onto the layer; the layer admission refused any node graph, the export
 * threw and the preview left the layer out silently.
 *
 * One catalog case per graph/texture effect, in the M1 phone world (m1Fixture.ts: a fresh 1080x1920
 * composition per test, clip A = frame-code 360x640, 30 fps, 4 s, imported through the media sheet).
 * Every action under test is real touch: nothing selected, Effects sheet, the effect's card, off and on
 * in the stack, Done, then the export sheet. The bridge only arranges (playhead, in/out 0..2 s) and
 * inspects. The truth is the decoded file: frames 0..29 lie before the layer (it starts at the 1 s
 * playhead) and read their frame code in order and match the source; frames 30..59 lie under the layer
 * and must differ from the plain source frames (the effect is in the file), and none of them may read
 * as another frame.
 */
test.describe.configure({ timeout: 300_000 })

const FPS = 30
const LAYER_START_FRAME = 30
const EXPORT_FRAMES = 60
const SMALL = { width: 108, height: 192 }

/** The source clip's frames at the small comparison size (the 360x640 clip fills the 9:16 picture). */
async function sourceFrames(file: string): Promise<FramePixels[]> {
  const frames: FramePixels[] = []
  await streamVideoFrames(file, pixels => { frames.push({ ...pixels, data: Buffer.from(pixels.data) }) }, { scaleWidth: SMALL.width })
  return frames
}

/** Share of pixels whose largest channel difference exceeds 40 (a visible change). */
function changedShare(a: FramePixels, b: FramePixels): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let index = 0; index < a.data.length; index += 3) {
    const delta = Math.max(Math.abs(a.data[index] - b.data[index]), Math.abs(a.data[index + 1] - b.data[index + 1]), Math.abs(a.data[index + 2] - b.data[index + 2]))
    if (delta > 40) changed++
  }
  return changed / (a.data.length / 3)
}

/** A leftover modal notice of an earlier spec file swallows the next tap; close it like a person does. */
async function closeLeftoverNotice(m1: M1Session): Promise<void> {
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  if (await notice.isVisible()) await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
}

/** Clip A through the media sheet, playhead at 1 s, nothing selected; the plain picture there. */
async function arrange(m1: M1Session): Promise<{ clipId: string; plain: Awaited<ReturnType<typeof previewPixels>> }> {
  await closeLeftoverNotice(m1)
  const state = await importViaSheet(m1, { visual: [m1.media.a.path] }, { main: 1, total: 1 })
  await seek(m1, 1)
  await settled(m1)
  await m1.bridge.toolData('clearSelection')
  await expect.poll(async () => (await m1.timeline()).selectedIds).toEqual([])
  m1.probe.mark()
  await m1.probe.waitForFrame(30, { allowed: () => true, timeoutMs: 15_000 })
  return { clipId: state.main[0].id, plain: await stablePixels(m1) }
}

/** Nothing selected: Effects sheet, the effect's card, off and on in the stack, Done. Returns the new layer id. */
async function addThroughRootSheet(m1: M1Session, effectType: string, name: string): Promise<string> {
  await tapAction(m1, phoneActionTestId('effects-root'))
  await expect(m1.sheet, 'the Effects sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(FX.effectsTarget)).toContainText('adjustment layer')
  await m1.page.getByTestId(FX.effectsSearch).fill(name)
  const card = m1.sheet.locator(`[data-testid="${FX.effectsCard}"][data-effect-type="${effectType}"]`)
  await expect(card, `${name} is offered for an adjustment layer`).toHaveAttribute('aria-disabled', 'false')
  await tapOn(m1, card)
  const row = m1.sheet.locator(`[data-testid="${FX.effectsStackRow}"][data-effect-type="${effectType}"]`)
  await expect(row, `${name} is in the stack`).toHaveCount(1)
  // Off and on again, as a person compares the picture with and without the effect.
  await tapOn(m1, row.getByTestId(FX.effectsToggle))
  await expect(row).toHaveAttribute('data-enabled', 'false')
  await tapOn(m1, row.getByTestId(FX.effectsToggle))
  await expect(row).toHaveAttribute('data-enabled', 'true')
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet, 'the sheet stayed open after Done').toBeHidden({ timeout: 30_000 })
  const layer = (await m1.timeline()).all.find(clip => clip.sourceType === 'motion-adjustment')
  expect(layer, 'the sheet added an adjustment layer').toBeTruthy()
  expect(layer!.start, 'the layer starts at the playhead').toBeCloseTo(1, 3)
  return layer!.id
}

interface ExportJudgement {
  effect: string
  frames: number
  beforeLayerWrong: string[]
  underLayerMisread: string[]
  beforeLayerChange: number
  underLayerChange: { min: number; median: number; max: number }
  notice: string | null
}

/** Exports 0..2 s through the export sheet and judges the decoded file against the source frames. */
async function exportAndJudge(m1: M1Session, testInfo: TestInfo, effectType: string): Promise<ExportJudgement> {
  await m1.bridge.toolData('setInOutPoints', { inPoint: 0, outPoint: EXPORT_FRAMES / FPS })
  try {
    await tapOn(m1, m1.page.getByTestId(TOPBAR_EXPORT))
    await expect(m1.sheet, 'the export sheet did not open').toBeVisible()
    await tapOn(m1, m1.page.getByTestId(M1_IDS.exportStart))
    // Done when Save is usable; a failed export shows its message in the sheet and fails the case with it.
    const problem = m1.sheet.locator('.phone-export__problem')
    await expect.poll(async () => await problem.isVisible() ? `failed: ${await problem.innerText()}`
      : await m1.page.getByTestId(M1_IDS.exportSave).getAttribute('aria-disabled') === 'false' ? 'ready' : 'running',
    { message: 'the export finishes', timeout: 240_000 }).toBe('ready')
    const noticeLocator = m1.page.getByTestId('phone-export-notice')
    const notice = await noticeLocator.count() ? await noticeLocator.innerText() : null
    const { file } = await tapForDownload(m1, m1.page.getByTestId(M1_IDS.exportSave), testInfo, `adjustment-${effectType}`)
    await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
    await expect(m1.sheet).toBeHidden()
    const info = await probeVideo(file)
    expect({ width: info.width, height: info.height }, 'exported picture size (1080p portrait)').toEqual({ width: COMP_WIDTH, height: COMP_HEIGHT })
    const codes = (await readVideoFrameCodes(file)).readings.map(reading => reading.frame)
    const exported: FramePixels[] = []
    await streamVideoFrames(file, pixels => { exported.push({ ...pixels, data: Buffer.from(pixels.data) }) }, { scaleWidth: SMALL.width })
    const source = await sourceFrames(m1.media.a.path)
    const before = exported.slice(0, LAYER_START_FRAME).map((frame, index) => changedShare(frame, source[index]))
    const under = exported.slice(LAYER_START_FRAME).map((frame, index) => changedShare(frame, source[LAYER_START_FRAME + index])).toSorted((a, b) => a - b)
    const judgement: ExportJudgement = {
      effect: effectType,
      frames: codes.length,
      beforeLayerWrong: codes.slice(0, LAYER_START_FRAME).flatMap((frame, index) => frame === index ? [] : [`#${index}: ${frame ?? 'unreadable'}`]),
      underLayerMisread: codes.slice(LAYER_START_FRAME).flatMap((frame, index) => frame === null || frame === LAYER_START_FRAME + index ? [] : [`#${LAYER_START_FRAME + index}: reads ${frame}`]),
      beforeLayerChange: Number(Math.max(...before).toFixed(4)),
      underLayerChange: {
        min: Number((under[0] ?? 0).toFixed(4)),
        median: Number((under[Math.floor(under.length / 2)] ?? 0).toFixed(4)),
        max: Number((under.at(-1) ?? 0).toFixed(4)),
      },
      notice,
    }
    await testInfo.attach(`export-${effectType}.json`, { body: JSON.stringify(judgement, null, 1), contentType: 'application/json' })
    console.log(`EXPORT ${JSON.stringify(judgement)}`)
    return judgement
  } finally {
    await m1.bridge.toolData('setInOutPoints', { inPoint: null, outPoint: null })
  }
}

function expectEffectInFile(judgement: ExportJudgement, minimumChange: number): void {
  expect(judgement.frames, 'frame count of 0..2 s at 30 fps').toBe(EXPORT_FRAMES)
  expect(judgement.beforeLayerWrong, 'frames before the layer read 0..29 in order').toEqual([])
  expect(judgement.beforeLayerChange, 'frames before the layer equal the source').toBeLessThan(0.01)
  expect(judgement.underLayerMisread, 'no frame under the layer shows another source frame').toEqual([])
  expect(judgement.underLayerChange.median, `the effect is in the exported frames under the layer (${JSON.stringify(judgement.underLayerChange)})`).toBeGreaterThan(minimumChange)
  expect(judgement.notice ?? '', 'the export renders the whole layer').not.toContain('exports without')
}

// Graph and texture effects (recipes of image operator nodes). The change floor is per effect: Data
// HUD draws thin overlay graphics, the others rework large parts of the picture. Pixel Sort Bands sorts
// runs of pixels within its brightness range; at its defaults those runs are the flat colour areas of
// the test chart, which sorting leaves as they are, so the case widens the range to the whole column
// (arranged through the bridge after Done; the export then sorts every column of the picture).
const CASES: ReadonlyArray<{ type: string; name: string; minimumChange: number; params?: Record<string, number> }> = [
  { type: 'pixel-sort-bands', name: 'Pixel Sort Bands', minimumChange: 0.02, params: { centre: 0.5, range: 1, progress: 1 } },
  { type: 'block-dissolve', name: 'Block Dissolve', minimumChange: 0.01 },
  { type: 'block-silhouette', name: 'Block Silhouette', minimumChange: 0.02 },
  { type: 'data-hud', name: 'Data HUD', minimumChange: 0.004 },
  { type: 'block-cloud', name: 'Block Cloud', minimumChange: 0.02 },
  { type: 'flow-mosh', name: 'Flow Mosh', minimumChange: 0.02 },
]

for (const effect of CASES) {
  test(`adjustment-layer-effects: ${effect.name} on the adjustment layer added with nothing selected, switched off and on, exports with the effect @phone`, async ({ m1 }, testInfo) => {
    const { clipId, plain } = await arrange(m1)
    const layerId = await addThroughRootSheet(m1, effect.type, effect.name)
    if (effect.params) {
      const [added] = (await m1.bridge.toolData<{ effects: Array<{ id: string }> }>('getClipDetails', { clipId: layerId })).effects
      await m1.bridge.toolData('updateEffect', { clipId: layerId, effectId: added.id, params: effect.params })
    }
    expectEffectInFile(await exportAndJudge(m1, testInfo, effect.type), effect.minimumChange)
    // The preview renders the layer too (in 3.3.9 it was left out silently).
    await seek(m1, 1)
    await expect.poll(async () => differingShare(plain, await stablePixels(m1), 40), {
      message: `${effect.name} changes the preview under the layer`, timeout: 20_000,
    }).toBeGreaterThan(effect.minimumChange / 2)
    const details = await m1.bridge.toolData<{ effects: Array<{ type: string; enabled: boolean }>; adjustmentRender?: { skippedProperties: unknown[]; bypassedEffects: unknown[] } }>('getClipDetails', { clipId: layerId })
    expect(details.effects.map(item => [item.type, item.enabled])).toEqual([[effect.type, true]])
    expect(details.adjustmentRender, 'the layer renders without skipping anything').toEqual({ skippedProperties: [], bypassedEffects: [] })
    expect((await m1.bridge.toolData<{ effects: unknown[] }>('getClipDetails', { clipId })).effects, 'the clip itself is untouched').toEqual([])
  })
}

/** Drags the visible slider thumb by `fraction` of its width (real touch from the thumb). */
async function dragSlider(m1: M1Session, fraction: number): Promise<void> {
  const range = m1.sheet.getByTestId(FX.slider).locator('.handle-only-range').first()
  await range.scrollIntoViewIfNeeded()
  const box = (await range.boundingBox())!
  const [now, min, max] = await Promise.all(['aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map(async name => Number(await range.getAttribute(name))))
  const ratio = (now - min) / (max - min)
  await m1.touch.pan({ x: box.x + 3.5 + ratio * (box.width - 7), y: box.y + box.height / 2 }, { x: fraction * (box.width - 7), y: 0 }, { steps: 10 })
}

/** Mean channel value below the frame-code band. */
function luma(pixels: { width: number; height: number; data: Buffer }): number {
  const first = Math.floor(pixels.height * 0.2) * pixels.width * 3
  let sum = 0
  for (let index = first; index < pixels.data.length; index++) sum += pixels.data[index]
  return sum / (pixels.data.length - first)
}

test('colour-basic-adjustments: Adjust and a filter grade everything below a selected adjustment layer @phone', async ({ m1 }) => {
  const { clipId, plain } = await arrange(m1)
  // Arrangement: an empty adjustment layer over the clip; selecting it is the first touch under test.
  const track = await m1.bridge.toolData<{ id?: string; trackId?: string }>('createTrack', { type: 'video', name: 'Adjustments' })
  const created = await m1.bridge.toolData<{ clipId: string }>('editMotionAdjustment', { operation: 'create', trackId: track.trackId ?? track.id, startTime: 0, duration: 4 })
  await m1.bridge.toolData('clearSelection')
  await tapClip(m1, created.clipId)
  await expect(m1.clip(created.clipId)).toHaveAttribute('aria-selected', 'true')

  await tapAction(m1, phoneActionTestId('adjust'))
  await expect(m1.sheet, 'the Adjust sheet did not open').toBeVisible()
  await expect(m1.page.getByTestId(FX.adjustStatus), 'Adjust edits the selected adjustment layer').not.toContainText('Select a clip')
  const tile = m1.sheet.locator(`[data-testid="${FX.adjustTile}"][data-adjust-key="exposure"]`)
  await tapOn(m1, tile)
  await expect(tile).toHaveAttribute('aria-pressed', 'true')
  const openBefore = await stablePixels(m1)
  await dragSlider(m1, 0.2)
  await expect.poll(async () => luma(await stablePixels(m1)), { message: 'Exposure on the adjustment layer brightens the picture below', timeout: 20_000 })
    .toBeGreaterThan(luma(openBefore) + 8)
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet).toBeHidden({ timeout: 30_000 })
  const graded = await stablePixels(m1)
  expect(luma(graded), 'the grade stays after Done').toBeGreaterThan(luma(plain) + 8)
  const layerDetails = await m1.bridge.toolData<{ colorCorrection?: unknown; adjustmentRender?: { skippedProperties: unknown[] } }>('getClipDetails', { clipId: created.clipId })
  expect(layerDetails.adjustmentRender?.skippedProperties, 'the grade is no skipped property').toEqual([])
  expect((await m1.bridge.toolData<{ effects: unknown[] }>('getClipDetails', { clipId })).effects, 'the clip itself is untouched').toEqual([])

  await tapAction(m1, phoneActionTestId('filters'))
  await expect(m1.sheet, 'the Filters sheet did not open').toBeVisible()
  await tapOn(m1, m1.sheet.locator(`[data-testid="${FX.filtersCard}"][data-look-id="digital-noir"]`))
  await expect.poll(async () => differingShare(graded, await stablePixels(m1), 40), { message: 'a filter on the adjustment layer changes the picture below', timeout: 20_000 })
    .toBeGreaterThan(0.05)
  await tapOn(m1, m1.page.getByTestId(IDS.sheetDone))
  await expect(m1.sheet).toBeHidden({ timeout: 30_000 })
  const layerEffects = await m1.bridge.toolData<{ effects: Array<{ type: string }> }>('getClipDetails', { clipId: created.clipId })
  expect(layerEffects.effects.map(item => item.type), 'the Look is the layer stack').toEqual(['dither-studio', 'vignette'])
})
