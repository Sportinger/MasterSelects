import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertFreeSpace, phoneFootage, phoneFootageDirectory, phoneFootageName, phoneFootageProfile, phoneFrameCodeFilter, segmentDirectory,
  SEGMENTS_KEPT_MARKER,
} from '../playwright/fixtures/phoneFootage'
import { withFileLock } from '../playwright/fixtures/testMediaLock'
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

  it('keeps every profile, the 10-minute and multi-GB ones included, in the shared test media cache on disk', () => {
    vi.stubEnv('MASTERSELECTS_PHONE_FOOTAGE_DIR', '')
    vi.stubEnv('MASTERSELECTS_TEST_MEDIA_DIR', '')
    expect(phoneFootageDirectory()).toBe(path.join(os.homedir(), '.cache', 'masterselects-test-media', 'phone-footage'))
    vi.stubEnv('MASTERSELECTS_TEST_MEDIA_DIR', '/mnt/cache/media')
    expect(phoneFootageDirectory()).toBe(path.resolve('/mnt/cache/media/phone-footage'))
  })

  it('lets MASTERSELECTS_PHONE_FOOTAGE_DIR move every profile', () => {
    vi.stubEnv('MASTERSELECTS_PHONE_FOOTAGE_DIR', '/mnt/big/footage')
    expect(phoneFootageDirectory()).toBe(path.resolve('/mnt/big/footage'))
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

/** Phone footage in a temporary folder (MASTERSELECTS_PHONE_FOOTAGE_DIR), with its log lines. */
function footageFolder() {
  const state = { dir: '', lines: [] as string[], log: (line: string) => { state.lines.push(line) } }
  beforeEach(async () => {
    state.dir = await mkdtemp(path.join(os.tmpdir(), 'phone-footage-'))
    state.lines = []
    vi.stubEnv('MASTERSELECTS_PHONE_FOOTAGE_DIR', state.dir)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(state.dir, { recursive: true, force: true })
  })
  return state
}

/** Holds `lock` from this process until the returned release is called. */
async function holdLock(lock: string): Promise<{ release: () => Promise<void> }> {
  let release!: () => void
  let held!: () => void
  const holding = new Promise<void>(resolve => { held = resolve })
  const holder = withFileLock(lock, () => { held(); return new Promise<void>(resolve => { release = resolve }) }, { log: () => {} })
  await holding
  return { release: async () => { release(); await holder } }
}

describe('phone footage in the cache: expectation sidecar and leftover segments', () => {
  const folder = footageFolder()
  /** A cached footage file (any bytes): the call is a local hit and needs no ffmpeg. */
  const seed = async (id: PhoneFootageProfileId) => {
    const profile = phoneFootageProfile(id, 'small')
    await writeFile(path.join(folder.dir, `${phoneFootageName(profile)}.${profile.container}`), 'cached')
    return profile
  }

  it('writes the expectation once when one profile is asked for several times at once', async () => {
    await seed('android-h264')
    const results = await Promise.all(Array.from({ length: 4 }, () => phoneFootage('android-h264', { size: 'small', log: folder.log })))
    expect(new Set(results.map(result => result.expectPath)).size).toBe(1)
    const written = JSON.parse(await readFile(results[0].expectPath, 'utf8')) as { file: string; pts: number[] }
    expect(written.file).toBe(path.basename(results[0].path))
    expect(written.pts).toEqual(results[0].model.pts)
    expect((await readdir(folder.dir)).filter(name => name.includes('.tmp'))).toEqual([])
  })

  it('removes the segments an interrupted run left behind on the next call, unless kept on purpose or in use', async () => {
    const profile = await seed('long-10min')
    const segments = segmentDirectory(profile, folder.dir)
    await mkdir(segments, { recursive: true })
    await writeFile(path.join(segments, 'seg-0000-30.ts'), 'x'.repeat(1000))
    // In use by another run: left alone, without waiting for it.
    const user = await holdLock(`${segments}.lock`)
    await phoneFootage('long-10min', { size: 'small', log: folder.log })
    expect(existsSync(segments)).toBe(true)
    await user.release()
    // Kept on purpose by an earlier keepSegments run, or wanted by this call: left for reuse.
    await writeFile(path.join(segments, SEGMENTS_KEPT_MARKER), 'long-10min\n')
    await phoneFootage('long-10min', { size: 'small', log: folder.log })
    await rm(path.join(segments, SEGMENTS_KEPT_MARKER))
    await phoneFootage('long-10min', { size: 'small', log: folder.log, keepSegments: true })
    expect(existsSync(segments)).toBe(true)
    await phoneFootage('long-10min', { size: 'small', log: folder.log })
    expect(existsSync(segments)).toBe(false)
    expect(folder.lines.filter(line => line.includes('removed the segments an interrupted run left behind (1 file,'))).toHaveLength(1)
  })
})

describe.skipIf(!hasFfmpeg)('segmented phone footage sharing one segment folder (small versions)', () => {
  const folder = footageFolder()

  it('waits for the lock of the segment folder while another run uses it', async () => {
    const profile = phoneFootageProfile('long-10min', 'small')
    const segments = segmentDirectory(profile, folder.dir)
    await mkdir(path.dirname(segments), { recursive: true })
    const user = await holdLock(`${segments}.lock`)
    const pending = phoneFootage('long-10min', { size: 'small', log: folder.log })
    await vi.waitFor(() => expect(folder.lines.some(line => line.includes('waiting for the shared segments'))).toBe(true), { timeout: 10_000, interval: 20 })
    expect(existsSync(segments), 'nothing encoded into the folder in use').toBe(false)
    await user.release()
    const footage = await pending
    expect(footage.generatedMs).toBeGreaterThan(0)
    expect(existsSync(segments)).toBe(false)
  }, 60_000)

  it('builds long-10min and multi-gb at once from the shared segments', async () => {
    const [long, multi] = await Promise.all((['long-10min', 'multi-gb'] as const).map(id => phoneFootage(id, { size: 'small', log: folder.log })))
    for (const footage of [long, multi]) {
      expect(checkFootageProbe(footage.model, await probeFootage(footage.path, { source: 'packets' })).problems, footage.model.profile.id).toEqual([])
    }
    expect(existsSync(segmentDirectory(long.model.profile, folder.dir))).toBe(false)
  }, 120_000)
})
