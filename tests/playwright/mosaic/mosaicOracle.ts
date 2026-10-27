import { meanRgbRect, readEdge, readFrameCodeV2, readIdentity, type ClipRegion, type FramePixels } from '../assertions/frameCodeOracle'
import type { FrameCodeChart } from '../fixtures/frameCodeMedia'
import {
  BAR_COLOURS, COMPACT_CHART, GAUSS_10_90, MOSAIC, SOURCES, T04, T09, TILE_CELLS, TILE_CHART, boxOf, rulerLeft,
  t03Rect, t04Opacity, t06Edges, t09InnerFrame, t11FastFrame, t11ReverseFrame, type Rect, type SourceKey,
} from './mosaicLayout'

/**
 * Per-tile oracles of the mosaic. Every function reads one region of one frame
 * (a preview screenshot or a decoded export frame) and compares it with the
 * value mosaicLayout.ts expects for composition frame N. Pixels map from
 * composition coordinates by `pixel = offset + comp · scale`.
 */
export type MosaicSource = 'preview' | 'export'

export interface Mapping { scaleX: number; scaleY: number; offsetX: number; offsetY: number }
export const IDENTITY_MAPPING: Mapping = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }

export interface Check { name: string; ok: boolean; measured: unknown; expected: unknown; tolerance?: number | string }
export interface TileResult { tile: MosaicTile; source: MosaicSource; frame: number; ok: boolean; checks: Check[] }
export type MosaicTile = 'clock' | 'guards' | 'T01' | 'T03' | 'T04' | 'T06' | 'T09a' | 'T09b' | 'T11a' | 'T11b'

/**
 * Tolerances per source. Preview screenshots are display-scaled (about 0.5), so
 * an edge position is good to about one screen pixel = 2 composition pixels.
 * Colours: the export is H.264 4:2:0, which keeps flat, slowly changing areas as
 * skip blocks, so a saturated colour can lag its true value in steps of up to
 * about 10 levels per channel (seen on T04's fading magenta bar); it is judged by
 * luma (±6) plus a looser per-channel bound. Levels 0-255, composition pixels,
 * feather as a ratio of the expected 10-90 width.
 */
export const TOLERANCE: Record<MosaicSource, { colour: number; luma?: number; edge: number; guard: number; feather: number; centroid: number }> = {
  preview: { colour: 8, edge: 2, guard: 4, feather: 0.3, centroid: 1.5 },
  export: { colour: 14, luma: 6, edge: 1, guard: 4, feather: 0.25, centroid: 0.75 },
}

const toRegion = (rect: Rect, map: Mapping): ClipRegion => ({
  x: map.offsetX + rect.x * map.scaleX, y: map.offsetY + rect.y * map.scaleY, width: rect.width * map.scaleX, height: rect.height * map.scaleY,
})

const meanOf = (pixels: FramePixels, rect: Rect, map: Mapping): [number, number, number] => {
  const region = toRegion(rect, map)
  return meanRgbRect(pixels, region.x, region.y, region.x + region.width, region.y + region.height).map(value => Math.round(value * 10) / 10) as [number, number, number]
}

const luma709 = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function colourCheck(name: string, measured: readonly number[], expected: readonly number[], tolerance: number, luma?: number): Check {
  const deviation = Math.max(...measured.map((value, channel) => Math.abs(value - expected[channel])))
  const lumaOk = luma === undefined || Math.abs(luma709(measured) - luma709(expected)) <= luma
  return { name, ok: deviation <= tolerance && lumaOk, measured, expected: expected.map(value => Math.round(value * 10) / 10),
    tolerance: luma === undefined ? tolerance : `${tolerance} per channel, ${luma} luma` }
}

function frameChecks(prefix: string, pixels: FramePixels, rect: Rect, map: Mapping, chart: FrameCodeChart, expectedFrame: number, sourceId?: number): Check[] {
  const reading = readFrameCodeV2(pixels, toRegion(rect, map), chart)
  const checks: Check[] = [{ name: `${prefix} frame`, ok: reading.valid && !reading.inverted && reading.frame === expectedFrame,
    measured: reading.valid ? reading.frame : `unreadable (${reading.reason}, contrast ${Math.round(reading.contrast)})`, expected: expectedFrame }]
  if (sourceId !== undefined) {
    const identity = readIdentity(pixels, toRegion(rect, map), chart)
    checks.push({ name: `${prefix} source`, ok: identity.valid && identity.sourceId === sourceId,
      measured: identity.valid ? identity.sourceId : `unreadable (${identity.reason})`, expected: sourceId })
  }
  return checks
}

