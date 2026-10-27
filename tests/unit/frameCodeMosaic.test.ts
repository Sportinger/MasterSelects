import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { FRAME_CODE_LAYOUT, FRAME_CODE_V2, frameCodeClipV2, identityBits, type FrameCodeChart } from '../playwright/fixtures/frameCodeMedia'
import { checkNibble, meanRgbRect, readEdge, readFrameCodeV2, readIdentity, streamVideoFrames, type FramePixels } from '../playwright/assertions/frameCodeOracle'
import { easeInOut, t06Edges, t09InnerFrame, t11FastFrame, t11ReverseFrame, boxOf, MOSAIC } from '../playwright/mosaic/mosaicLayout'
import { easingFunctions } from '../../src/utils/keyframeInterpolation'
import { resolveClipSourceTime, videoFrameSourceTime } from '../../src/services/timeline/retime/clipRetime'
import type { TimelineClip } from '../../src/types/timeline'

// Paints a v2 chart frame the way the ffmpeg filter does (fixtures/frameCodeMedia.ts, frameCodeFilterV2), in plain RGB.
function paintV2(frame: number, sourceId: number, { chart = 'tile' as FrameCodeChart, width = 352, height = 224 } = {}): FramePixels {
  const { blocks, numberBits, bars, black, white, background } = FRAME_CODE_LAYOUT
  const layout = FRAME_CODE_V2.charts[chart] as (typeof FRAME_CODE_V2.charts)['tile']
  const frameBit = (k: number) => k < numberBits ? (frame >> k) & 1 : (checkNibble(frame) >> (k - numberBits)) & 1
  const ids = identityBits(sourceId)
  const data = new Uint8Array(width * height * 3)
  const inside = (v: number, band?: readonly [number, number]) => band && v >= band[0] && v < band[1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height, cell = Math.floor((u - layout.inset) * blocks / (1 - 2 * layout.inset))
      const inCells = u >= layout.inset && u < 1 - layout.inset
      let rgb: readonly number[] = [background, background, background]
      if (inside(v, layout.frameRow)) { const level = inCells ? (frameBit(cell) ? white : black) : background; rgb = [level, level, level] }
      else if (inside(v, layout.identityRow)) { const level = inCells ? (ids[cell] ? white : black) : background; rgb = [level, level, level] }
      else if (inside(v, layout.barBand)) rgb = bars[Math.floor(u * bars.length)].rgb
      else if (inside(v, layout.rampBand)) { const level = 16 + Math.floor(u * 8) * 30; rgb = [level, level, level] }
      else if (inside(v, layout.floorBand)) rgb = [FRAME_CODE_V2.floor, FRAME_CODE_V2.floor, FRAME_CODE_V2.floor]
      data.set(rgb, (y * width + x) * 3)
    }
  }
  return { width, height, channels: 3, data }
}

/** Places `clip` into a `width`×`height` grey frame at (x, y), scaled by an integer-free nearest-neighbour `scale`. */
function placeInto(clip: FramePixels, width: number, height: number, x: number, y: number, scale = 1): FramePixels {
  const data = new Uint8Array(width * height * 3).fill(48)
  for (let row = 0; row < Math.round(clip.height * scale); row++) {
    for (let column = 0; column < Math.round(clip.width * scale); column++) {
      const source = (Math.floor(row / scale) * clip.width + Math.floor(column / scale)) * 3
      data.set(clip.data.subarray(source, source + 3), ((y + row) * width + x + column) * 3)
    }
  }
  return { width, height, channels: 3, data }
}

describe('frame code v2: frame row and identity row', () => {
  it('reads frame and source id back from every chart, also inside a larger frame and display-scaled', () => {
    for (const chart of ['tile', 'compact'] as const) {
      const height = chart === 'tile' ? 224 : 112
      for (const [frame, id] of [[0, 1], [37, 6], [119, 12], [4095, 255]] as const) {
        const clip = paintV2(frame, id, { chart, height })
        expect(readFrameCodeV2(clip, { x: 0, y: 0, width: 352, height }, chart)).toMatchObject({ frame, valid: true, inverted: false })
        expect(readIdentity(clip, { x: 0, y: 0, width: 352, height }, chart)).toMatchObject({ sourceId: id, variant: 0, valid: true })
        // The mosaic preview shows the composition at about half size.
        const framed = placeInto(clip, 800, 400, 40, 60, 0.5)
        expect(readFrameCodeV2(framed, { x: 40, y: 60, width: 176, height: height / 2 }, chart).frame).toBe(frame)
        expect(readIdentity(framed, { x: 40, y: 60, width: 176, height: height / 2 }, chart).sourceId).toBe(id)
      }
    }
  })

  it('never reports another source for a blend of two identities or a flat region', () => {
    const a = paintV2(10, 3), b = paintV2(10, 4)
    const blend: FramePixels = { ...a, data: a.data.map((value, index) => Math.round((value + b.data[index]) / 2)) }
    expect(readIdentity(blend, { x: 0, y: 0, width: 352, height: 224 })).toMatchObject({ valid: false })
    const flat: FramePixels = { width: 352, height: 224, channels: 3, data: new Uint8Array(352 * 224 * 3).fill(48) }
    expect(readFrameCodeV2(flat, { x: 0, y: 0, width: 352, height: 224 })).toMatchObject({ valid: false, reason: 'flat' })
  })

  it('encodes a check nibble over source id and variant', () => {
    const bits = identityBits(0x9c, 5), value = bits.slice(0, 12).reduce((sum, bit, index) => sum + bit * 2 ** index, 0)
    expect(value).toBe(0x9c | (5 << 8))
    expect(bits.slice(12).reduce((sum, bit, index) => sum + bit * 2 ** index, 0)).toBe(checkNibble(value))
    expect(() => identityBits(256)).toThrow()
  })
})

