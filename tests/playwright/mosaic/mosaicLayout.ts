import { FRAME_CODE_LAYOUT, FRAME_CODE_V2, type FrameCodeChart } from '../fixtures/frameCodeMedia'

/**
 * The mosaic: one composition whose regions each test one editor feature, all
 * active in every frame (design: the "Mosaik-Testprojekt", MVP with six tiles).
 * Every coordinate is in composition pixels and a multiple of 16, so H.264
 * macroblocks never straddle a tile and its guard band. This file is the single
 * source of truth for the build (mosaicBuild.ts) and the oracles
 * (mosaicOracle.ts): geometry, sources and the expected value per frame.
 */
export const MOSAIC = {
  width: 1920,
  height: 1080,
  fps: 30,
  seconds: 4,
  /** Background solid on the lowest track; every guard band must show it. */
  guard: 48,
  /** C1, the video clock: a frame-code strip whose number is the composition frame. */
  clock: { x: 16, y: 8, width: 928, height: 32 },
  /** C2, the keyframe clock: a white bar moved by two linear position keys, left edge at x0 + step·N. */
  ruler: { x0: 976, step: 7, y: 8, width: 6, height: 32 },
  /** Tile grid: 5 × 4 cells of 384 × 256 from y 48; the content box is the cell inset by 16 px. */
  cell: { width: 384, height: 256, top: 48, inset: 16 },
  box: { width: 352, height: 224 },
} as const

export const FRAMES = MOSAIC.fps * MOSAIC.seconds
export const LAST_FRAME = FRAMES - 1
/** Paused checkpoints: start, first step, a second boundary, mid-points and the last frame. */
export const CHECK_FRAMES = [0, 1, 29, 45, 59, 60, 89, LAST_FRAME] as const

export type TileId = 'T01' | 'T03' | 'T04' | 'T06' | 'T09' | 'T09b' | 'T11'

export interface Rect { x: number; y: number; width: number; height: number }

export function boxOf(column: number, row: number): Rect {
  const { cell, box } = MOSAIC
  return { x: column * cell.width + cell.inset, y: cell.top + row * cell.height + cell.inset, width: box.width, height: box.height }
}

export const TILE_CELLS: Record<TileId, { column: number; row: number }> = {
  T01: { column: 0, row: 0 },
  T03: { column: 2, row: 0 },
  T04: { column: 3, row: 0 },
  T06: { column: 0, row: 1 },
  T09: { column: 3, row: 1 },
  T09b: { column: 4, row: 1 },
  T11: { column: 0, row: 2 },
}

/** Generated sources (fixtures/frameCodeMedia.ts, v2). The identity row carries `id`. */
export const SOURCES = {
  clock: { sourceId: 0, chart: 'strip', width: 928, height: 32, fps: 30, seconds: 4 },
  t01: { sourceId: 1, chart: 'tile', width: 352, height: 224, fps: 30, seconds: 4 },
  t03: { sourceId: 3, chart: 'tile', width: 352, height: 224, fps: 30, seconds: 4 },
  t04: { sourceId: 4, chart: 'compact', width: 352, height: 112, fps: 30, seconds: 4 },
  t06: { sourceId: 6, chart: 'tile', width: 352, height: 224, fps: 30, seconds: 4 },
  t09inner: { sourceId: 9, chart: 'tile', width: 352, height: 224, fps: 60, seconds: 8 },
  t09outer: { sourceId: 10, chart: 'strip', width: 352, height: 32, fps: 30, seconds: 4 },
  t09bInner: { sourceId: 13, chart: 'tile', width: 352, height: 224, fps: 60, seconds: 8 },
  t09bOuter: { sourceId: 14, chart: 'strip', width: 352, height: 32, fps: 30, seconds: 4 },
  t11fast: { sourceId: 11, chart: 'compact', width: 352, height: 112, fps: 30, seconds: 8 },
  t11reverse: { sourceId: 12, chart: 'compact', width: 352, height: 112, fps: 30, seconds: 4 },
} as const satisfies Record<string, { sourceId: number; chart: FrameCodeChart; width: number; height: number; fps: number; seconds: number }>

export type SourceKey = keyof typeof SOURCES

/** Centered composition pixels (setTransform/addKeyframe position units) of a rect's centre. */
export function centered(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2 - MOSAIC.width / 2, y: rect.y + rect.height / 2 - MOSAIC.height / 2 }
}

// ── Tile parameters and per-frame expectations ────────────────────────────────

/** T03: scale 0.75; x linear and y ease-in-out between the keys at frame 0 and the last frame. */
export const T03 = { scale: 0.75, keyEnd: LAST_FRAME / MOSAIC.fps } as const

