import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureTestMedia } from './testMediaStore'

const run = promisify(execFile)

/**
 * Generated test clips whose every frame says which frame it is. The top band
 * holds 16 black/white blocks: bits 0-11 are the frame number, bits 12-15 a
 * check nibble (15 minus the sum of the number's three nibbles, mod 16), so a
 * misread, a blend of two frames or a black frame never decodes as a valid
 * number. Below it: six colour bars (each channel 0 or 200) for effect checks
 * and an eight-step grey ramp. The frame number is also printed for people.
 * Layout constants are shared with assertions/frameCodeOracle.ts.
 *
 * The clips are generated with ffmpeg at test time (no binary media in the
 * repository, no redistribution question) and cached by their parameters in
 * the shared test media store (fixtures/testMediaStore.ts, key
 * `frame-code-media/<name>`), which also fetches them from the remote.
 */
export const FRAME_CODE_LAYOUT = {
  blocks: 16,
  numberBits: 12,
  codeBand: [0, 0.18],
  barBand: [0.26, 0.66],
  rampBand: [0.72, 0.86],
  bars: [
    { name: 'red', rgb: [200, 0, 0] },
    { name: 'green', rgb: [0, 200, 0] },
    { name: 'blue', rgb: [0, 0, 200] },
    { name: 'cyan', rgb: [0, 200, 200] },
    { name: 'magenta', rgb: [200, 0, 200] },
    { name: 'yellow', rgb: [200, 200, 0] },
  ],
  black: 16,
  white: 235,
  background: 40,
} as const

export interface FrameCodeClipOptions {
  width?: number
  height?: number
  fps?: number
  seconds?: number
  /** ffmpeg video encoder settings; default H.264 High with B-frames, one keyframe per second. */
  codec?: 'h264' | 'vp9'
}

export interface FrameCodeClip {
  path: string
  width: number
  height: number
  fps: number
  frames: number
  codec: 'h264' | 'vp9'
}

export function frameCodeFilter(width: number, height: number): string {
  const { blocks, numberBits, codeBand, barBand, rampBand, bars, black, white, background } = FRAME_CODE_LAYOUT
  const nibble = (k: number) => `mod(floor(N/${16 ** k}),16)`
  const check = `(15-mod(${nibble(0)}+${nibble(1)}+${nibble(2)},16))`
  const bit = (k: number) => k < numberBits ? `mod(floor(N/${2 ** k}),2)` : `mod(floor(${check}/${2 ** (k - numberBits)}),2)`
  const codeBit = Array.from({ length: blocks }, (_, k) => `eq(floor(X*${blocks}/W),${k})*${bit(k)}`).join('+')
  const band = ([from, to]: readonly [number, number]) => `between(Y,H*${from},H*${to}-1)`
  const barValue = (channel: number) => `(${bars.map((item, index) => `eq(floor(X*${bars.length}/W),${index})*${item.rgb[channel]}`).join('+')})`
  const ramp = `(${black}+floor(X*8/W)*30)`
  const value = (channel: number) => `if(${band(codeBand)},${black}+${white - black}*(${codeBit}),`
    + `if(${band(barBand)},${barValue(channel)},if(${band(rampBand)},${ramp},${background})))`
  const fontSize = Math.max(12, Math.round(Math.min(width * 0.04, height * 0.07)))
  return `geq=r='${value(0)}':g='${value(1)}':b='${value(2)}',`
    + `drawtext=text='%{frame_num}':x=w*0.02:y=h*0.9:fontsize=${fontSize}:fontcolor=white,format=yuv420p`
}

/** Generates (or reuses) a frame-code clip. Fails with a clear message when ffmpeg is missing. */
export async function frameCodeClip(options: FrameCodeClipOptions = {}): Promise<FrameCodeClip> {
  const { width = 640, height = 360, fps = 30, seconds = 4, codec = 'h264' } = options
  const frames = Math.round(fps * seconds)
  const extension = codec === 'vp9' ? 'webm' : 'mp4'
  const file = await renderClip(`frame-code-v1-${width}x${height}-${fps}fps-${frames}f-${codec}.${extension}`, { width, height, fps, seconds, frames, codec },
    frameCodeFilter(width, height))
  return { path: file, width, height, fps, frames, codec }
}