/** A step edge along a scan in composition coordinates; returns position and 10-90 width in composition pixels. */
function edgeCheck(name: string, pixels: FramePixels, map: Mapping, scan: { axis: 'x' | 'y'; at: number; from: number; to: number }, channel: 0 | 1 | 2 | 'luma',
  expected: number, tolerance: number, width?: { expected: number; ratio: number }): Check[] {
  const scale = scan.axis === 'x' ? map.scaleX : map.scaleY, offset = scan.axis === 'x' ? map.offsetX : map.offsetY
  const across = scan.axis === 'x' ? map.offsetY + scan.at * map.scaleY : map.offsetX + scan.at * map.scaleX
  const from = Math.round(offset + scan.from * scale), to = Math.round(offset + scan.to * scale)
  const edge = readEdge(pixels, { axis: scan.axis, at: across, from, to, thickness: Math.max(1, Math.round(3 * scale)), plateau: Math.max(2, Math.round(3 * scale)) }, channel)
  const direction = to >= from ? 1 : -1
  // Sample k is pixel from ± k, whose centre lies at +0.5 in continuous coordinates.
  const position = edge.position === null ? null : ((from + direction * edge.position + 0.5) - offset) / scale
  const checks: Check[] = [{ name: `${name} position`, ok: position !== null && Math.abs(position - expected) <= tolerance,
    measured: position === null ? `no step (levels ${Math.round(edge.low)}-${Math.round(edge.high)})` : Math.round(position * 100) / 100, expected, tolerance }]
  if (width) {
    const measured = edge.width === null ? null : edge.width / scale
    checks.push({ name: `${name} 10-90 width`, ok: measured !== null && Math.abs(measured - width.expected) <= width.expected * width.ratio,
      measured: measured === null ? 'none' : Math.round(measured * 100) / 100, expected: Math.round(width.expected * 100) / 100, tolerance: width.ratio })
  }
  return checks
}

/** Intensity-weighted centre of a bright bar along x, above `baseline`, in composition pixels. */
function barCentre(pixels: FramePixels, map: Mapping, y: number, from: number, to: number, baseline: number): number | null {
  const row = Math.round(map.offsetY + y * map.scaleY), x0 = Math.floor(map.offsetX + from * map.scaleX), x1 = Math.ceil(map.offsetX + to * map.scaleX)
  let weight = 0, sum = 0
  for (let x = Math.max(0, x0); x <= Math.min(pixels.width - 1, x1); x++) {
    const offset = (row * pixels.width + x) * pixels.channels
    const level = Math.max(0, (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]) / 3 - baseline - 20)
    weight += level; sum += level * (x + 0.5)
  }
  return weight > 0 ? (sum / weight - map.offsetX) / map.scaleX : null
}

/** The floor band row (fixtures/frameCodeMedia.ts, FRAME_CODE_V2 tile chart) where edges are measured. */
const FLOOR_ROW = (TILE_CHART.floorBand[0] + TILE_CHART.floorBand[1]) / 2

const result = (tile: MosaicTile, source: MosaicSource, frame: number, checks: Check[]): TileResult => ({ tile, source, frame, ok: checks.every(check => check.ok), checks })
const box = (tile: keyof typeof TILE_CELLS) => boxOf(TILE_CELLS[tile].column, TILE_CELLS[tile].row)
const inBox = (b: Rect, rect: Rect): Rect => ({ x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height })

/** Interior sample of bar `k` (or ramp step) of a chart placed at `rect`. */
function chartCell(rect: Rect, band: readonly [number, number], index: number, count: number): Rect {
  const width = rect.width / count, height = rect.height * (band[1] - band[0])
  return { x: rect.x + width * (index + 0.25), y: rect.y + rect.height * band[0] + height * 0.25, width: width * 0.5, height: height * 0.5 }
}

