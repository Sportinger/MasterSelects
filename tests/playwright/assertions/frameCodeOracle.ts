import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { FRAME_CODE_LAYOUT, FRAME_CODE_V2, type FrameCodeChart, type FrameCodeChartLayout } from '../fixtures/frameCodeMedia'

const run = promisify(execFile)

/**
 * Reads the frame number a frame-code clip (fixtures/frameCodeMedia.ts) shows,
 * from raw pixels: the preview's output or a decoded export frame. A flat or
 * black image, a blend of two frames and a misread all come back as invalid,
 * never as a wrong number. An inverted image (the Invert effect) still reads
 * its number and reports `inverted`.
 */
export interface FramePixels {
  width: number
  height: number
  /** 3 (RGB) or 4 (RGBA) bytes per pixel, row-major. */
  channels: 3 | 4
  data: Uint8Array
}

/** Where the clip sits inside the frame, in pixels; default: the whole frame. */
export interface ClipRegion { x: number; y: number; width: number; height: number }

export interface FrameCodeReading {
  frame: number | null
  valid: boolean
  inverted: boolean
  /** Luma difference between the darkest and brightest block; low means a flat or black frame. */
  contrast: number
  bits: number[]
  reason?: 'flat' | 'blend' | 'checksum'
}

const MIN_CONTRAST = 60
// A block between 15 % and 85 % of the black-to-white range is neither: the
// image blends two frames (crossfade, mid-update, temporal smoothing).
const CLEAR_MARGIN = 0.15

function regionOf(pixels: FramePixels, region?: ClipRegion): ClipRegion {
  return region ?? { x: 0, y: 0, width: pixels.width, height: pixels.height }
}

/** Mean RGB of a rectangle given in fractions of the clip region. */
function meanRgb(pixels: FramePixels, region: ClipRegion, left: number, top: number, right: number, bottom: number): [number, number, number] {
  const x0 = Math.max(0, Math.floor(region.x + region.width * left)), x1 = Math.min(pixels.width, Math.ceil(region.x + region.width * right))
  const y0 = Math.max(0, Math.floor(region.y + region.height * top)), y1 = Math.min(pixels.height, Math.ceil(region.y + region.height * bottom))
  let r = 0, g = 0, b = 0, count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * pixels.width + x) * pixels.channels
      r += pixels.data[offset]; g += pixels.data[offset + 1]; b += pixels.data[offset + 2]; count++
    }
  }
  return count ? [r / count, g / count, b / count] : [0, 0, 0]
}

const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b

export function checkNibble(frame: number): number {
  return 15 - (((frame & 15) + ((frame >> 4) & 15) + ((frame >> 8) & 15)) % 16)
}

function decodeBits(bits: number[]): number | null {
  const { numberBits } = FRAME_CODE_LAYOUT
  const frame = bits.slice(0, numberBits).reduce((sum, bit, index) => sum + bit * 2 ** index, 0)
  const check = bits.slice(numberBits).reduce((sum, bit, index) => sum + bit * 2 ** index, 0)
  return check === checkNibble(frame) ? frame : null
}

export function readFrameCode(pixels: FramePixels, region?: ClipRegion): FrameCodeReading {
  return readCodeRow(pixels, regionOf(pixels, region), { inset: 0, band: FRAME_CODE_LAYOUT.codeBand }, decodeBits)
}

/** Reads 16 black/white cells in `band` (fractions of the region height) between the horizontal inset. */
function readCodeRow(pixels: FramePixels, area: ClipRegion, { inset, band }: { inset: number; band: readonly [number, number] },
  decode: (bits: number[]) => number | null): FrameCodeReading {
  const { blocks } = FRAME_CODE_LAYOUT
  const [bandTop, bandBottom] = band, bandHeight = bandBottom - bandTop, span = 1 - 2 * inset
  // The middle of each block only: scaling and chroma bleed stay at the edges.
  const levels = Array.from({ length: blocks }, (_, k) => luma(meanRgb(pixels, area,
    inset + span * (k + 0.3) / blocks, bandTop + bandHeight * 0.25, inset + span * (k + 0.7) / blocks, bandTop + bandHeight * 0.75)))
  const low = Math.min(...levels), high = Math.max(...levels), contrast = high - low
  if (contrast < MIN_CONTRAST) return { frame: null, valid: false, inverted: false, contrast, bits: [], reason: 'flat' }
  if (levels.some(level => level > low + contrast * CLEAR_MARGIN && level < high - contrast * CLEAR_MARGIN)) {
    return { frame: null, valid: false, inverted: false, contrast, bits: [], reason: 'blend' }
  }
  const threshold = (low + high) / 2
  const bits = levels.map(level => level > threshold ? 1 : 0)
  const frame = decode(bits)
  if (frame !== null) return { frame, valid: true, inverted: false, contrast, bits }
  const flipped = decode(bits.map(bit => 1 - bit))
  if (flipped !== null) return { frame: flipped, valid: true, inverted: true, contrast, bits }
  return { frame: null, valid: false, inverted: false, contrast, bits, reason: 'checksum' }
}

