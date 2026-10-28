import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertFreeSpace, PHONE_FOOTAGE_DIR, PHONE_FOOTAGE_HEAVY_DIR, phoneFootage, phoneFootageDirectory, phoneFootageProfile, phoneFrameCodeFilter,
} from '../playwright/fixtures/phoneFootage'
import {
  footageExpectation, frameIndexAt, frameTime, intervalStats, PHONE_FOOTAGE_PROFILES, setptsExpression,
  type PhoneFootageProfileId,
} from '../playwright/fixtures/phoneFootageProfiles'
import { checkFootageFrames, checkFootageProbe, probeFootage, readPhoneFrameCode, topLevelBoxes } from '../playwright/assertions/phoneFootageOracle'
import { readFrameCode } from '../playwright/assertions/frameCodeOracle'

const run = promisify(execFile)
const model = (id: PhoneFootageProfileId) => footageExpectation(PHONE_FOOTAGE_PROFILES[id])

describe('phone footage expectation models (full size)', () => {
  it('has the frame counts and lengths of the real recordings', () => {
    expect(model('android-h264').pts).toHaveLength(450)
    expect(model('android-60').pts).toHaveLength(900)
    expect(model('iphone-h264-2997').pts).toHaveLength(450)
    expect(model('long-10min').pts).toHaveLength(18_000)
    expect(model('multi-gb').pts).toHaveLength(43_200)
    const vfr = model('android-vfr')
    expect(vfr.pts.length).toBeGreaterThan(15_000 / 40)
    expect(vfr.pts.at(-1)!).toBeLessThan(15 * 90_000)
    expect(vfr.endTicks).toBeGreaterThanOrEqual(15 * 90_000)
  })

  it('keeps every presentation time strictly increasing', () => {
    for (const id of Object.keys(PHONE_FOOTAGE_PROFILES) as PhoneFootageProfileId[]) {
      const { pts } = model(id)
      expect(pts[0], id).toBe(0)
      expect(pts.every((tick, index) => index === 0 || tick > pts[index - 1]), id).toBe(true)
    }
  })

  it('jitters Android timestamps by up to ±4 ms (±2 ms at 60 fps) and uses the whole range', () => {
    const stats = intervalStats(model('android-h264'))
    expect(stats.maxJitterMs).toBeLessThanOrEqual(4)
    expect(stats.maxJitterMs).toBeGreaterThan(3.9)
    expect(stats.minMs).toBeGreaterThan(33.33 - 8)
    expect(stats.maxMs).toBeLessThan(33.34 + 8)
    const sixty = intervalStats(model('android-60'))
    expect(sixty.maxJitterMs).toBeLessThanOrEqual(2)
    expect(sixty.maxJitterMs).toBeGreaterThan(1.9)
    // Deterministic: the same seed gives the same file every time.
    expect(model('android-h264').pts.slice(0, 6)).toEqual([0, 3243, 5670, 8794, 11894, 14970])
  })

  it('draws real variable intervals between 25 and 40 ms without a grid', () => {
    const stats = intervalStats(model('android-vfr'))
    expect(stats.minMs).toBeGreaterThanOrEqual(25)
    expect(stats.maxMs).toBeLessThanOrEqual(40)
    expect(stats.minMs).toBeLessThan(25.5)
    expect(stats.maxMs).toBeGreaterThan(39.5)
    const intervals = new Set(model('android-vfr').pts.slice(1).map((tick, index, list) => tick - (index ? list[index - 1] : 0)))
    expect(intervals.size).toBeGreaterThan(200)
  })

  it('rounds 29.97 fps onto the iPhone timescale of 600 (20 or 21 ticks), and 30 fps to exactly 20', () => {
    const ntsc = model('iphone-hevc-2997').pts
    expect(ntsc.every((tick, k) => tick === Math.round(k * 600 * 1001 / 30_000))).toBe(true)
    expect(new Set(ntsc.slice(1).map((tick, index) => tick - ntsc[index]))).toEqual(new Set([20, 21]))
    expect(new Set(model('iphone-h264-30').pts.slice(1).map((tick, index, list) => tick - (index ? list[index - 1] : 0)))).toEqual(new Set([20]))
  })

  it('answers which frame a correct player shows at a time', () => {
    const android = model('android-h264')
    expect(frameIndexAt(android, 0)).toBe(0)
    expect(frameIndexAt(android, frameTime(android, 100))).toBe(100)
    expect(frameIndexAt(android, frameTime(android, 100) - 1 / 90_000)).toBe(99)
    expect(frameIndexAt(android, 60)).toBe(449)
    const long = model('multi-gb')
    expect(frameIndexAt(long, 1000)).toBeGreaterThanOrEqual(29_999)
    expect(frameIndexAt(long, 1000)).toBeLessThanOrEqual(30_000)
  })

  it('refuses to segment a variable-rate profile (its timestamps are a running sum)', () => {
    expect(() => setptsExpression(PHONE_FOOTAGE_PROFILES['android-vfr'], 100)).toThrow(/cannot be segmented/)
  })
})

