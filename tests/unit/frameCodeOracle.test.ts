import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { FRAME_CODE_LAYOUT, frameCodeClip } from '../playwright/fixtures/frameCodeMedia'
import { barDeviation, checkFrameSequence, checkNibble, readColorBars, readFrameCode, readVideoFrameCodes, type FramePixels } from '../playwright/assertions/frameCodeOracle'

// Paints a frame-code frame the way the ffmpeg filter does (fixtures/frameCodeMedia.ts), in plain RGB.
function paint(frame: number, { width = 320, height = 180, invert = false } = {}): FramePixels {
  const { blocks, numberBits, codeBand, barBand, bars, black, white, background } = FRAME_CODE_LAYOUT
  const data = new Uint8Array(width * height * 3)
  const bit = (k: number) => k < numberBits ? (frame >> k) & 1 : (checkNibble(frame) >> (k - numberBits)) & 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = y / height
      let rgb: readonly number[] = [background, background, background]
      if (v >= codeBand[0] && v < codeBand[1]) { const level = bit(Math.floor(x * blocks / width)) ? white : black; rgb = [level, level, level] }
      else if (v >= barBand[0] && v < barBand[1]) rgb = bars[Math.floor(x * bars.length / width)].rgb
      const offset = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = invert ? 255 - rgb[channel] : rgb[channel]
    }
  }
  return { width, height, channels: 3, data }
}

const blend = (a: FramePixels, b: FramePixels): FramePixels => ({ ...a, data: a.data.map((value, index) => Math.round((value + b.data[index]) / 2)) })

describe('frame-code oracle', () => {
  it('reads every frame number back, also inverted and inside a larger frame', () => {
    for (const frame of [0, 1, 37, 59, 255, 1000, 4095]) {
      expect(readFrameCode(paint(frame))).toMatchObject({ frame, valid: true, inverted: false })
      expect(readFrameCode(paint(frame, { invert: true }))).toMatchObject({ frame, valid: true, inverted: true })
    }
    // A 320x180 clip letterboxed into a 400x300 frame.
    const clip = paint(37), framed = new Uint8Array(400 * 300 * 3).fill(10)
    for (let y = 0; y < 180; y++) framed.set(clip.data.subarray(y * 320 * 3, (y + 1) * 320 * 3), ((y + 60) * 400 + 40) * 3)
    expect(readFrameCode({ width: 400, height: 300, channels: 3, data: framed }, { x: 40, y: 60, width: 320, height: 180 }).frame).toBe(37)
  })

  // 4095 blended frames: seconds locally, past the 15 s default on a busy CI runner.
  it('never turns a black frame or a blend of two frames into a wrong number', () => {
    expect(readFrameCode({ width: 64, height: 36, channels: 3, data: new Uint8Array(64 * 36 * 3) })).toMatchObject({ valid: false, reason: 'flat' })
    for (let frame = 0; frame < 4095; frame++) {
      const reading = readFrameCode(blend(paint(frame), paint(frame + 1)))
      expect(reading.valid, `blend of ${frame} and ${frame + 1}`).toBe(false)
    }
    // A mostly-one-frame mix still reads as that frame, never as a third number.
    const mix = (a: FramePixels, b: FramePixels, share: number): FramePixels => ({ ...a, data: a.data.map((value, index) => Math.round(value * share + b.data[index] * (1 - share))) })
    for (let frame = 0; frame < 600; frame += 7) {
      for (const share of [0.9, 0.7, 0.5, 0.3, 0.1]) {
        const reading = readFrameCode(mix(paint(frame), paint(frame + 1), share))
        if (reading.valid) expect([frame, frame + 1]).toContain(reading.frame)
      }
    }
  }, 60_000)

  it('measures the colour bars and their inversion', () => {
    expect(barDeviation(readColorBars(paint(5)), bar => bar.expected)).toBeLessThan(1)
    expect(barDeviation(readColorBars(paint(5, { invert: true })), bar => bar.expected.map(value => 255 - value) as unknown as [number, number, number])).toBeLessThan(1)
  })

  it('reports missing, repeated and unreadable frames in a sequence', () => {
    const readings = [0, 1, 1, 3].map(frame => readFrameCode(paint(frame)))
    readings.push(readFrameCode({ width: 64, height: 36, channels: 3, data: new Uint8Array(64 * 36 * 3) }))
    const report = checkFrameSequence(readings, { from: 0, count: 6 })
    expect(report.ok).toBe(false)
    expect(report.problems).toEqual(['expected 6 frames, the file has 5', 'frame 2: shows source frame 1, expected 2 (repeated)',
      'frame 4: unreadable (flat, contrast 0)'])
    expect(checkFrameSequence([0, 1, 2].map(frame => readFrameCode(paint(frame))), { from: 0, count: 3 }).ok).toBe(true)
  })

  const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()
  it.skipIf(!hasFfmpeg)('round-trips through a real H.264 encode: every frame of the generated clip reads back in order', async () => {
    const clip = await frameCodeClip({ width: 320, height: 180, fps: 30, seconds: 2 })
    const decoded = await readVideoFrameCodes(clip.path)
    const report = checkFrameSequence(decoded.readings, { from: 0, count: clip.frames })
    expect(report.problems).toEqual([])
  }, 60_000)
})

describe('Playwright Chrome flags per platform', () => {
  it('gives Linux ANGLE on Vulkan (WebGPU), XWayland for a window and no Vulkan surface when headless; others only the shared flags', async () => {
    const { chromeLaunchArgs } = await import('../playwright/config/runtimeProfile')
    const headed = chromeLaunchArgs('linux', false), headless = chromeLaunchArgs('linux', true)
    for (const args of [headed, headless]) expect(args).toEqual(expect.arrayContaining(['--use-angle=vulkan', '--enable-unsafe-webgpu', '--force-color-profile=srgb']))
    expect(headed).toContain('--ozone-platform=x11')
    expect(headed).not.toContain('--disable-vulkan-surface')
    expect(headless).toContain('--disable-vulkan-surface')
    expect(headless).not.toContain('--ozone-platform=x11')
    expect(chromeLaunchArgs('win32', false)).toEqual(['--window-size=1920,1080', '--force-color-profile=srgb'])
  })
})
