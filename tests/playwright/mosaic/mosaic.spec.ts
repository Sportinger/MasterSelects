import { readFile } from 'node:fs/promises'
import { test as base, expect, type TestInfo } from '@playwright/test'
import { mosaicResults, type MosaicResults } from './mosaicMeasure'
import { FRAMES } from './mosaicLayout'
import { describeFailures, type MosaicSource, type MosaicTile, type TileResult } from './mosaicOracle'

/**
 * SC-MOSAIC, MVP: one 1920×1080 composition whose regions each test one feature,
 * all active in every frame (tests/playwright/mosaic/mosaicLayout.ts has the map).
 * The worker builds it once through the Dev Bridge, reads the paused preview at
 * eight checkpoint frames (screenshots, decoded per tile region) and decodes one
 * Fast export in Node (all 120 frames). Every case below judges only its own tile
 * and source from those results, so one tile's defect never turns another red,
 * and a failure names the tile, the frame and the source.
 *
 * Catalog cases (`@case:`) are given where the catalog already has one with this
 * oracle; the other cases are new.
 *
 * Known product defects found by this spec (2026-10-27), each kept visible on its case:
 * - NESTED_SMALL_COMP_PREVIEW: a composition smaller than its parent, nested right
 *   after it was filled, shows only its leftmost column stretched across the layer in
 *   the paused preview; the export renders it correctly (T09a).
 * - REVERSE_PAUSED_BEFORE_KEYFRAME: the paused preview shows nothing for a reversed
 *   clip whose selected source frame is the last one before a keyframe (T11b at
 *   frame 60 shows source frame 59 of a 1-s GOP; stays empty for more than 12 s).
 * - EXPORT_REVERSE_OFF_BY_ONE: the Fast export shows source frame 120 − N instead of
 *   119 − N for a reversed clip, i.e. the frame starting at the boundary instead of
 *   the one left of it (contract: src/services/timeline/retime/clipRetime.ts:173-180).
 * - EXPORT_STALE_LAYER_FRAMES: with about a dozen video layers the Fast export shows
 *   a neighbouring (mostly previous) source frame on some layers for one to four
 *   frames, without counting a previous-frame fallback. The video clock shows 59 at
 *   frames 60-62 in every run; other layers are hit at varying frames.
 */
const DEFECT = {
  nestedSmallCompPreview: 'NESTED_SMALL_COMP_PREVIEW: a nested composition smaller than its parent shows only its leftmost column, stretched, in the paused preview',
  reversePausedBeforeKeyframe: 'REVERSE_PAUSED_BEFORE_KEYFRAME: paused preview is empty for a reversed clip on the last source frame before a keyframe',
  exportReverseOffByOne: 'EXPORT_REVERSE_OFF_BY_ONE: Fast export shows source frame 120-N instead of 119-N for a reversed clip',
  exportStaleLayerFrames: 'EXPORT_STALE_LAYER_FRAMES: Fast export shows a neighbouring source frame on some video layers without counting a fallback',
} as const

/**
 * While EXPORT_STALE_LAYER_FRAMES is open, a tile's export case tolerates its
 * isolated stale frames (at most this many frames, each within ±10 source frames
 * of the expected one, i.e. up to five composition frames on a 60 fps source) and
 * lists them as an annotation. The strict per-frame check
 * stays on the video clock (marked with the defect). Set to 0 when the defect is fixed.
 */
const KNOWN_STALE_FRAME_BUDGET = 16

const test = base.extend<object, { mosaic: MosaicResults }>({
  mosaic: [async ({ browser }, provide, workerInfo) => {
    await provide(await mosaicResults(browser, workerInfo.project.use.baseURL))
  }, { scope: 'worker', timeout: 600_000 }],
})

test.describe.configure({ timeout: 60_000 })

/** A result whose only failures are frame readings a few frames off: the known stale-frame defect. */
function isStaleFrameOnly(entry: TileResult): boolean {
  const failing = entry.checks.filter(check => !check.ok)
  return failing.length > 0 && failing.every(check => / frame$/.test(check.name) && typeof check.measured === 'number'
    && typeof check.expected === 'number' && Math.abs(check.measured - check.expected) <= 10)
}

async function judge(mosaic: MosaicResults, testInfo: TestInfo, tile: MosaicTile, source: MosaicSource, { strictFrames = false } = {}): Promise<void> {
  const error = source === 'preview' ? mosaic.previewError : mosaic.exportError
  const results = mosaic[source].filter(entry => entry.tile === tile)
  await testInfo.attach(`${tile}-${source}.json`, { body: JSON.stringify(results, null, 1), contentType: 'application/json' })
  const crop = mosaic.crops[`${source}-${tile}`]
  if (crop) await testInfo.attach(`${tile}-${source}-first-failure.png`, { body: await readFile(crop), contentType: 'image/png' })
  if (source === 'preview' && mosaic.previewPicture) await testInfo.attach('mosaic-preview-frame45.png', { body: await readFile(mosaic.previewPicture), contentType: 'image/png' })
  expect(error, `the ${source} measurement did not complete`).toBeUndefined()
  expect(results.length, `${tile} has no ${source} results`).toBe(source === 'export' ? FRAMES : mosaic.settle.length)
  let failing = results.filter(entry => !entry.ok)
  if (source === 'export' && !strictFrames) {
    const stale = failing.filter(isStaleFrameOnly)
    if (stale.length && stale.length <= KNOWN_STALE_FRAME_BUDGET) {
      testInfo.annotations.push({ type: 'known-defect', description: `${DEFECT.exportStaleLayerFrames}: ${describeFailures(stale)}` })
      failing = failing.filter(entry => !isStaleFrameOnly(entry))
    }
  }
  expect(failing.length, `${tile} in the ${source}: ${describeFailures(failing, { total: results.length })}`).toBe(0)
}