/** Frame row of a v2 chart (fixtures/frameCodeMedia.ts, FRAME_CODE_V2) inside `region`. */
export function readFrameCodeV2(pixels: FramePixels, region: ClipRegion, chart: FrameCodeChart = 'tile'): FrameCodeReading {
  const layout: FrameCodeChartLayout = FRAME_CODE_V2.charts[chart]
  return readCodeRow(pixels, region, { inset: layout.inset, band: layout.frameRow }, decodeBits)
}

export interface IdentityReading { sourceId: number | null; variant: number | null; valid: boolean; inverted: boolean; reason?: FrameCodeReading['reason'] }

/** Identity row of a v2 chart: which generated source this region shows. */
export function readIdentity(pixels: FramePixels, region: ClipRegion, chart: FrameCodeChart = 'tile'): IdentityReading {
  const layout: FrameCodeChartLayout = FRAME_CODE_V2.charts[chart]
  if (!layout.identityRow) throw new Error(`chart ${chart} has no identity row`)
  const reading = readCodeRow(pixels, region, { inset: layout.inset, band: layout.identityRow }, decodeBits)
  if (!reading.valid || reading.frame === null) return { sourceId: null, variant: null, valid: false, inverted: false, reason: reading.reason }
  return { sourceId: reading.frame & 255, variant: reading.frame >> 8, valid: true, inverted: reading.inverted }
}

/** Mean RGB of an absolute pixel rectangle [x0, x1) × [y0, y1), clipped to the image. */
export function meanRgbRect(pixels: FramePixels, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  return meanRgb(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height },
    x0 / pixels.width, y0 / pixels.height, x1 / pixels.width, y1 / pixels.height)
}

export interface EdgeReading {
  /** Position of the 50 % crossing along the scan, in pixels from its start; null without a clear step. */
  position: number | null
  /** Distance between the 10 % and 90 % crossings, in pixels. */
  width: number | null
  low: number
  high: number
}

/**
 * Locates one step edge along a horizontal or vertical scan line of `channel`
 * values (0-2, or 'luma'), averaged over `thickness` pixels across the scan. The
 * plateaus are the first and last `plateau` samples; the crossings are
 * interpolated linearly between samples, so the result is sub-pixel.
 */
export function readEdge(pixels: FramePixels, scan: { axis: 'x' | 'y'; at: number; from: number; to: number; thickness?: number; plateau?: number },
  channel: 0 | 1 | 2 | 'luma' = 'luma'): EdgeReading {
  const { axis, at, from, to, thickness = 3, plateau = 3 } = scan
  const step = to >= from ? 1 : -1, values: number[] = []
  for (let position = from; step > 0 ? position <= to : position >= to; position += step) {
    let sum = 0, count = 0
    for (let across = Math.round(at - (thickness - 1) / 2); across <= Math.round(at + (thickness - 1) / 2); across++) {
      const x = axis === 'x' ? position : across, y = axis === 'x' ? across : position
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) continue
      const offset = (y * pixels.width + x) * pixels.channels
      const rgb: [number, number, number] = [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]]
      sum += channel === 'luma' ? luma(rgb) : rgb[channel]; count++
    }
    values.push(count ? sum / count : 0)
  }
  const average = (list: number[]) => list.reduce((total, value) => total + value, 0) / Math.max(1, list.length)
  const start = average(values.slice(0, plateau)), end = average(values.slice(-plateau))
  const low = Math.min(start, end), high = Math.max(start, end)
  if (high - low < 20) return { position: null, width: null, low, high }
  const crossing = (fraction: number): number | null => {
    const level = start + (end - start) * fraction
    for (let index = 1; index < values.length; index++) {
      const a = values[index - 1] - level, b = values[index] - level
      if (a === 0) return index - 1
      if (Math.sign(a) !== Math.sign(b)) return index - 1 + a / (a - b)
    }
    return null
  }
  const half = crossing(0.5), ten = crossing(0.1), ninety = crossing(0.9)
  return { position: half, width: ten !== null && ninety !== null ? Math.abs(ninety - ten) : null, low, high }
}