/**
 * Frame code v2, for compositions that hold many clips at once (the mosaic,
 * tests/playwright/mosaic/). v1 stays unchanged for the existing tests. Each v2
 * chart keeps the frame row (12-bit number + check nibble, as v1) and adds an
 * identity row: 8-bit source id + 4-bit variant + the same check nibble over
 * those 12 bits, so a layer that shows another layer's source never passes as a
 * correct frame. Code cells sit inside a horizontal inset, so masks and edge
 * measurements near the clip border never touch them. All bands are fractions
 * of the clip height; the oracle reads the same table.
 *
 * - `tile`: frame row, identity row, six colour bars (v1 palette), grey ramp and
 *   a light floor band (grey 180, label on its right half) that makes the clip's
 *   edges measurable in luma, which 4:2:0 video keeps at full resolution.
 * - `compact`: half-height tiles: frame row, identity row and bars.
 * - `strip`: the frame row alone, over the whole clip (the mosaic's clock).
 */
export type FrameCodeChart = 'tile' | 'compact' | 'strip'

export interface FrameCodeChartLayout {
  inset: number
  frameRow: readonly [number, number]
  identityRow?: readonly [number, number]
  barBand?: readonly [number, number]
  rampBand?: readonly [number, number]
  floorBand?: readonly [number, number]
}

export const FRAME_CODE_V2 = {
  /** Part of every cached file name: bump it whenever the v2 picture changes. */
  revision: 3,
  floor: 180,
  charts: {
    tile: { inset: 0.08, frameRow: [0.03, 0.17], identityRow: [0.2, 0.3], barBand: [0.36, 0.64], rampBand: [0.68, 0.8], floorBand: [0.84, 1] },
    compact: { inset: 0.08, frameRow: [0.05, 0.35], identityRow: [0.42, 0.62], barBand: [0.7, 0.95] },
    strip: { inset: 0, frameRow: [0, 1] },
  } satisfies Record<FrameCodeChart, FrameCodeChartLayout>,
} as const

/** The 16 identity bits: source id (bits 0-7), variant (8-11), check nibble (12-15). */
export function identityBits(sourceId: number, variant = 0): number[] {
  if (!Number.isInteger(sourceId) || sourceId < 0 || sourceId > 255) throw new Error(`source id ${sourceId} is not 0-255`)
  if (!Number.isInteger(variant) || variant < 0 || variant > 15) throw new Error(`variant ${variant} is not 0-15`)
  const value = sourceId | (variant << 8)
  const check = 15 - (((value & 15) + ((value >> 4) & 15) + ((value >> 8) & 15)) % 16)
  return Array.from({ length: 16 }, (_, bit) => bit < 12 ? (value >> bit) & 1 : (check >> (bit - 12)) & 1)
}

export interface FrameCodeV2Options extends FrameCodeClipOptions {
  chart?: FrameCodeChart
  /** 0-255, printed in the identity row. */
  sourceId: number
  variant?: number
}

export interface FrameCodeV2Clip extends FrameCodeClip {
  chart: FrameCodeChart
  sourceId: number
  variant: number
}

