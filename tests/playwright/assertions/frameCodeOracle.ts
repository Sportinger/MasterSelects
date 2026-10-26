import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { FRAME_CODE_LAYOUT } from '../fixtures/frameCodeMedia'

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
  const area = regionOf(pixels, region), { blocks, codeBand } = FRAME_CODE_LAYOUT
  const [bandTop, bandBottom] = codeBand, bandHeight = bandBottom - bandTop
  // The middle of each block only: scaling and chroma bleed stay at the edges.
  const levels = Array.from({ length: blocks }, (_, k) => luma(meanRgb(pixels, area,
    (k + 0.3) / blocks, bandTop + bandHeight * 0.25, (k + 0.7) / blocks, bandTop + bandHeight * 0.75)))
  const low = Math.min(...levels), high = Math.max(...levels), contrast = high - low
  if (contrast < MIN_CONTRAST) return { frame: null, valid: false, inverted: false, contrast, bits: [], reason: 'flat' }
  if (levels.some(level => level > low + contrast * CLEAR_MARGIN && level < high - contrast * CLEAR_MARGIN)) {
    return { frame: null, valid: false, inverted: false, contrast, bits: [], reason: 'blend' }
  }
  const threshold = (low + high) / 2
  const bits = levels.map(level => level > threshold ? 1 : 0)
  const frame = decodeBits(bits)
  if (frame !== null) return { frame, valid: true, inverted: false, contrast, bits }
  const flipped = decodeBits(bits.map(bit => 1 - bit))
  if (flipped !== null) return { frame: flipped, valid: true, inverted: true, contrast, bits }
  return { frame: null, valid: false, inverted: false, contrast, bits, reason: 'checksum' }
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
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file])
  const stream = (JSON.parse(stdout) as { streams: Array<{ width: number; height: number }> }).streams[0]
  if (!stream) throw new Error(`${file} has no video stream`)
  const width = Math.min(scaleWidth, stream.width), height = Math.round(stream.height * width / stream.width / 2) * 2
  const frameSize = width * height * 3, readings: FrameCodeReading[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}:flags=area`, '-vsync', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    let pending = Buffer.alloc(0), errors = ''
    child.stdout.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= frameSize) {
        readings.push(readFrameCode({ width, height, channels: 3, data: pending.subarray(0, frameSize) }))
        pending = pending.subarray(frameSize)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('ffmpeg is not installed on this test host') : error))
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg could not decode ${file}: ${errors.trim().slice(0, 400)}`)))
  })
  return { width, height, readings }
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
