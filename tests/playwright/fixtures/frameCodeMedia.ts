import { execFile } from 'node:child_process'
import { access, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_REPO_ROOT } from './bridgeClient'

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
 * repository, no redistribution question) and cached by their parameters.
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

const CACHE_DIR = path.join(DEFAULT_REPO_ROOT, 'test-results', 'playwright', 'frame-code-media')

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
  const file = path.join(CACHE_DIR, `frame-code-v1-${width}x${height}-${fps}fps-${frames}f-${codec}.${extension}`)
  const clip: FrameCodeClip = { path: file, width, height, fps, frames, codec }
  if (await access(file).then(() => true, () => false)) return clip
  await mkdir(CACHE_DIR, { recursive: true })
  const encoder = codec === 'vp9'
    ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-g', String(fps), '-row-mt', '1']
    : ['-c:v', 'libx264', '-profile:v', 'high', '-crf', '14', '-g', String(fps), '-bf', '2', '-movflags', '+faststart']
  const temporary = `${file}.${process.pid}.tmp.${extension}`
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds}`,
      '-vf', frameCodeFilter(width, height), '-frames:v', String(frames), ...encoder, temporary], { maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(code === 'ENOENT'
      ? 'ffmpeg is not installed on this test host; the frame-code clips are generated with it (install ffmpeg and rerun).'
      : `ffmpeg could not generate the frame-code clip: ${(error as Error).message}`)
  }
  await rename(temporary, file)
  return clip
}