describe('edge and region measurement', () => {
  // A Gaussian-blurred step (σ px) from 48 to 200 at sub-pixel position `edge`, sampled at pixel centres.
  const step = (edge: number, sigma: number, width = 80): FramePixels => {
    const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y }
    const data = new Uint8Array(width * 8 * 3)
    for (let x = 0; x < width; x++) {
      const alpha = 0.5 * (1 + erf((x + 0.5 - edge) / (sigma * Math.SQRT2)))
      for (let y = 0; y < 8; y++) data.fill(Math.round(48 + 152 * alpha), (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
    return { width, height: 8, channels: 3, data }
  }

  it('locates a blurred step to a fraction of a pixel and measures its 10-90 width in both scan directions', () => {
    for (const [edge, sigma] of [[30.3, 5.5], [41.75, 2], [25, 6.2]]) {
      const forward = readEdge(step(edge, sigma), { axis: 'x', at: 4, from: 0, to: 79 })
      // Sample k is pixel k, whose centre is at k + 0.5.
      expect(forward.position! + 0.5).toBeCloseTo(edge, 0)
      expect(Math.abs(forward.position! + 0.5 - edge)).toBeLessThan(0.15)
      expect(forward.width! / (2.5631 * sigma)).toBeGreaterThan(0.93)
      expect(forward.width! / (2.5631 * sigma)).toBeLessThan(1.07)
      const backward = readEdge(step(edge, sigma), { axis: 'x', at: 4, from: 79, to: 0 })
      expect(79 - backward.position! + 0.5).toBeCloseTo(edge, 0)
    }
    expect(readEdge({ width: 20, height: 4, channels: 3, data: new Uint8Array(240).fill(48) }, { axis: 'x', at: 2, from: 0, to: 19 }).position).toBeNull()
  })

  it('averages an absolute rectangle', () => {
    const clip = paintV2(5, 1)
    const red = meanRgbRect(clip, 10, 0.4 * 224, 40, 0.6 * 224)
    expect(red.map(Math.round)).toEqual([200, 0, 0])
  })
})

describe('mosaic oracles follow the product rules they cite', () => {
  it('ease-in-out is the preset curve of src/utils/keyframeInterpolation.ts', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(easeInOut(t)).toBeCloseTo(easingFunctions['ease-in-out'](t), 12)
  })

  it('speed 2 and reverse select the source frames videoFrameSourceTime selects', () => {
    const clip = (speed: number, reversed: boolean, outPoint: number) => ({ id: 'c', trackId: 'v', name: 'c', startTime: 0, duration: 4, inPoint: 0, outPoint,
      speed, reversed, source: { type: 'video', naturalDuration: outPoint } } as unknown as TimelineClip)
    for (let frame = 0; frame < 120; frame++) {
      const fast = videoFrameSourceTime(resolveClipSourceTime(clip(2, false, 8), frame / 30))
      expect(Math.floor(fast * 30 + 1e-6), `speed 2 at ${frame}`).toBe(t11FastFrame(frame))
      const reverse = videoFrameSourceTime(resolveClipSourceTime(clip(1, true, 4), frame / 30))
      expect(Math.floor(reverse * 30 + 1e-6), `reverse at ${frame}`).toBe(t11ReverseFrame(frame))
    }
  })

  it('nested 60 fps frames and the feather geometry', () => {
    expect([0, 1, 29, 119].map(t09InnerFrame)).toEqual([60, 62, 118, 298])
    const box = boxOf(0, 1), edges = t06Edges(box)
    expect(edges.left).toBeCloseTo(box.x + 14.08, 6)
    expect(edges.sigmaX).toBeCloseTo(30 * 352 / MOSAIC.width, 9)
    expect(edges.sigmaY).toBeCloseTo(30 * 224 / MOSAIC.height, 9)
  })
})

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()
describe.skipIf(!hasFfmpeg)('frame code v2 through a real H.264 encode', () => {
  it('every frame of a generated tile clip reads back with its source id and BT.709 colours', async () => {
    const clip = await frameCodeClipV2({ sourceId: 77, chart: 'tile', width: 352, height: 224, fps: 30, seconds: 1 })
    const frames: Array<number | null> = [], ids: Array<number | null> = [], greens: number[][] = []
    const decoded = await streamVideoFrames(clip.path, pixels => {
      frames.push(readFrameCodeV2(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height }).frame)
      ids.push(readIdentity(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height }).sourceId)
      greens.push(meanRgbRect(pixels, 70, 90, 105, 130))
    })
    expect(decoded.frames).toBe(30)
    expect(frames).toEqual(Array.from({ length: 30 }, (_, index) => index))
    expect(new Set(ids)).toEqual(new Set([77]))
    for (const green of greens) expect(Math.max(...green.map((value, channel) => Math.abs(value - [0, 200, 0][channel])))).toBeLessThan(6)
  }, 60_000)
})