export interface BarReading { name: string; expected: readonly [number, number, number]; measured: [number, number, number] }

/** Mean colour in the middle of each of the six bars. */
export function readColorBars(pixels: FramePixels, region?: ClipRegion): BarReading[] {
  const area = regionOf(pixels, region), { bars, barBand } = FRAME_CODE_LAYOUT
  const [top, bottom] = barBand, height = bottom - top
  return bars.map((bar, index) => ({ name: bar.name, expected: bar.rgb,
    measured: meanRgb(pixels, area, (index + 0.25) / bars.length, top + height * 0.25, (index + 0.75) / bars.length, top + height * 0.75) }))
}

/** Largest channel difference between the measured bars and `expected(bar)`. */
export function barDeviation(readings: BarReading[], expected: (bar: BarReading) => readonly [number, number, number]): number {
  return Math.max(...readings.flatMap(bar => bar.measured.map((value, channel) => Math.abs(value - expected(bar)[channel]))))
}

export interface VideoFrameCodes { width: number; height: number; readings: FrameCodeReading[] }

/**
 * Decodes every frame of a video file with ffmpeg (outside the browser under
 * test) and reads its frame code. Frames are scaled to `scaleWidth` first so
 * long or large exports stay cheap; the code blocks survive any sane scale.
 */
export async function readVideoFrameCodes(file: string, { scaleWidth = 320 }: { scaleWidth?: number } = {}): Promise<VideoFrameCodes> {
  const readings: FrameCodeReading[] = []
  const { width, height } = await streamVideoFrames(file, pixels => { readings.push(readFrameCode(pixels)) }, { scaleWidth })
  return { width, height, readings }
}

/**
 * Streams every decoded frame of a video file (ffmpeg in Node, RGB, in
 * presentation order) to `onFrame`. `scaleWidth` downsizes first; leave it out
 * to read the file at its own resolution.
 */
export async function streamVideoFrames(file: string, onFrame: (pixels: FramePixels, index: number) => void,
  { scaleWidth }: { scaleWidth?: number } = {}): Promise<{ width: number; height: number; frames: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file])
  const stream = (JSON.parse(stdout) as { streams: Array<{ width: number; height: number }> }).streams[0]
  if (!stream) throw new Error(`${file} has no video stream`)
  const width = scaleWidth ? Math.min(scaleWidth, stream.width) : stream.width
  const height = scaleWidth ? Math.round(stream.height * width / stream.width / 2) * 2 : stream.height
  const frameSize = width * height * 3
  let index = 0
  await new Promise<void>((resolve, reject) => {
    const scale = width === stream.width && height === stream.height ? [] : ['-vf', `scale=${width}:${height}:flags=area`]
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, ...scale, '-vsync', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0), errors = ''
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      while (pending.length >= frameSize) {
        onFrame({ width, height, channels: 3, data: pending.subarray(0, frameSize) }, index++)
        pending = pending.subarray(frameSize)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('ffmpeg is not installed on this test host') : error))
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg could not decode ${file}: ${errors.trim().slice(0, 400)}`)))
  })
  return { width, height, frames: index }
}

export interface SequenceReport { ok: boolean; frames: Array<number | null>; problems: string[] }

/**
 * Checks that the readings are exactly `from`, `from + 1`, … for `count`
 * frames: every frame readable, none missing, doubled or out of order.
 */
export function checkFrameSequence(readings: FrameCodeReading[], { from, count }: { from: number; count: number }): SequenceReport {
  const frames = readings.map(reading => reading.frame), problems: string[] = []
  if (frames.length !== count) problems.push(`expected ${count} frames, the file has ${frames.length}`)
  frames.forEach((frame, index) => {
    if (frame === null) problems.push(`frame ${index}: unreadable (${readings[index].reason}, contrast ${Math.round(readings[index].contrast)})`)
    else if (frame !== from + index) {
      const previous = frames[index - 1]
      problems.push(`frame ${index}: shows source frame ${frame}, expected ${from + index}${previous === frame ? ' (repeated)' : ''}`)
    }
  })
  return { ok: problems.length === 0, frames, problems: problems.slice(0, 20) }
}