export function evaluateClock(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const checks = frameChecks('C1 video clock', pixels, MOSAIC.clock, map, 'strip', frame)
  const centre = barCentre(pixels, map, MOSAIC.ruler.y + MOSAIC.ruler.height / 2, rulerLeft(frame) - 20, rulerLeft(frame) + 26, MOSAIC.guard)
  const expected = rulerLeft(frame) + MOSAIC.ruler.width / 2
  checks.push({ name: 'C2 keyframe ruler centre', ok: centre !== null && Math.abs(centre - expected) <= TOLERANCE[source].centroid,
    measured: centre === null ? 'not found' : Math.round(centre * 100) / 100, expected, tolerance: TOLERANCE[source].centroid })
  return result('clock', source, frame, checks)
}

/**
 * Guard bands: the 16-px ring around every content box and every empty cell must
 * show the background. Strips sit 5-11 px from the box edge, split into eight
 * segments, so a bleed or a stray layer is located. Preview reads skip the
 * lowest strips, where the preview's own controls overlap the canvas.
 */
export function evaluateGuards(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const checks: Check[] = [], tolerance = TOLERANCE[source].guard, guard = [MOSAIC.guard, MOSAIC.guard, MOSAIC.guard]
  const built = new Set(Object.values(TILE_CELLS).map(cell => `${cell.column},${cell.row}`))
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 5; column++) {
      const b = boxOf(column, row), label = `cell ${column},${row}`
      const strips: Array<[string, Rect]> = [
        ['top', { x: b.x, y: b.y - 11, width: b.width, height: 6 }],
        ['left', { x: b.x - 11, y: b.y, width: 6, height: b.height }],
        ['right', { x: b.x + b.width + 5, y: b.y, width: 6, height: b.height }],
      ]
      if (row < 3 || source === 'export') strips.push(['bottom', { x: b.x, y: b.y + b.height + 5, width: b.width, height: 6 }])
      if (!built.has(`${column},${row}`)) strips.push(['inside (empty cell)', { x: b.x + 16, y: b.y + 16, width: b.width - 32, height: b.height - 32 }])
      for (const [side, strip] of strips) {
        const horizontal = strip.width >= strip.height
        const deviations = Array.from({ length: 8 }, (_, segment) => {
          const part: Rect = horizontal
            ? { x: strip.x + strip.width * segment / 8, y: strip.y, width: strip.width / 8, height: strip.height }
            : { x: strip.x, y: strip.y + strip.height * segment / 8, width: strip.width, height: strip.height / 8 }
          return meanOf(pixels, part, map)
        })
        const worst = deviations.reduce((a, b) => Math.max(...a.map((v, i) => Math.abs(v - guard[i]))) >= Math.max(...b.map((v, i) => Math.abs(v - guard[i]))) ? a : b)
        checks.push(colourCheck(`${label} ${side}`, worst, guard, tolerance))
      }
    }
  }
  return result('guards', source, frame, checks)
}

export function evaluateT01(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const b = box('T01'), tolerance = TOLERANCE[source]
  const checks = frameChecks('T01', pixels, b, map, 'tile', frame, SOURCES.t01.sourceId)
  BAR_COLOURS.forEach((bar, index) => checks.push(colourCheck(`T01 bar ${bar.name}`, meanOf(pixels, chartCell(b, TILE_CHART.barBand, index, 6), map), bar.rgb, tolerance.colour, tolerance.luma)))
  for (let step = 0; step < 8; step++) {
    const level = 16 + 30 * step
    checks.push(colourCheck(`T01 ramp step ${step}`, meanOf(pixels, chartCell(b, TILE_CHART.rampBand, step, 8), map), [level, level, level], tolerance.colour, tolerance.luma))
  }
  // Edges are measured in luma on the floor band: 4:2:0 video keeps only luma at full resolution.
  const floorY = b.y + b.height * FLOOR_ROW
  checks.push(...edgeCheck('T01 left edge', pixels, map, { axis: 'x', at: floorY, from: b.x - 10, to: b.x + 10 }, 'luma', b.x, tolerance.edge))
  checks.push(...edgeCheck('T01 right edge', pixels, map, { axis: 'x', at: floorY, from: b.x + b.width + 10, to: b.x + b.width - 10 }, 'luma', b.x + b.width, tolerance.edge))
  checks.push(...edgeCheck('T01 bottom edge', pixels, map, { axis: 'y', at: b.x + b.width * 0.7, from: b.y + b.height + 10, to: b.y + b.height - 10 }, 'luma', b.y + b.height, tolerance.edge))
  return result('T01', source, frame, checks)
}