describe('phone footage cache location', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('keeps short profiles in test-results and sends the 10-minute and multi-GB files to os.tmpdir()', () => {
    vi.stubEnv('MASTERSELECTS_PHONE_FOOTAGE_DIR', '')
    expect(phoneFootageDirectory(PHONE_FOOTAGE_PROFILES['android-60'])).toBe(PHONE_FOOTAGE_DIR)
    expect(phoneFootageDirectory(phoneFootageProfile('multi-gb', 'small'))).toBe(PHONE_FOOTAGE_DIR)
    expect(phoneFootageDirectory(PHONE_FOOTAGE_PROFILES['long-10min'])).toBe(PHONE_FOOTAGE_HEAVY_DIR)
    expect(phoneFootageDirectory(PHONE_FOOTAGE_PROFILES['multi-gb'])).toBe(PHONE_FOOTAGE_HEAVY_DIR)
    expect(PHONE_FOOTAGE_HEAVY_DIR.startsWith(os.tmpdir())).toBe(true)
  })

  it('lets MASTERSELECTS_PHONE_FOOTAGE_DIR move every profile', () => {
    vi.stubEnv('MASTERSELECTS_PHONE_FOOTAGE_DIR', '/mnt/big/footage')
    expect(phoneFootageDirectory(PHONE_FOOTAGE_PROFILES['multi-gb'])).toBe('/mnt/big/footage')
    expect(phoneFootageDirectory(PHONE_FOOTAGE_PROFILES['android-h264'])).toBe('/mnt/big/footage')
  })

  it('refuses to generate when the disk cannot hold the file, with a message that names the fix', async () => {
    await expect(assertFreeSpace(os.tmpdir(), 1e15, 'multi-gb')).rejects.toThrow(/multi-gb needs about 1000000\.00 GB.*MASTERSELECTS_PHONE_FOOTAGE_DIR/)
  })
})

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe.skipIf(!hasFfmpeg)('generated phone footage, small versions (ffprobe proof)', () => {
  const ids = Object.keys(PHONE_FOOTAGE_PROFILES) as PhoneFootageProfileId[]

  it.each(ids)('%s: container timestamps, codec, timescale and frame codes match the model', async id => {
    const footage = await phoneFootage(id, { size: 'small' })
    const profile = footage.model.profile
    const probe = await probeFootage(footage.path, { source: 'frames' })
    const report = checkFootageProbe(footage.model, probe)
    expect(report.problems).toEqual([])
    expect(report.maxDeviationTicks).toBe(0)
    // Packet timestamps (what the fast multi-GB check uses) agree with the decoded frames.
    expect((await probeFootage(footage.path, { source: 'packets' })).pts).toEqual(probe.pts)
    const boxes = (await topLevelBoxes(footage.path)).map(box => box.type)
    expect(boxes.indexOf('moov'), 'moov after mdat, like a phone muxer').toBeGreaterThan(boxes.indexOf('mdat'))
    if (profile.container === 'mov') expect(probe.container.majorBrand).toBe('qt  ')
    else expect(probe.container.majorBrand).toBe(profile.brand)
    expect(probe.audio?.channels).toBe(profile.audio.channels)
    expect(Math.abs(probe.audio!.durationSeconds - footage.model.endTicks / profile.timescale)).toBeLessThan(0.05)
    if (profile.minBytes) expect(footage.bytes).toBeGreaterThanOrEqual(profile.minBytes)
    const frames = await checkFootageFrames(footage.path, footage.model)
    expect(frames.problems).toEqual([])
  }, 120_000)

  it('reads frame numbers above 4095 from the high code row (and the low row with the v1 oracle)', async () => {
    const profile = phoneFootageProfile('android-h264', 'small')
    for (const offset of [4094, 1_000_000]) {
      const { stdout } = await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=144x256:r=30`, '-vf', phoneFrameCodeFilter(profile, offset),
        '-frames:v', '4', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
      const size = profile.width * profile.height * 3
      expect(stdout.length).toBe(size * 4)
      for (let index = 0; index < 4; index++) {
        const pixels = { width: profile.width, height: profile.height, channels: 3 as const, data: stdout.subarray(index * size, (index + 1) * size) }
        expect(readPhoneFrameCode(pixels).frame).toBe(offset + index)
        expect(readFrameCode(pixels).frame).toBe((offset + index) % 4096)
      }
    }
  }, 60_000)
})
