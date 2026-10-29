import { execFile } from 'node:child_process'
import { access, lstat, mkdir, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { FRAME_CODE_LAYOUT } from './frameCodeMedia.ts'
import { uniqueSuffix, withFileLock, withFileLockIfFree } from './testMediaLock.ts'
import { ensureTestMedia, removeLeftovers, testMediaDir, testMediaLog } from './testMediaStore.ts'
import {
  footageExpectation, nominalFrameTicks, PHONE_FOOTAGE_PROFILES, PHONE_HIGH_ROW, setptsExpression, smallProfile,
  type FootageExpectation, type PhoneFootageProfile, type PhoneFootageProfileId,
} from './phoneFootageProfiles.ts'

const run = promisify(execFile)

/**
 * Generates realistic phone recordings (profiles in phoneFootageProfiles.ts)
 * with ffmpeg on demand. No media is checked in and nothing comes from a real
 * phone: every file is synthetic and kept in the shared test media store
 * (fixtures/testMediaStore.ts: local cache `phone-footage/` folder, fetched
 * from or uploaded to the remote when one is configured), keyed by all of its
 * parameters, next to a `.expect.json` sidecar with the expectation model.
 *
 * The picture is the v1 frame-code chart (fixtures/frameCodeMedia.ts, read by
 * assertions/frameCodeOracle.ts) plus a second code row for frame numbers above
 * 4095 (assertions/phoneFootageOracle.ts reads both rows). The chart is drawn
 * at 144 px width and scaled up with nearest-neighbour, which keeps a
 * 1080x1920 frame cheap to generate; temporal luma noise makes the encoder
 * spend a realistic bitrate (rate-capped at the profile's bitrate).
 */
/*
 * Sizes and generation times (24-thread Linux host, ffmpeg 8.0.1, 2026-10-28;
 * `node scripts/generate-phone-footage.mjs <id> --frames` also decodes every
 * frame and checks its code):
 *
 *   profile               file  size      frames  generated  verified
 *   android-h264          mp4   30.1 MB      450     7.5 s     3.6 s
 *   android-hevc          mp4   19.3 MB      450     8.3 s     4.1 s
 *   android-h264-rotated  mp4   30.1 MB      450     7.3 s     3.5 s
 *   android-vfr           mp4   30.1 MB      463     7.4 s     3.8 s
 *   android-60            mp4   44.3 MB      900    14.5 s     5.8 s
 *   iphone-h264-30        mov   28.2 MB      450     7.2 s     3.5 s
 *   iphone-hevc-30        mov   15.5 MB      450     9.8 s     4.5 s
 *   iphone-h264-2997      mp4   28.3 MB      450     7.7 s     3.9 s
 *   iphone-hevc-2997      mov   15.5 MB      450     8.9 s     4.3 s
 *   long-10min            mp4   1154 MB    18000   156 s       18 s   (+1.15 GB segments while building)
 *   multi-gb              mp4   2769 MB    43200   229 s *     44 s   (* reusing long-10min's 10 segments)
 *
 * The small unit-test versions (180x320, 3-4 s) take well under a second each.
 */
export const PHONE_FOOTAGE_REVISION = 1

/** Folder of the phone footage inside the test media store (key prefix and local cache folder). */
export const PHONE_FOOTAGE_KEY_PREFIX = 'phone-footage'

export interface PhoneFootageOptions {
  /** `small`: the unit-test version of the profile (180x320, a few seconds, same timing). */
  size?: 'full' | 'small'
  /**
   * Keep the MPEG-TS segments of a segmented profile (they let multi-gb reuse long-10min's encode). Default false:
   * the segments are removed after the remux, and segments an interrupted run left behind are removed on the next call.
   */
  keepSegments?: boolean
  /** Progress lines for the CLI. */
  log?: (line: string) => void
}

export interface PhoneFootage {
  path: string
  expectPath: string
  model: FootageExpectation
  bytes: number
  /** Wall time of the generation in ms; 0 when the file came from the cache. */
  generatedMs: number
  /** Background upload to the test media remote (true when it arrived), null when none was started. */
  upload: Promise<boolean> | null
}

export function phoneFootageProfile(id: PhoneFootageProfileId, size: 'full' | 'small' = 'full'): PhoneFootageProfile {
  const profile = PHONE_FOOTAGE_PROFILES[id]
  if (!profile) throw new Error(`unknown phone footage profile ${id}; known: ${Object.keys(PHONE_FOOTAGE_PROFILES).join(', ')}`)
  return size === 'small' ? smallProfile(profile) : profile
}

/** Cache name: every parameter that changes the bytes is in it. */
export function phoneFootageName(profile: PhoneFootageProfile): string {
  const timing = profile.timing.kind === 'grid'
    ? `grid${profile.timing.fps.join('-')}j${profile.timing.jitterTicks}s${profile.timing.seed}`
    : `vfr${profile.timing.minTicks}-${profile.timing.maxTicks}s${profile.timing.seed}`
  return `phone-r${PHONE_FOOTAGE_REVISION}-${profile.id}-${profile.width}x${profile.height}r${profile.rotation}-${profile.codec}-ts${profile.timescale}`
    + `-${timing}-${profile.seconds}s-${profile.videoKbps}k-b${profile.bframes}g${profile.gop}`
    + `-a${profile.audio.sampleRate}c${profile.audio.channels}-${profile.audio.kbps}k${profile.segmentSeconds ? `-seg${profile.segmentSeconds}` : ''}`
}

/** The ffmpeg filter that paints frame `N + offset` (display orientation, then the coded orientation). */
export function phoneFrameCodeFilter(profile: PhoneFootageProfile, offset = 0): string {
  const { blocks, numberBits, codeBand, barBand, rampBand, bars, black, white, background } = FRAME_CODE_LAYOUT
  const { width, height } = profile
  const k = `(N+${offset})`
  const code = (value: string) => {
    const nibble = (n: number) => `mod(floor(${value}/${16 ** n}),16)`
    const check = `(15-mod(${nibble(0)}+${nibble(1)}+${nibble(2)},16))`
    const bit = (n: number) => n < numberBits ? `mod(floor(${value}/${2 ** n}),2)` : `mod(floor(${check}/${2 ** (n - numberBits)}),2)`
    return Array.from({ length: blocks }, (_, n) => `eq(floor(X*${blocks}/W),${n})*${bit(n)}`).join('+')
  }
  const band = ([from, to]: readonly [number, number]) => `between(Y,H*${from},H*${to}-1)`
  const level = (bits: string) => `${black}+${white - black}*(${bits})`
  const barValue = (channel: number) => `(${bars.map((item, index) => `eq(floor(X*${bars.length}/W),${index})*${item.rgb[channel]}`).join('+')})`
  const ramp = `(${black}+floor(X*8/W)*30)`
  const value = (channel: number) => `if(${band(codeBand)},${level(code(`mod(${k},4096)`))},`
    + `if(${band(PHONE_HIGH_ROW)},${level(code(`floor(${k}/4096)`))},`
    + `if(${band(barBand)},${barValue(channel)},if(${band(rampBand)},${ramp},${background}))))`
  const fontSize = Math.max(12, Math.round(Math.min(width * 0.04, height * 0.07)))
  const orient = profile.rotation === -90 ? ',transpose=cclock' : ''
  return `geq=r='${value(0)}':g='${value(1)}':b='${value(2)}',`
    + `scale=w=${width}:h=${height}:flags=neighbor:out_color_matrix=bt709:out_range=tv,format=yuv420p,`
    + 'noise=c0s=8:c0f=t,'
    + `drawtext=text='%{eif\\:n+${offset}\\:d}':x=w*0.02:y=h*0.9:fontsize=${fontSize}:fontcolor=white`
    + `${orient},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,`
    + `settb=1/${profile.timescale},setpts='${setptsExpression(profile, offset)}'`
}

/** Source frame rate: the nominal rate, so each frame carries the nominal duration (the last sample's duration in the file). */
const sourceRate = (profile: PhoneFootageProfile) => profile.timing.kind === 'grid' ? profile.timing.fps.join('/') : '30'

/** Size of the chart canvas before the nearest-neighbour scale. */
function canvasSize({ width, height }: PhoneFootageProfile): [number, number] {
  if (width <= 144) return [width, height]
  return [144, Math.max(2, Math.round((144 * height) / width / 2) * 2)]
}

function encoderArgs(profile: PhoneFootageProfile): string[] {
  const kbps = profile.videoKbps
  if (profile.codec === 'hevc') {
    return ['-c:v', 'libx265', '-preset', 'superfast', '-profile:v', 'main', '-tag:v', 'hvc1', '-b:v', `${kbps}k`,
      '-x265-params', `log-level=error:bframes=${profile.bframes}:keyint=${profile.gop}:min-keyint=${profile.gop}:scenecut=0:vbv-maxrate=${kbps}:vbv-bufsize=${kbps}`]
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-bf', String(profile.bframes), '-g', String(profile.gop),
    '-keyint_min', String(profile.gop), '-sc_threshold', '0', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`]
}

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

function containerArgs(profile: PhoneFootageProfile): string[] {
  return ['-video_track_timescale', String(profile.timescale),
    ...(profile.movieTimescale ? ['-movie_timescale', String(profile.movieTimescale)] : []),
    ...(profile.brand ? ['-brand', profile.brand] : [])]
}

/** A low tone with a beep at every whole second (sine `beep_factor`), so audio/video sync stays checkable. */
function audioInput(profile: PhoneFootageProfile, seconds: number): string[] {
  return ['-f', 'lavfi', '-i', `sine=frequency=440:beep_factor=2:sample_rate=${profile.audio.sampleRate}:duration=${seconds.toFixed(6)}`]
}

function audioArgs(profile: PhoneFootageProfile): string[] {
  return ['-c:a', 'aac', '-b:a', `${profile.audio.kbps}k`, '-ac', String(profile.audio.channels), '-ar', String(profile.audio.sampleRate)]
}

async function ffmpeg(args: string[], what: string): Promise<void> {
  try {
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(code === 'ENOENT'
      ? 'ffmpeg is not installed on this test host; the phone footage is generated with it (install ffmpeg and rerun).'
      : `ffmpeg could not ${what}: ${(error as Error).message.slice(0, 1200)}`)
  }
}

const exists = (file: string) => access(file).then(() => true, () => false)

const TMPFS_MAGIC = 0x01021994

/**
 * Refuses to start when the cache disk cannot hold the result: a full disk
 * breaks every agent on the host. On a tmpfs the files live in RAM, so the
 * available memory must cover them as well.
 */
export async function assertFreeSpace(directory: string, bytes: number, what: string): Promise<void> {
  const info = await statfs(directory)
  const free = info.bavail * info.bsize, margin = 1024 ** 3
  if (free < bytes + margin) {
    throw new Error(`${what} needs about ${(bytes / 1e9).toFixed(2)} GB plus 1 GB headroom, but only ${(free / 1e9).toFixed(2)} GB are free in ${directory}. `
      + 'Free disk space or point MASTERSELECTS_TEST_MEDIA_DIR (or MASTERSELECTS_PHONE_FOOTAGE_DIR) at a larger disk.')
  }
  if (info.type === TMPFS_MAGIC && os.freemem() < bytes + 2 * margin) {
    throw new Error(`${what} needs about ${(bytes / 1e9).toFixed(2)} GB in ${directory}, a tmpfs (RAM), but only ${(os.freemem() / 1e9).toFixed(2)} GB of memory are available. `
      + 'Point MASTERSELECTS_TEST_MEDIA_DIR (or MASTERSELECTS_PHONE_FOOTAGE_DIR) at a disk with enough space.')
  }
}

/** Estimated size of the finished file (video and audio bitrate, 5 % container and rate-control slack). */
export const expectedBytes = (profile: PhoneFootageProfile) => (profile.videoKbps + profile.audio.kbps) * 125 * profile.seconds * 1.05

/**
 * Where the footage is cached locally: MASTERSELECTS_PHONE_FOOTAGE_DIR when
 * set, else the `phone-footage` folder of the shared test media cache
 * (MASTERSELECTS_TEST_MEDIA_DIR, default ~/.cache/masterselects-test-media),
 * on disk for every profile, the multi-GB ones included.
 */
export function phoneFootageDirectory(): string {
  const configured = process.env.MASTERSELECTS_PHONE_FOOTAGE_DIR?.trim()
  return configured ? path.resolve(configured) : path.join(testMediaDir(), PHONE_FOOTAGE_KEY_PREFIX)
}

/** Generates (or reuses) a phone footage file and its expectation sidecar. */
export async function phoneFootage(id: PhoneFootageProfileId, options: PhoneFootageOptions = {}): Promise<PhoneFootage> {
  return generatePhoneFootage(phoneFootageProfile(id, options.size), options)
}

/** Same for a custom profile (e.g. a derived one with another size or length); the cache name covers every parameter. */
export async function generatePhoneFootage(profile: PhoneFootageProfile, options: Omit<PhoneFootageOptions, 'size'> = {}): Promise<PhoneFootage> {
  const model = footageExpectation(profile)
  const name = phoneFootageName(profile)
  const configured = process.env.MASTERSELECTS_PHONE_FOOTAGE_DIR?.trim()
  const media = await ensureTestMedia(`${PHONE_FOOTAGE_KEY_PREFIX}/${name}.${profile.container}`, async target => {
    const directory = path.dirname(target)
    options.log?.(`${profile.id}: generating into ${directory}`)
    if (profile.segmentSeconds) await renderSegmented(profile, model, directory, target, options)
    else await renderDirect(profile, model, directory, target)
    if (profile.rotation) {
      const rotated = `${target}.rot.${profile.container}`
      try {
        await ffmpeg(['-display_rotation:v:0', String(profile.rotation), '-i', target, '-map', '0', '-c', 'copy', ...containerArgs(profile), rotated], 'write the rotation matrix')
        await rename(rotated, target)
      } finally {
        await rm(rotated, { force: true })
      }
    }
    const bytes = (await stat(target)).size
    if (profile.minBytes && bytes < profile.minBytes) throw new Error(`${profile.id} came out at ${bytes} bytes, below its ${profile.minBytes}-byte minimum`)
  }, { directory: configured ? path.resolve(configured) : undefined, log: options.log, companions: [`${name}.expect.json`] })
  // The expectation is derived from the profile alone, so a fetched file gets it written here.
  const expectPath = path.join(path.dirname(media.path), `${name}.expect.json`)
  let writing = expectWrites.get(expectPath)
  if (!writing) {
    writing = writeExpectation(expectPath, { revision: PHONE_FOOTAGE_REVISION, file: path.basename(media.path), ...model }).finally(() => expectWrites.delete(expectPath))
    expectWrites.set(expectPath, writing)
  }
  await writing
  if (profile.segmentSeconds && media.source !== 'generated' && !options.keepSegments) {
    await removeInterruptedSegments(profile, segmentDirectory(profile, path.dirname(media.path)), options.log ?? testMediaLog)
  }
  return { path: media.path, expectPath, model, bytes: media.bytes, generatedMs: media.generatedMs, upload: media.upload }
}

/** Concurrent calls of one profile in this process share one write. */
const expectWrites = new Map<string, Promise<void>>()

/** Once per file: a unique temporary name, renamed into place, so concurrent processes never collide either. */
async function writeExpectation(expectPath: string, content: object): Promise<void> {
  if (await exists(expectPath)) return
  const temporary = `${expectPath}.${uniqueSuffix()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(content, null, 1))
    await rename(temporary, expectPath)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Marks a segment folder kept on purpose (keepSegments); one without it is the leftover of an interrupted run. */
export const SEGMENTS_KEPT_MARKER = 'kept'

/** The segment folder: shared by every profile with the same picture and timing (multi-gb reuses long-10min's). */
export function segmentDirectory(profile: PhoneFootageProfile, directory: string): string {
  return path.join(directory, 'segments', phoneFootageName({ ...profile, id: 'long-10min', seconds: 0, minBytes: undefined }))
}

/** Removes a segment folder an interrupted run left behind, unless it was kept on purpose or another run uses it right now. */
async function removeInterruptedSegments(profile: PhoneFootageProfile, segmentDir: string, log: (line: string) => void): Promise<void> {
  if (!await exists(segmentDir) || await exists(path.join(segmentDir, SEGMENTS_KEPT_MARKER))) return
  await withFileLockIfFree(`${segmentDir}.lock`, async () => {
    if (await exists(path.join(segmentDir, SEGMENTS_KEPT_MARKER))) return
    const names = await readdir(segmentDir).catch(() => [] as string[])
    let bytes = 0
    for (const name of names) bytes += (await lstat(path.join(segmentDir, name)).catch(() => null))?.size ?? 0
    await rm(segmentDir, { recursive: true, force: true })
    log(`${profile.id}: removed the segments an interrupted run left behind (${names.length} file${names.length === 1 ? '' : 's'}, ${(bytes / 1e6).toFixed(1)} MB) from ${segmentDir}`)
  }, { log })
}

const durationSeconds = (model: FootageExpectation) => model.endTicks / model.profile.timescale

/** One ffmpeg run: chart → setpts (exact ticks) → encoder in the track timebase → mp4/mov, moov at the end like a phone's muxer. */
async function renderDirect(profile: PhoneFootageProfile, model: FootageExpectation, directory: string, output: string): Promise<void> {
  await assertFreeSpace(directory, expectedBytes(profile) * 2, profile.id)
  const [canvasWidth, canvasHeight] = canvasSize(profile)
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${canvasWidth}x${canvasHeight}:r=${sourceRate(profile)}`, ...audioInput(profile, durationSeconds(model)),
    '-filter_complex', `[0:v]${phoneFrameCodeFilter(profile)}[v]`, '-map', '[v]', '-map', '1:a',
    '-frames:v', String(model.pts.length), '-fps_mode', 'passthrough', '-enc_time_base', `1:${profile.timescale}`,
    ...encoderArgs(profile), ...BT709, ...audioArgs(profile), ...containerArgs(profile), '-f', profile.container, output], `generate ${profile.id}`)
}

/**
 * Long recordings: GOP-aligned MPEG-TS segments (90 kHz, absolute timestamps,
 * encoded in parallel), joined with the concat protocol and remuxed into MP4
 * with -c copy, i.e. without re-encoding. The segment cache is shared by every
 * profile with the same picture and timing, so multi-gb reuses long-10min; a lock
 * on the segment folder keeps the two from encoding into it, or removing it, at
 * once. Finished segments of an interrupted run are reused, its temporaries removed.
 */
async function renderSegmented(profile: PhoneFootageProfile, model: FootageExpectation, directory: string, output: string, options: PhoneFootageOptions): Promise<void> {
  if (profile.timing.kind !== 'grid' || profile.timescale !== 90_000) throw new Error(`${profile.id}: segmented generation needs a 90 kHz grid profile`)
  const perSegment = Math.round(profile.segmentSeconds! * profile.timing.fps[0] / profile.timing.fps[1])
  if (perSegment % profile.gop !== 0) throw new Error(`${profile.id}: a segment (${perSegment} frames) must hold whole GOPs of ${profile.gop}`)
  const count = Math.ceil(model.pts.length / perSegment)
  const segmentDir = segmentDirectory(profile, directory)
  const log = options.log ?? testMediaLog
  await mkdir(path.dirname(segmentDir), { recursive: true })
  await withFileLock(`${segmentDir}.lock`, async () => {
    await removeLeftovers(path.dirname(segmentDir), [path.basename(segmentDir)], `the segments of ${profile.id}`, log)
    await mkdir(segmentDir, { recursive: true })
    await removeLeftovers(segmentDir, /seg-\d+-\d+\.ts/, `the segments of ${profile.id}`, log)
    await encodeAndJoinSegments(profile, model, directory, segmentDir, perSegment, count, output, options)
  }, { onWait: owner => log(`${profile.id}: waiting for the shared segments in ${segmentDir}, used by ${owner}`), log })
}

async function encodeAndJoinSegments(profile: PhoneFootageProfile, model: FootageExpectation, directory: string, segmentDir: string,
  perSegment: number, count: number, output: string, options: PhoneFootageOptions): Promise<void> {
  const segments = Array.from({ length: count }, (_, index) => ({
    index, first: index * perSegment, frames: Math.min(perSegment, model.pts.length - index * perSegment),
    file: path.join(segmentDir, `seg-${String(index).padStart(4, '0')}-${perSegment}.ts`),
  }))
  const missing: typeof segments = []
  for (const segment of segments) if (!await exists(segment.file)) missing.push(segment)
  await assertFreeSpace(directory, expectedBytes(profile) * (missing.length / count + 1), profile.id)
  const [canvasWidth, canvasHeight] = canvasSize(profile)
  let next = 0, done = count - missing.length
  const worker = async () => {
    while (next < missing.length) {
      const segment = missing[next++], temporary = `${segment.file}.${uniqueSuffix()}.tmp.ts`
      try {
        await ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${canvasWidth}x${canvasHeight}:r=${sourceRate(profile)}`, '-vf', phoneFrameCodeFilter(profile, segment.first),
          '-frames:v', String(segment.frames), '-fps_mode', 'passthrough', '-enc_time_base', '1:90000', ...encoderArgs(profile), ...BT709,
          '-mpegts_copyts', '1', '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', temporary], `encode segment ${segment.index} of ${profile.id}`)
        await rename(temporary, segment.file)
      } finally {
        await rm(temporary, { force: true })
      }
      options.log?.(`${profile.id}: segment ${++done}/${count}`)
    }
  }
  const parallel = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 6)))
  await Promise.all(Array.from({ length: parallel }, worker))
  const audio = `${output}.audio.m4a`
  try {
    await ffmpeg([...audioInput(profile, durationSeconds(model)), ...audioArgs(profile), audio], `generate the audio of ${profile.id}`)
    await ffmpeg(['-i', `concat:${segments.map(segment => segment.file).join('|')}`, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy',
      // MPEG-TS carries no packet durations: give the last frame its nominal duration, as the direct path does.
      '-bsf:v', `setts=duration=${nominalFrameTicks(profile)}`,
      ...containerArgs(profile), '-f', 'mp4', output], `remux the segments of ${profile.id}`)
  } finally {
    await rm(audio, { force: true })
    if (!options.keepSegments) await rm(segmentDir, { recursive: true, force: true })
  }
  if (options.keepSegments) await writeFile(path.join(segmentDir, SEGMENTS_KEPT_MARKER), `${profile.id}\n`)
}
