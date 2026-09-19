import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { createReferenceMediaFixture } from '../fixtures/mediaFixture'

const execute = promisify(execFile)
export async function ffmpeg(args: string[], maxBuffer = 12_000_000) {
  return execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
    { timeout: 60_000, windowsHide: true, maxBuffer, encoding: 'buffer' })
}
export async function prepareMedia(testInfo: TestInfo, pattern: boolean) {
  const media = await createReferenceMediaFixture()
  const directory = testInfo.outputPath('media'); await mkdir(directory, { recursive: true })
  const sources = [media.dynamicLandscape, media.longformLandscape]
  const files = [path.join(directory, 'beta-background.mp4'), path.join(directory, 'beta-foreground.mp4')]
  if (process.env.MS_BETA_EXISTING === '1') {
    // Allocation intent precedes ffmpeg, so partial outputs remain attributable on failure.
    await writeFile(testInfo.outputPath('generated-media-intent.json'), JSON.stringify({
      owner: testInfo.testId, root: directory, files,
    }), { flag: 'wx' })
  }
  for (let index = 0; index < 2; index++) {
    const source = pattern ? ['-f', 'lavfi', '-i', `color=c=${index ? 'red' : 'blue'}:s=640x360:r=30:d=3`,
      '-f', 'lavfi', '-i', `sine=frequency=${index ? 880 : 440}:sample_rate=48000:duration=3`]
      : ['-ss', String(index ? 30 : 15), '-i', sources[index].absolutePath]
    const x = index ? 200 : 32, y = index ? 170 : 8
    const counter = [`drawbox=x=${x}:y=${y}:w=56:h=16:color=black:t=fill`,
      ...Array.from({ length: 7 }, (_, bit) =>
        `drawbox=x=${x + bit * 8}:y=${y}:w=8:h=16:color=white:t=fill:enable='mod(floor(n/${2 ** bit}),2)'`)]
    await ffmpeg([...source, '-t', '3', '-vf', ['scale=640:360', ...(pattern ? counter : [])].join(','), '-r', '30', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-crf', '18', '-c:a', 'aac', '-ar', '48000', '-y', files[index]])
  }
  const provenance = { version: 2, pattern, width: 640, height: 360, frameRate: 30, duration: 3,
    purpose: 'Normalized editing fixtures; not original-codec compatibility coverage',
    sources: pattern ? ['lavfi blue/red with 440/880 Hz and per-frame 7-bit counters, 0..89'] : sources.map(source => ({ file: source.fileName, sha256: source.sha256 })),
    ffmpeg: (await execute('ffmpeg', ['-version'], { windowsHide: true })).stdout.split('\n')[0],
    outputs: await Promise.all(files.map(async file => ({ file: path.basename(file),
      sha256: createHash('sha256').update(await readFile(file)).digest('hex') }))) }
  await testInfo.attach('media-provenance', { body: JSON.stringify(provenance, null, 2), contentType: 'application/json' })
  return files
}
export async function settledPreview(page: Page, testInfo: TestInfo, name: string, expectedRgb?: Buffer) {
  const canvas = page.getByTestId('preview-canvas')
  let previous = '', stable = 0
  let latest: Buffer = Buffer.alloc(0)
  let difference: number | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    latest = await canvas.screenshot()
    const hash = createHash('sha256').update(latest).digest('hex')
    stable = hash === previous ? stable + 1 : 0; previous = hash
    if (stable >= 2) {
      const file = testInfo.outputPath(`${name}.png`); await writeFile(file, latest)
      difference = expectedRgb ? compareRgb(expectedRgb, await decodeRgb(file)) : undefined
      if (difference === undefined || difference < 15) {
        await testInfo.attach(name, { path: file, contentType: 'image/png' })
        await testInfo.attach(`readiness-${name}`, { body: JSON.stringify({ stableSamples: stable + 1,
          expectedFrameCompared: Boolean(expectedRgb), meanAbsoluteRgbDifference: difference }), contentType: 'application/json' })
        return file
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await testInfo.attach(`${name}-not-ready`, { body: latest, contentType: 'image/png' })
  throw new Error(`Preview readiness failed: stable=${stable}, expected frame difference=${difference}`)
}
export async function decodeRgb(file: string, time?: number) {
  return (await ffmpeg([...(time === undefined ? [] : ['-ss', String(time)]), '-i', file,
    '-frames:v', '1', '-vf', 'scale=640:360', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])).stdout
}
export function compareRgb(expected: Buffer, actual: Buffer) {
  if (expected.length !== 640 * 360 * 3 || actual.length !== expected.length) throw new Error('Missing or invalid decoded frame')
  let delta = 0
  for (let i = 0; i < actual.length; i++) delta += Math.abs(expected[i] - actual[i])
  return delta / actual.length
}
export function assertPatternFrame(frame: Buffer) {
  if (frame.length !== 640 * 360 * 3) throw new Error('Invalid pattern frame size')
  for (const [x, y, channel] of [[320, 180, 0], [5, 5, 2], [635, 355, 2]]) {
    const pixel = frame.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)
    if (pixel[channel] < 200 || [...pixel].some((value, i) => i !== channel && value > 45)) {
      throw new Error(`Pattern mismatch at (${x},${y}): ${[...pixel]}, expected ${channel === 0 ? 'red' : 'blue'}`)
    }
  }
}

export async function inspectAudioSignal(file: string) {
  const pcm = (await ffmpeg(['-ss', '0.5', '-i', file, '-t', '1', '-vn', '-ac', '1', '-ar', '8000',
    '-f', 'f32le', 'pipe:1'])).stdout
  const count = pcm.length / 4
  if (count < 7900) throw new Error('Export audio did not decode to the expected sample window')
  let power = 0
  const tones = [440, 880].map(frequency => {
    let real = 0, imaginary = 0
    for (let i = 0; i < count; i++) {
      const value = pcm.readFloatLE(i * 4)
      if (!Number.isFinite(value)) throw new Error('Non-finite exported audio sample')
      if (frequency === 440) power += value * value
      const phase = 2 * Math.PI * frequency * i / 8000
      real += value * Math.cos(phase); imaginary += value * Math.sin(phase)
    }
    return { frequency, amplitude: 2 * Math.hypot(real, imaginary) / count }
  })
  return { samples: count, rms: Math.sqrt(power / count), tones }
}
