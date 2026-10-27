import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Browser } from '@playwright/test'
import sharp from 'sharp'
import { streamVideoFrames, type FramePixels } from '../assertions/frameCodeOracle'
import { DEFAULT_REPO_ROOT } from '../fixtures/bridgeClient'
import { openFrameCodeProject, type FrameCodeProject } from '../fixtures/frameCodeProject'
import { ExportDriver } from '../drivers/ExportDriver'
import { buildMosaic, generateMosaicSources, readClipDetails } from './mosaicBuild'
import { CHECK_FRAMES, FRAMES, MOSAIC } from './mosaicLayout'
import { IDENTITY_MAPPING, evaluateAll, evaluateClock, tileRect, type Mapping, type MosaicSource, type MosaicTile, type TileResult } from './mosaicOracle'

const run = promisify(execFile)

/**
 * One mosaic run: build once through the Dev Bridge, read the paused preview at
 * every checkpoint frame, export once and decode it in Node. The results are
 * cached per Playwright run (keyed by the runner process), so a worker that
 * restarts after a red case reads them back instead of rebuilding.
 */
export interface MosaicResults {
  preview: TileResult[]
  export: TileResult[]
  previewError?: string
  exportError?: string
  /** Per checkpoint: how long the preview needed to settle on the frame, and what it showed meanwhile. */
  settle: Array<{ frame: number; ms: number; settled: boolean; seen: string; flat: string[] }>
  exportInfo?: { frames: number; width: number; height: number; previousFrameFallbacks: number | null; seconds: number }
  build?: Record<string, { startTime: number; duration: number; inPoint: number; outPoint: number; speed?: number; reversed?: boolean }>
  /** Evidence crops: `${source}-${tile}` → file in `dir`. */
  crops: Record<string, string>
  dir: string
  previewPicture?: string
}

export const MVP_PREVIEW_COPY = '/tmp/claude-1000/-home-admins-Documents-MasterSelects-Public/1c56a32e-e801-4fe4-be78-c6d209504d28/scratchpad/mosaic-test/mvp-preview.png'
const SETTLE_TIMEOUT_MS = 15_000
/** How long a tile may stay empty while the rest of the preview holds still before it counts as empty. */
const FLAT_GRACE_MS = 3_000

export async function mosaicResults(browser: Browser, baseURL: string | undefined): Promise<MosaicResults> {
  const dir = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'mosaic', `run-${process.ppid}`)
  const cache = path.join(dir, 'results.json')
  if (await access(cache).then(() => true, () => false)) return JSON.parse(await readFile(cache, 'utf8')) as MosaicResults
  await mkdir(dir, { recursive: true })
  const results: MosaicResults = { preview: [], export: [], settle: [], crops: {}, dir }
  const sources = await generateMosaicSources()
  const project = await openFrameCodeProject(browser, baseURL, { composition: 'Mosaic', placeClip: false,
    size: { width: MOSAIC.width, height: MOSAIC.height, fps: MOSAIC.fps, seconds: MOSAIC.seconds } })
  try {
    const build = await buildMosaic(project.bridge, sources)
    await project.editor.waitForProjectIdle(30_000)
    results.build = await readClipDetails(project.bridge, build)
    try { await measurePreview(project, results) } catch (error) { results.previewError = String(error) }
    try { await measureExport(project, results) } catch (error) { results.exportError = String(error) }
  } finally {
    await writeFile(cache, JSON.stringify(results, null, 1))
    await project.context.close()
  }
  return results
}

function mappingOf(box: { x: number; y: number; width: number; height: number }): Mapping {
  // The screenshot starts at the box's whole-pixel origin; the canvas itself starts at the fraction.
  return { scaleX: box.width / MOSAIC.width, scaleY: box.height / MOSAIC.height, offsetX: box.x - Math.floor(box.x), offsetY: box.y - Math.floor(box.y) }
}

/**
 * Seeks to every checkpoint (arrangement through the bridge) and waits, by pixels,
 * until C1 shows the frame and every tile reads the same twice in a row. No
 * sleeps: each read is a fresh screenshot of the preview canvas.
 */