export function evaluateT03(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const r = t03Rect(frame), tolerance = TOLERANCE[source]
  const checks = frameChecks('T03', pixels, r, map, 'tile', frame, SOURCES.t03.sourceId)
  const floorY = r.y + r.height * FLOOR_ROW
  checks.push(...edgeCheck('T03 left edge (x linear)', pixels, map, { axis: 'x', at: floorY, from: r.x - 10, to: r.x + 10 }, 'luma', r.x, tolerance.edge))
  checks.push(...edgeCheck('T03 right edge', pixels, map, { axis: 'x', at: floorY, from: r.x + r.width + 10, to: r.x + r.width - 10 }, 'luma', r.x + r.width, tolerance.edge))
  checks.push(...edgeCheck('T03 bottom edge (y ease-in-out)', pixels, map, { axis: 'y', at: r.x + r.width * 0.7, from: r.y + r.height + 10, to: r.y + r.height - 8 }, 'luma', r.y + r.height, tolerance.edge))
  return result('T03', source, frame, checks)
}

export function evaluateT04(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const b = box('T04'), tolerance = TOLERANCE[source], a = t04Opacity(frame), guard = [MOSAIC.guard, MOSAIC.guard, MOSAIC.guard]
  const l3 = inBox(b, T04.l3)
  const checks = frameChecks('T04 L3', pixels, l3, map, 'compact', frame, SOURCES.t04.sourceId)
  BAR_COLOURS.forEach((bar, index) => {
    const cell = chartCell(l3, COMPACT_CHART.barBand, index, 6)
    const under = cell.x + cell.width / 2 < b.x + T04.l1.width ? T04.red : guard
    checks.push(colourCheck(`T04 L3 bar ${bar.name} at opacity ${a.toFixed(3)}`, meanOf(pixels, cell, map), bar.rgb.map((value, channel) => a * value + (1 - a) * under[channel]), tolerance.colour, tolerance.luma))
  })
  const lower = (x0: number, x1: number): Rect => ({ x: b.x + x0, y: b.y + 128, width: x1 - x0, height: 80 })
  const mix = (top: readonly number[], opacity: number, under: readonly number[]) => top.map((value, channel) => opacity * value + (1 - opacity) * under[channel])
  checks.push(colourCheck('T04 L1 red alone', meanOf(pixels, lower(12, 105), map), T04.red, tolerance.colour, tolerance.luma))
  checks.push(colourCheck('T04 L2 green 0.5 over L1 red (layer order)', meanOf(pixels, lower(129, 222), map), mix(T04.green, T04.greenOpacity, T04.red), tolerance.colour, tolerance.luma))
  checks.push(colourCheck('T04 L2 green 0.5 over background', meanOf(pixels, lower(246, 340), map), mix(T04.green, T04.greenOpacity, guard), tolerance.colour, tolerance.luma))
  return result('T04', source, frame, checks)
}

export function evaluateT06(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const b = box('T06'), tolerance = TOLERANCE[source], edges = t06Edges(b), guard = [MOSAIC.guard, MOSAIC.guard, MOSAIC.guard]
  const checks = frameChecks('T06', pixels, b, map, 'tile', frame, SOURCES.t06.sourceId)
  for (const index of [1, 2, 3, 4]) {
    checks.push(colourCheck(`T06 inside, bar ${BAR_COLOURS[index].name}`, meanOf(pixels, chartCell(b, TILE_CHART.barBand, index, 6), map), BAR_COLOURS[index].rgb, tolerance.colour, tolerance.luma))
  }
  // Below the mask edge (2σ and more outside) the clip is transparent: the background shows.
  checks.push(colourCheck('T06 outside (below the mask edge)', meanOf(pixels, { x: b.x + 200, y: edges.bottom + 2.5 * edges.sigmaY, width: 120, height: b.y + b.height - edges.bottom - 2.5 * edges.sigmaY - 1 }, map), guard, tolerance.colour + 4, tolerance.luma))
  const widthX = { expected: GAUSS_10_90 * edges.sigmaX, ratio: tolerance.feather }, widthY = { expected: GAUSS_10_90 * edges.sigmaY, ratio: tolerance.feather }
  // All three edges cross the light floor band (luma 180 against the background's 48).
  const floorY = b.y + b.height * 0.88
  checks.push(...edgeCheck('T06 left mask edge', pixels, map, { axis: 'x', at: floorY, from: b.x - 6, to: b.x + 40 }, 'luma', edges.left, tolerance.edge, widthX))
  checks.push(...edgeCheck('T06 right mask edge', pixels, map, { axis: 'x', at: floorY, from: b.x + b.width + 6, to: b.x + b.width - 40 }, 'luma', edges.right, tolerance.edge, widthX))
  checks.push(...edgeCheck('T06 bottom mask edge', pixels, map, { axis: 'y', at: b.x + b.width * 0.3, from: b.y + b.height * 0.845, to: b.y + b.height + 12 }, 'luma', edges.bottom, tolerance.edge, widthY))
  return result('T06', source, frame, checks)
}

