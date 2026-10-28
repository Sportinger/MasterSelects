/**
 * Realistic phone footage: the profiles and their expectation models. Pure
 * data and arithmetic, no ffmpeg (generation lives in phoneFootage.ts), so a
 * test on a real phone can load the model without the generator.
 *
 * Every profile describes how a phone's muxer writes a recording: container,
 * codec, coded and displayed size, track timescale, and the presentation
 * timestamp of every frame. The timestamps come from integer formulas that the
 * generator hands to ffmpeg's setpts filter verbatim, so the file and the model
 * agree tick for tick (tests/unit/phoneFootage.test.ts proves it with
 * ffprobe -show_frames). Frame k of a recording always shows frame code k
 * (assertions/phoneFootageOracle.ts reads it, also beyond 4095).
 */

/**
 * Second code row of the phone chart: bits 12-23 of the frame number with the
 * v1 check nibble, in the gap between the v1 code band and the colour bars.
 */
export const PHONE_HIGH_ROW: readonly [number, number] = [0.19, 0.25]

/** A nominal frame rate as a fraction, e.g. [30000, 1001] for 29.97. */
export type FrameRate = readonly [number, number]

export type PhoneTiming =
  /** Nominal grid, rounded to the track timescale, plus a deterministic per-frame jitter of up to ±`jitterTicks` (none for frame 0). */
  | { kind: 'grid'; fps: FrameRate; jitterTicks: number; seed: number }
  /** Real variable rate: every interval is drawn from [minTicks, maxTicks]; no underlying grid. */
  | { kind: 'vfr'; minTicks: number; maxTicks: number; seed: number }

export interface PhoneFootageProfile {
  id: PhoneFootageProfileId
  description: string
  container: 'mp4' | 'mov'
  codec: 'h264' | 'hevc'
  /** Displayed size (after the rotation matrix). */
  width: number
  height: number
  /**
   * Display rotation written into the track matrix, in ffmpeg's convention
   * (counter-clockwise degrees). -90 is how an Android phone held upright
   * writes its landscape-coded frames: coded width and height are swapped.
   */
  rotation: 0 | -90
  timescale: number
  timing: PhoneTiming
  seconds: number
  videoKbps: number
  bframes: number
  /** Keyframe interval in frames. */
  gop: number
  audio: { sampleRate: number; channels: 1 | 2; kbps: number }
  /** MP4 major brand; mov files keep ffmpeg's `qt  `. */
  brand?: string
  movieTimescale?: number
  /** Long recordings: encoded as GOP-aligned MPEG-TS segments, concatenated without re-encoding, remuxed into MP4. */
  segmentSeconds?: number
  /** The finished file must be at least this large (the multi-GB profile). */
  minBytes?: number
}

export type PhoneFootageProfileId =
  | 'android-h264' | 'android-hevc' | 'android-h264-rotated' | 'android-vfr' | 'android-60'
  | 'iphone-h264-30' | 'iphone-hevc-30' | 'iphone-h264-2997' | 'iphone-hevc-2997'
  | 'long-10min' | 'multi-gb'

const ANDROID_AUDIO = { sampleRate: 48_000, channels: 2, kbps: 192 } as const
const IPHONE_AUDIO = { sampleRate: 44_100, channels: 2, kbps: 160 } as const
const SEED = 20261028
/** ±4 ms at 90 kHz. */
const ANDROID_JITTER = 360

const android = (id: PhoneFootageProfileId, description: string, overrides: Partial<PhoneFootageProfile>): PhoneFootageProfile => ({
  id, description, container: 'mp4', codec: 'h264', width: 1080, height: 1920, rotation: 0, timescale: 90_000,
  timing: { kind: 'grid', fps: [30, 1], jitterTicks: ANDROID_JITTER, seed: SEED }, seconds: 15, videoKbps: 17_000,
  bframes: 0, gop: 30, audio: ANDROID_AUDIO, brand: 'mp42', ...overrides,
})

const iphone = (id: PhoneFootageProfileId, description: string, overrides: Partial<PhoneFootageProfile>): PhoneFootageProfile => ({
  id, description, container: 'mov', codec: 'h264', width: 1080, height: 1920, rotation: 0, timescale: 600,
  timing: { kind: 'grid', fps: [30, 1], jitterTicks: 0, seed: SEED }, seconds: 15, videoKbps: 16_000,
  bframes: 0, gop: 30, audio: IPHONE_AUDIO, movieTimescale: 600, ...overrides,
})