async function measurePreview(project: FrameCodeProject, results: MosaicResults): Promise<void> {
  const { bridge, probe } = project
  for (const frame of CHECK_FRAMES) {
    await bridge.toolData('setPlayhead', { time: frame / MOSAIC.fps })
    const started = Date.now(), seen: string[] = []
    let previous = '', stableSince = 0, last: { pixels: FramePixels; map: Mapping; tiles: TileResult[] } | null = null, settled = false, flat: string[] = []
    while (Date.now() - started < SETTLE_TIMEOUT_MS) {
      const box = await probe.canvas.boundingBox()
      if (!box) { seen.push('no preview'); continue }
      const pixels = await probe.capture(), map = mappingOf(box)
      const clock = evaluateClock(pixels, map, 'preview', frame)
      const shown = String(clock.checks[0].measured)
      if (seen.at(-1) !== shown) seen.push(shown)
      if (!clock.checks[0].ok) { previous = ''; continue }
      const tiles = evaluateAll(pixels, map, 'preview', frame)
      const signature = JSON.stringify(tiles.map(tile => tile.checks.filter(check => / (frame|source)$/.test(check.name)).map(check => check.measured)))
      flat = tiles.filter(tile => tile.checks.some(check => / frame$/.test(check.name) && String(check.measured).startsWith('unreadable (flat'))).map(tile => tile.tile)
      last = { pixels, map, tiles }
      if (signature !== previous) { previous = signature; stableSince = Date.now(); continue }
      // Stable twice. An empty (flat) tile may still be loading: wait for it, but a tile that stays
      // empty while everything else holds still for FLAT_GRACE_MS is judged as it is.
      if (!flat.length || Date.now() - stableSince >= FLAT_GRACE_MS) { settled = true; break }
    }
    results.settle.push({ frame, ms: Date.now() - started, settled, seen: seen.slice(-8).join(' → '), flat })
    if (!last) throw new Error(`The preview never showed frame ${frame} in C1 within ${SETTLE_TIMEOUT_MS} ms (seen: ${seen.slice(-8).join(' → ')})`)
    results.preview.push(...last.tiles)
    for (const tile of last.tiles.filter(entry => !entry.ok)) await saveCrop(results, 'preview', tile.tile, frame, last.pixels, last.map)
    if (frame === 45) {
      results.previewPicture = path.join(results.dir, 'mosaic-preview-frame45.png')
      await sharp(Buffer.from(last.pixels.data), { raw: { width: last.pixels.width, height: last.pixels.height, channels: 3 } }).png().toFile(results.previewPicture)
      await copyFile(results.previewPicture, MVP_PREVIEW_COPY).catch(() => undefined)
    }
  }
}

/** One Fast (WebCodecs) export of the whole mosaic through the Export panel, decoded frame by frame in Node. */
async function measureExport(project: FrameCodeProject, results: MosaicResults): Promise<void> {
  const exporter = new ExportDriver(project.page)
  await exporter.open()
  await exporter.selectFastWebCodecs()
  await exporter.useCompositionSettings()
  await exporter.useFullTimeline()
  await exporter.setFilename('mosaic')
  const file = path.join(results.dir, 'mosaic.mp4'), started = Date.now()
  await exporter.exportTo(file, 300_000)
  const seconds = (Date.now() - started) / 1000
  const stats = await project.bridge.toolData<{ export?: { last?: { previousFrameFallbacks?: number; seeks?: { previousFrameFallbacks?: number } } } }>('getStats')
  const last = stats.export?.last
  const firstFailure = new Map<MosaicTile, { frame: number; pixels: FramePixels }>()
  const decoded = await streamVideoFrames(file, (pixels, index) => {
    const tiles = evaluateAll(pixels, IDENTITY_MAPPING, 'export', index)
    results.export.push(...tiles)
    for (const tile of tiles) {
      if (!tile.ok && !firstFailure.has(tile.tile)) firstFailure.set(tile.tile, { frame: index, pixels: { ...pixels, data: Uint8Array.from(pixels.data) } })
    }
  })
  results.exportInfo = { frames: decoded.frames, width: decoded.width, height: decoded.height, seconds,
    previousFrameFallbacks: last?.previousFrameFallbacks ?? last?.seeks?.previousFrameFallbacks ?? null }
  for (const [tile, { frame, pixels }] of firstFailure) await saveCrop(results, 'export', tile, frame, pixels, IDENTITY_MAPPING)
  if (decoded.frames !== FRAMES) throw new Error(`The export holds ${decoded.frames} frames, expected ${FRAMES}`)
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,r_frame_rate', '-of', 'csv=p=0', file])
  if (!stdout.includes(`${MOSAIC.fps}/1`)) throw new Error(`The export runs at ${stdout.trim()}, expected ${MOSAIC.fps} fps`)
}

async function saveCrop(results: MosaicResults, source: MosaicSource, tile: MosaicTile, frame: number, pixels: FramePixels, map: Mapping): Promise<void> {
  const key = `${source}-${tile}`
  if (results.crops[key]) return
  const rect = tileRect(tile), margin = 16
  const left = Math.max(0, Math.floor(map.offsetX + (rect.x - margin) * map.scaleX)), top = Math.max(0, Math.floor(map.offsetY + (rect.y - margin) * map.scaleY))
  const width = Math.min(pixels.width - left, Math.ceil((rect.width + 2 * margin) * map.scaleX)), height = Math.min(pixels.height - top, Math.ceil((rect.height + 2 * margin) * map.scaleY))
  const file = path.join(results.dir, `${key}-frame${frame}.png`)
  await sharp(Buffer.from(pixels.data), { raw: { width: pixels.width, height: pixels.height, channels: 3 } })
    .extract({ left, top, width, height }).png().toFile(file)
  results.crops[key] = file
}