/**
 * Preset ease-in-out without handles is the piecewise quadratic in
 * src/utils/keyframeInterpolation.ts:18, applied at :313 (`easingFunctions[easing](t)`);
 * the bridge stores `easing: 'ease-in-out'` without handles
 * (src/services/aiTools/handlers/keyframes.ts, parseEasing).
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

export function t03Rect(frame: number): Rect {
  const box = boxOf(TILE_CELLS.T03.column, TILE_CELLS.T03.row)
  const width = MOSAIC.box.width * T03.scale, height = MOSAIC.box.height * T03.scale
  const u = Math.min(1, Math.max(0, frame / LAST_FRAME))
  const left = box.x + (box.width - width) * u
  const top = box.y + (box.height - height) * easeInOut(u)
  return { x: left, y: top, width, height }
}

/** T04: three layers. L1 red solid (left 2/3, full height), L2 green solid at 0.5 (right 2/3, lower half), L3 code clip on top (upper half) with opacity keyed 1 → 0.4. */
export const T04 = {
  red: [200, 0, 0] as const,
  green: [0, 200, 0] as const,
  greenOpacity: 0.5,
  opacityStart: 1,
  opacityEnd: 0.4,
  /** In box pixels. */
  l1: { x: 0, y: 0, width: 234, height: 224 },
  l2: { x: 117, y: 112, width: 235, height: 112 },
  l3: { x: 0, y: 0, width: 352, height: 112 },
} as const

export function t04Opacity(frame: number): number {
  const u = Math.min(1, Math.max(0, frame / LAST_FRAME))
  return T04.opacityStart + (T04.opacityEnd - T04.opacityStart) * u
}

/**
 * T06: rectangle mask (clip UV) with feather 30. The mask texture is rendered at
 * the engine output size and blurred with Canvas2D `blur(feather px)`
 * (src/utils/maskRenderer.ts:314; size from src/hooks/engine/useEngineMaskTextureSync.ts:175-188,
 * export src/engine/export/ExportMaskTextures.ts:132), then sampled in layer UV
 * (src/shaders/composite.wgsl:529-538). The edge is therefore a Gaussian step with
 * σ = feather × displayed clip size / composition size per axis.
 */
export const T06 = {
  feather: 30,
  vertices: [{ x: 0.04, y: -0.2 }, { x: 0.96, y: -0.2 }, { x: 0.96, y: 0.92 }, { x: 0.04, y: 0.92 }],
} as const

export function t06Edges(box: Rect): { left: number; right: number; bottom: number; sigmaX: number; sigmaY: number } {
  return {
    left: box.x + T06.vertices[0].x * box.width,
    right: box.x + T06.vertices[1].x * box.width,
    bottom: box.y + T06.vertices[2].y * box.height,
    sigmaX: T06.feather * box.width / MOSAIC.width,
    sigmaY: T06.feather * box.height / MOSAIC.height,
  }
}

/** Distance between the 10 % and 90 % points of a Gaussian step: 2 · 1.28155 · σ. */
export const GAUSS_10_90 = 2.5631

/**
 * T09: a 60 fps composition nested in the 30 fps mosaic with in-point 1.0 s. T09a nests a
 * 352×224 composition (the size of its content); T09b nests a composition of the
 * mosaic's size whose clip sits at the T09b box, so the timing is measured even when
 * a size-dependent nested defect hides T09a's content.
 * Composition clip time = in + local (src/services/layerBuilder/FrameContext.ts:490-502),
 * inner clip time = that − inner start (layerBuilderNestedLayerBuilder.ts:187),
 * source time through videoFrameSourceTime (layerBuilderNestedSourceTiming.ts:10-17).
 */
export const T09 = { innerFps: 60, inPoint: 1, stripTop: 190 } as const

export function t09InnerFrame(frame: number): number {
  return Math.round((T09.inPoint + frame / MOSAIC.fps) * T09.innerFps)
}

/**
 * T11: speed 2 (upper half) and reverse (lower half). Source time = in + speed·local
 * (src/services/timeline/retime/clipRetime.ts:138-139), bounded (:154), mirrored for
 * reverse as in + out − bounded (:161); a reverse sample moves back by
 * BACKWARD_FRAME_EPSILON (:171, :180) so an exact boundary selects the frame left of it.
 */
export const T11 = { speed: 2, reverseOut: 4 } as const

export function t11FastFrame(frame: number): number {
  return T11.speed * frame
}

export function t11ReverseFrame(frame: number): number {
  return Math.floor((T11.reverseOut - frame / MOSAIC.fps - 1e-5) * MOSAIC.fps)
}

export function rulerLeft(frame: number): number {
  return MOSAIC.ruler.x0 + MOSAIC.ruler.step * frame
}

/** The v1 colour bars that every tile chart repeats; expected values for the reference tile. */
export const BAR_COLOURS = FRAME_CODE_LAYOUT.bars
export const TILE_CHART = FRAME_CODE_V2.charts.tile
export const COMPACT_CHART = FRAME_CODE_V2.charts.compact