export const PHONE_FOOTAGE_PROFILES: Record<PhoneFootageProfileId, PhoneFootageProfile> = {
  'android-h264': android('android-h264', 'Android MediaMuxer: H.264 High, 30 fps nominal, timescale 90000, ±4 ms capture jitter, AAC 48 kHz, moov at the end', {}),
  'android-hevc': android('android-hevc', 'Android MediaMuxer: HEVC Main (hvc1), otherwise as android-h264', { codec: 'hevc', videoKbps: 10_000 }),
  'android-h264-rotated': android('android-h264-rotated',
    'Android portrait recording as phones write it: coded 1920x1080 with a -90° display matrix, otherwise as android-h264', { rotation: -90 }),
  'android-vfr': android('android-vfr', 'Android variable frame rate: every interval 25-40 ms, no grid, timescale 90000',
    { timing: { kind: 'vfr', minTicks: 2_250, maxTicks: 3_600, seed: SEED } }),
  'android-60': android('android-60', 'Android 60 fps: timescale 90000, ±2 ms jitter, keyframe every second',
    { timing: { kind: 'grid', fps: [60, 1], jitterTicks: 180, seed: SEED }, videoKbps: 24_000, gop: 60 }),
  'iphone-h264-30': iphone('iphone-h264-30', 'iPhone MOV: H.264, 30 fps, timescale 600 (20 ticks per frame), AAC 44.1 kHz', {}),
  'iphone-hevc-30': iphone('iphone-hevc-30', 'iPhone MOV: HEVC (hvc1) with B-frames, 30 fps, timescale 600', { codec: 'hevc', videoKbps: 8_000, bframes: 2 }),
  'iphone-h264-2997': iphone('iphone-h264-2997',
    'iPhone MP4 export: H.264, 29.97 fps on timescale 600 (intervals of 20 and 21 ticks)', { container: 'mp4', brand: 'mp42', timing: { kind: 'grid', fps: [30_000, 1_001], jitterTicks: 0, seed: SEED } }),
  'iphone-hevc-2997': iphone('iphone-hevc-2997', 'iPhone MOV: HEVC with B-frames, 29.97 fps on timescale 600',
    { codec: 'hevc', videoKbps: 8_000, bframes: 2, timing: { kind: 'grid', fps: [30_000, 1_001], jitterTicks: 0, seed: SEED } }),
  'long-10min': android('long-10min', 'Ten-minute Android recording at ~16 Mbit/s, built from 60 s segments without re-encoding',
    { seconds: 600, videoKbps: 16_000, segmentSeconds: 60 }),
  'multi-gb': android('multi-gb', 'Multi-GB Android recording (> 2.5 GB, past the signed 32-bit offset range), 24 min from the same segments',
    { seconds: 1_440, videoKbps: 16_000, segmentSeconds: 60, minBytes: 2_500_000_000 }),
}

/** Small versions of every profile for unit tests: same timing, timescale, codec and container, much smaller and shorter. */
export function smallProfile(profile: PhoneFootageProfile): PhoneFootageProfile {
  const area = (180 * 320) / (profile.width * profile.height)
  const segmentSeconds = profile.segmentSeconds ? 1 : undefined
  const seconds = profile.id === 'multi-gb' ? 4 : profile.segmentSeconds ? 3 : Math.min(profile.seconds, 3)
  const videoKbps = Math.max(300, Math.round(profile.videoKbps * area))
  return {
    ...profile, width: 180, height: 320, seconds, videoKbps, segmentSeconds,
    minBytes: profile.minBytes ? Math.round(videoKbps * 125 * seconds * 0.7) : undefined,
  }
}

export interface FootageExpectation {
  profile: PhoneFootageProfile
  /** Presentation time of frame k in track ticks; frame k shows frame code k. */
  pts: number[]
  /** End of the last frame in ticks (its start plus the nominal frame duration). */
  endTicks: number
  /** Coded size as stored in the stream (swapped for a rotated profile). */
  codedWidth: number
  codedHeight: number
}

const hash = (k: number, seed: number, modulus: number) => (k * k * 7919 + k * 104_729 + seed * 15_485_863) % modulus