/** T09a: a 352×224 composition at 60 fps nested in the 1920×1080 mosaic; T09b: the same timing in a composition of the mosaic's size. */
export function evaluateT09(variant: 'T09a' | 'T09b', pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const b = variant === 'T09a' ? box('T09') : boxOf(4, 1)
  const inner: SourceKey = variant === 'T09a' ? 't09inner' : 't09bInner'
  const checks = frameChecks(`${variant} inner (60 fps)`, pixels, { ...b, height: b.height }, map, 'tile', t09InnerFrame(frame), SOURCES[inner].sourceId)
  checks.push(...frameChecks(`${variant} outer strip (30 fps)`, pixels, { x: b.x, y: b.y + T09.stripTop, width: b.width, height: 32 }, map, 'strip', frame))
  return result(variant, source, frame, checks)
}

export function evaluateT11(part: 'T11a' | 'T11b', pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult {
  const b = box('T11')
  const checks = part === 'T11a'
    ? frameChecks('T11a speed 2', pixels, { x: b.x, y: b.y, width: b.width, height: 112 }, map, 'compact', t11FastFrame(frame), SOURCES.t11fast.sourceId)
    : frameChecks('T11b reverse', pixels, { x: b.x, y: b.y + 112, width: b.width, height: 112 }, map, 'compact', t11ReverseFrame(frame), SOURCES.t11reverse.sourceId)
  return result(part, source, frame, checks)
}

export function evaluateAll(pixels: FramePixels, map: Mapping, source: MosaicSource, frame: number): TileResult[] {
  return [
    evaluateClock(pixels, map, source, frame),
    evaluateGuards(pixels, map, source, frame),
    evaluateT01(pixels, map, source, frame),
    evaluateT03(pixels, map, source, frame),
    evaluateT04(pixels, map, source, frame),
    evaluateT06(pixels, map, source, frame),
    evaluateT09('T09a', pixels, map, source, frame),
    evaluateT09('T09b', pixels, map, source, frame),
    evaluateT11('T11a', pixels, map, source, frame),
    evaluateT11('T11b', pixels, map, source, frame),
  ]
}

/** Region of a tile in composition pixels, for evidence crops. */
export function tileRect(tile: MosaicTile): Rect {
  switch (tile) {
    case 'clock': return { x: 0, y: 0, width: MOSAIC.width, height: 48 }
    case 'guards': return { x: 0, y: 0, width: MOSAIC.width, height: MOSAIC.height }
    case 'T03': return box('T03')
    case 'T09a': return box('T09')
    case 'T09b': return boxOf(4, 1)
    case 'T11a': case 'T11b': return box('T11')
    default: return box(tile)
  }
}

/** Short failure text: the first failing checks of the first failing frames. */
export function describeFailures(results: TileResult[], { limit = 6, total = results.length }: { limit?: number; total?: number } = {}): string {
  const failing = results.filter(entry => !entry.ok)
  if (!failing.length) return 'all checks passed'
  const lines = failing.slice(0, limit).map(entry => `${entry.source} frame ${entry.frame}: ` + entry.checks.filter(check => !check.ok).slice(0, 3)
    .map(check => `${check.name} = ${JSON.stringify(check.measured)}, expected ${JSON.stringify(check.expected)}${check.tolerance !== undefined ? ` ±${check.tolerance}` : ''}`).join('; '))
  return `${failing.length} of ${total} frames fail. ${lines.join(' | ')}`
}