export function frameCodeFilterV2(width: number, height: number, { chart = 'tile', sourceId, variant = 0 }: Pick<FrameCodeV2Options, 'chart' | 'sourceId' | 'variant'>): string {
  const { blocks, numberBits, bars, black, white, background } = FRAME_CODE_LAYOUT
  const layout: FrameCodeChartLayout = FRAME_CODE_V2.charts[chart]
  const nibble = (k: number) => `mod(floor(N/${16 ** k}),16)`
  const check = `(15-mod(${nibble(0)}+${nibble(1)}+${nibble(2)},16))`
  const frameBit = (k: number) => k < numberBits ? `mod(floor(N/${2 ** k}),2)` : `mod(floor(${check}/${2 ** (k - numberBits)}),2)`
  const cell = `floor((X/W-${layout.inset})*${blocks}/${1 - 2 * layout.inset})`
  const inCells = `between(X,W*${layout.inset},W*${1 - layout.inset}-1)`
  const frameBits = Array.from({ length: blocks }, (_, k) => `eq(${cell},${k})*${frameBit(k)}`).join('+')
  const idBits = identityBits(sourceId, variant).map((bit, k) => bit ? `eq(${cell},${k})` : '').filter(Boolean).join('+') || '0'
  const band = ([from, to]: readonly [number, number]) => `between(Y,H*${from},H*${to}-1)`
  const code = (bits: string) => `${black}+${white - black}*${inCells}*(${bits})`
  const barValue = (channel: number) => `(${bars.map((item, index) => `eq(floor(X*${bars.length}/W),${index})*${item.rgb[channel]}`).join('+')})`
  const ramp = `(${black}+floor(X*8/W)*30)`
  const value = (channel: number) => {
    let expression = String(background)
    if (layout.floorBand) expression = `if(${band(layout.floorBand)},${FRAME_CODE_V2.floor},${expression})`
    if (layout.rampBand) expression = `if(${band(layout.rampBand)},${ramp},${expression})`
    if (layout.barBand) expression = `if(${band(layout.barBand)},${barValue(channel)},${expression})`
    if (layout.identityRow) expression = `if(${band(layout.identityRow)},if(${inCells},${code(idBits)},${background}),${expression})`
    return `if(${band(layout.frameRow)},if(${inCells},${code(frameBits)},${background}),${expression})`
  }
  const label = layout.floorBand
    ? `,drawtext=text='%{frame_num} #${sourceId}':x=w*0.55:y=h*${layout.floorBand[0] + 0.03}:fontsize=${Math.max(10, Math.round(Math.min(width * 0.06, height * 0.1)))}:fontcolor=black`
    : ''
  // Encoded and tagged as BT.709 limited range, so a browser decodes the bars with the matrix they were encoded with
  // (untagged small clips are decoded with a guessed matrix; ../test-signals.md, frame-code recommendations).
  return `geq=r='${value(0)}':g='${value(1)}':b='${value(2)}'${label},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv`
}

/** Generates (or reuses) a v2 frame-code clip, cached by all of its parameters. */
export async function frameCodeClipV2(options: FrameCodeV2Options): Promise<FrameCodeV2Clip> {
  const { width = 352, height = 224, fps = 30, seconds = 4, codec = 'h264', chart = 'tile', sourceId, variant = 0 } = options
  const frames = Math.round(fps * seconds)
  const extension = codec === 'vp9' ? 'webm' : 'mp4'
  const file = await renderClip(`frame-code-v2r${FRAME_CODE_V2.revision}-${chart}-id${sourceId}-v${variant}-${width}x${height}-${fps}fps-${frames}f-${codec}.${extension}`,
    { width, height, fps, seconds, frames, codec }, frameCodeFilterV2(width, height, { chart, sourceId, variant }), BT709_TAGS)
  return { path: file, width, height, fps, frames, codec, chart, sourceId, variant }
}

const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

/** Returns the cached (or fetched, or freshly rendered) clip `name`; the name holds every parameter of the picture. */
async function renderClip(name: string, { width, height, fps, seconds, frames, codec }: Omit<FrameCodeClip, 'path'> & { seconds: number }, filter: string,
  tags: string[] = []): Promise<string> {
  const media = await ensureTestMedia(`frame-code-media/${name}`, target => encodeClip(target, { width, height, fps, seconds, frames, codec }, filter, tags))
  return media.path
}

async function encodeClip(target: string, { width, height, fps, seconds, frames, codec }: Omit<FrameCodeClip, 'path'> & { seconds: number }, filter: string,
  tags: string[]): Promise<void> {
  const encoder = codec === 'vp9'
    ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-g', String(fps), '-row-mt', '1']
    : ['-c:v', 'libx264', '-profile:v', 'high', '-crf', '14', '-g', String(fps), '-bf', '2', '-movflags', '+faststart']
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds}`,
      '-vf', filter, '-frames:v', String(frames), ...encoder, ...tags, target], { maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(code === 'ENOENT'
      ? 'ffmpeg is not installed on this test host; the frame-code clips are generated with it (install ffmpeg and rerun).'
      : `ffmpeg could not generate the frame-code clip: ${(error as Error).message}`)
  }
}
