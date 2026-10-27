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
 * Product defects found by this spec (2026-10-27), fixed; the cases are normal tests again:
 * - REVERSE_PAUSED_BEFORE_KEYFRAME: the paused preview showed nothing for a reversed
 *   clip whose selected source frame is the last one before a keyframe (T11b at frame
 *   60, source frame 59 of a 1-s GOP). The frame-exact HTML seek sat 5 µs before the
 *   keyframe, the demuxer rounded it onto the keyframe and Chromium presented frame 60,
 *   which the paused guard rightly refused; htmlVideoFrameSeekTime
 *   (src/services/layerBuilder/videoSyncFrameSelection.ts) now keeps 1 ms clear of the
 *   next frame (tests/unit/pausedFrameExactSeek.test.ts).
 * - NESTED_SMALL_COMP_PREVIEW: a composition smaller than its parent, nested right
 *   after it was filled, showed only its leftmost column stretched in the paused preview
 *   (T09a). The new nested element found scrub frames cached by the inner composition's
 *   element before it had metadata and reported them as 0×0; the compositor's 0/0 aspect
 *   (NaN) was uploaded once and never replaced, because the uniform change check missed
 *   NaN (src/engine/pipeline/compositor/uniforms.ts, src/engine/render/compositeSourceSize.ts,
 *   src/engine/render/nestedComp/htmlVideoPreview.ts).
 * - EXPORT_REVERSE_OFF_BY_ONE: the Fast export showed source frame 120 − N instead of
 *   119 − N for a reversed clip. Frame selection picked the nearest timestamp instead
 *   of the frame whose half-open interval contains the time
 *   (src/engine/parallelDecode/presentationFrame.ts).
 * - EXPORT_STALE_LAYER_FRAMES: with about a dozen video layers the Fast export showed a
 *   neighbouring source frame on some layers (clock 59 at frames 60-62). Parallel
 *   decode counted a neighbour within three frames as ready and returned it; it now
 *   waits for the exact frame and counts any substitution as a previous-frame fallback.
 */
const DEFECT = {
  exportStaleLayerFrames: 'EXPORT_STALE_LAYER_FRAMES: Fast export shows a neighbouring source frame on some video layers without counting a fallback',
} as const

/**
 * Stale frames (each within ±10 source frames of the expected one) a tile's export
 * case would tolerate and annotate as EXPORT_STALE_LAYER_FRAMES. The defect is fixed,
 * so the budget is 0 and every stale frame fails its tile; raise it only together
 * with a newly found, named defect.
 */
const KNOWN_STALE_FRAME_BUDGET = 0

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
  await judge(mosaic, testInfo, 'T11b', 'preview')
})

test('T11b reverse in the export: source frame 119-N @module:export @tier:nightly', async ({ mosaic }, testInfo) => {
  await judge(mosaic, testInfo, 'T11b', 'export')
})