// ── Clocks and guard bands: the prerequisites every tile verdict stands on ──

test('mosaic clocks in the paused preview: C1 shows each checkpoint frame and the keyframe ruler stands at its key interpolation @module:transport @tier:nightly', async ({ mosaic }, testInfo) => {
  await testInfo.attach('settle.json', { body: JSON.stringify(mosaic.settle, null, 1), contentType: 'application/json' })
  const unsettled = mosaic.settle.filter(entry => !entry.settled)
  expect(unsettled, `checkpoints where the preview did not settle: ${JSON.stringify(unsettled)}`).toEqual([])
  await judge(mosaic, testInfo, 'clock', 'preview')
})

test('mosaic clocks in the export: every frame 0-119 exactly once in order, ruler on its keys, no repeated previous frame @module:export @tier:nightly @case:export.fast.lim-frame-sequence', async ({ mosaic }, testInfo) => {
  // 2026-10-27: C1 shows frame 59 at frames 60-62 in every run (see EXPORT_STALE_LAYER_FRAMES above).
  test.fail(true, DEFECT.exportStaleLayerFrames)
  await testInfo.attach('export-info.json', { body: JSON.stringify(mosaic.exportInfo ?? null, null, 1), contentType: 'application/json' })
  expect(mosaic.exportInfo?.previousFrameFallbacks ?? 0, 'the exporter repeated a previous frame instead of rendering it').toBe(0)
  await judge(mosaic, testInfo, 'clock', 'export', { strictFrames: true })
})

test('mosaic guard bands in the paused preview: no tile bleeds into its 16-px ring, empty cells stay empty @module:transport @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'guards', 'preview')
})

test('mosaic guard bands in the export @module:export @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'guards', 'export')
})

// ── Tiles ──

test('T01 reference tile in the paused preview: frame, source id, colour bars, grey ramp and box edges @module:transport @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T01', 'preview')
})

test('T01 reference tile in the export @module:export @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T01', 'export')
})

test('T03 keyframed transform in the paused preview: x linear, y ease-in-out, scale 0.75, frame code moves with it @module:transforms-keyframes @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T03', 'preview')
})

test('T03 keyframed transform in the export: position at every frame equals the key interpolation @module:transforms-keyframes @tier:nightly @case:export.fast.tl-transform-keys', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T03', 'export')
})

test('T04 opacity and layer order in the paused preview: keyed opacity and source-over mix of three layers @module:transforms-keyframes @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T04', 'preview')
})

test('T04 opacity and layer order in the export @module:transforms-keyframes @tier:nightly @case:export.fast.tl-layers-opacity', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T04', 'export')
})

test('T06 rectangle mask with feather in the paused preview: inside, outside, edge position and Gaussian edge width @module:masks @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T06', 'preview')
})

test('T06 rectangle mask with feather in the export @module:masks @tier:nightly @case:masks.in-export', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T06', 'export')
})

test('T09a nested 352x224 composition at 60 fps in the paused preview: inner frame 2N+60 and the outer strip N @module:nested-compositions @tier:nightly', async ({ mosaic }, testInfo) => {
  // 2026-10-27: the inner composition shows its leftmost column stretched at every checkpoint; the export is right.
  test.fail(true, DEFECT.nestedSmallCompPreview)
  await judge(mosaic, testInfo, 'T09a', 'preview')
})

test('T09a nested 352x224 composition at 60 fps in the export @module:nested-compositions @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T09a', 'export')
})

test('T09b nested composition of the mosaic size at 60 fps in the paused preview: inner frame 2N+60 and the outer strip N @module:nested-compositions @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T09b', 'preview')
})

test('T09b nested composition of the mosaic size at 60 fps in the export @module:nested-compositions @tier:nightly @case:export.fast.tl-nested', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T09b', 'export')
})

test('T11a speed 2 in the paused preview: source frame 2N @module:timeline-editing @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T11a', 'preview')
})

test('T11a speed 2 in the export: every second source frame, none doubled @module:export @tier:nightly @case:export.fast.tl-speed-2x', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T11a', 'export')
})

test('T11b reverse in the paused preview: source frame 119-N @module:timeline-editing @tier:nightly', async ({ mosaic }, testInfo) => {
  // 2026-10-27: empty at checkpoint 60 (source frame 59, the last before the keyframe at 60).
  test.fail(true, DEFECT.reversePausedBeforeKeyframe)
  await judge(mosaic, testInfo, 'T11b', 'preview')
})

test('T11b reverse in the export: source frame 119-N @module:export @tier:nightly', async ({ mosaic }, testInfo) => {
  // 2026-10-27: 119 of 120 frames show 120-N.
  test.fail(true, DEFECT.exportReverseOffByOne)
  await judge(mosaic, testInfo, 'T11b', 'export')
})