/** Rounded nominal tick of frame k: round(k * timescale * den / num), half up. */
const gridTick = (k: number, timescale: number, [num, den]: FrameRate) => Math.floor((k * timescale * den * 2 + num) / (2 * num))

export function nominalFrameTicks(profile: PhoneFootageProfile): number {
  const fps = profile.timing.kind === 'grid' ? profile.timing.fps : [30, 1] as const
  return Math.round(profile.timescale * fps[1] / fps[0])
}

/** Builds the expectation model: which frame (code) is presented at which tick. */
export function footageExpectation(profile: PhoneFootageProfile): FootageExpectation {
  const { timing, timescale } = profile, limit = profile.seconds * timescale, pts: number[] = []
  if (timing.kind === 'grid') {
    const frames = Math.round(profile.seconds * timing.fps[0] / timing.fps[1])
    const jitterModulus = 2 * timing.jitterTicks + 1
    for (let k = 0; k < frames; k++) {
      pts.push(gridTick(k, timescale, timing.fps) + (k > 0 && timing.jitterTicks > 0 ? hash(k, timing.seed, jitterModulus) - timing.jitterTicks : 0))
    }
  } else {
    for (let k = 0, tick = 0; tick < limit; k++) {
      pts.push(tick)
      tick += timing.minTicks + hash(k + 1, timing.seed, timing.maxTicks - timing.minTicks + 1)
    }
  }
  if (pts.length > 1 << 24) throw new Error(`${profile.id}: ${pts.length} frames exceed the 24-bit phone frame code`)
  const rotated = profile.rotation !== 0
  return {
    profile, pts, endTicks: pts[pts.length - 1] + nominalFrameTicks(profile),
    codedWidth: rotated ? profile.height : profile.width, codedHeight: rotated ? profile.width : profile.height,
  }
}

/** ffmpeg setpts expression (in the track timebase) that produces exactly `footageExpectation(profile).pts`. `offset` = index of the first frame. */
export function setptsExpression(profile: PhoneFootageProfile, offset = 0): string {
  const { timing, timescale } = profile, k = `(N+${offset})`
  if (timing.kind === 'grid') {
    const [num, den] = timing.fps
    const grid = `floor((${k}*${timescale * den * 2}+${num})/${2 * num})`
    if (timing.jitterTicks === 0) return grid
    const jitter = `mod(${k}*${k}*7919+${k}*104729+${timing.seed * 15_485_863},${2 * timing.jitterTicks + 1})-${timing.jitterTicks}`
    return `if(eq(${k},0),0,${grid}+${jitter})`
  }
  if (offset !== 0) throw new Error('a variable-rate profile cannot be segmented: its timestamps are a running sum')
  const interval = `${timing.minTicks}+mod(N*N*7919+N*104729+${timing.seed * 15_485_863},${timing.maxTicks - timing.minTicks + 1})`
  return `if(eq(N,0),0,PREV_OUTPTS+${interval})`
}

/** The frame (code) a correct player shows at `seconds`: the last frame whose presentation time is not after it. */
export function frameIndexAt(model: FootageExpectation, seconds: number): number {
  const tick = seconds * model.profile.timescale
  let low = 0, high = model.pts.length - 1
  if (tick < model.pts[0]) return 0
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (model.pts[middle] <= tick + 1e-6) low = middle
    else high = middle - 1
  }
  return low
}

/** Presentation time of frame `index` in seconds. */
export function frameTime(model: FootageExpectation, index: number): number {
  return model.pts[index] / model.profile.timescale
}

export interface IntervalStats { minTicks: number; maxTicks: number; minMs: number; maxMs: number; maxJitterMs: number }

/** Interval spread of a model, and the largest deviation from the nominal grid (grid profiles). */
export function intervalStats(model: FootageExpectation): IntervalStats {
  const intervals = model.pts.slice(1).map((value, index) => value - model.pts[index])
  const minTicks = Math.min(...intervals), maxTicks = Math.max(...intervals), { timing, timescale } = model.profile
  const maxJitter = timing.kind === 'grid'
    ? Math.max(...model.pts.map((value, k) => Math.abs(value - gridTick(k, timescale, timing.fps)))) : Number.NaN
  return { minTicks, maxTicks, minMs: minTicks * 1000 / timescale, maxMs: maxTicks * 1000 / timescale, maxJitterMs: maxJitter * 1000 / timescale }
}
