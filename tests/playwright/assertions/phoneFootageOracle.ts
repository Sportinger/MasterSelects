import { execFile, spawn } from 'node:child_process'
import { open } from 'node:fs/promises'
import { promisify } from 'node:util'
import { FRAME_CODE_LAYOUT } from '../fixtures/frameCodeMedia.ts'
import { PHONE_HIGH_ROW, type FootageExpectation } from '../fixtures/phoneFootageProfiles.ts'
import { readFrameCode, type ClipRegion, type FrameCodeReading, type FramePixels } from './frameCodeOracle.ts'

const run = promisify(execFile)

/**
 * Oracle for the generated phone footage (fixtures/phoneFootage.ts): reads the
 * 24-bit frame number (v1 code row = bits 0-11, phone high row = bits 12-23),
 * proves the container timestamps against the expectation model with ffprobe,
 * and streams decoded frames in display orientation (rotation matrix applied).
 */
export interface PhoneFrameReading {
  frame: number | null
  valid: boolean
  low: FrameCodeReading
  high: FrameCodeReading
}

/**
 * Reads both code rows. The high row is read with the v1 reader on a region
 * whose code band coincides with PHONE_HIGH_ROW, so both rows share one decoder.
 */
export function readPhoneFrameCode(pixels: FramePixels, region?: ClipRegion): PhoneFrameReading {
  const area = region ?? { x: 0, y: 0, width: pixels.width, height: pixels.height }
  const [bandTop, bandBottom] = FRAME_CODE_LAYOUT.codeBand, [highTop, highBottom] = PHONE_HIGH_ROW
  const scale = (highBottom - highTop) / (bandBottom - bandTop)
  const highRegion = { x: area.x, width: area.width, height: area.height * scale, y: area.y + area.height * highTop - area.height * scale * bandTop }
  const low = readFrameCode(pixels, area), high = readFrameCode(pixels, highRegion)
  const valid = low.valid && high.valid && low.frame !== null && high.frame !== null && low.inverted === high.inverted
  return { frame: valid ? high.frame! * 4096 + low.frame! : null, valid, low, high }
}

export interface FootageProbe {
  container: { formatName: string; majorBrand?: string; sizeBytes: number; durationSeconds: number }
  video: {
    codec: string; codecTag: string; profile?: string; width: number; height: number; timeBase: string
    rotation: number; hasBFrames: number; colorSpace?: string; durationSeconds: number
  }
  audio?: { codec: string; sampleRate: number; channels: number; timeBase: string; durationSeconds: number }
  /** Presentation timestamps of every video frame in track ticks, in presentation order. */
  pts: number[]
  source: 'frames' | 'packets'
}

interface ProbeStream {
  codec_type: string; codec_name: string; codec_tag_string: string; profile?: string; width?: number; height?: number
  time_base: string; has_b_frames?: number; color_space?: string; duration?: string; sample_rate?: string; channels?: number
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>
}

/**
 * ffprobe view of a file. `frames` decodes every frame (ffprobe -show_frames,
 * the proof for small files); `packets` reads the demuxed timestamps only and
 * is fast enough for multi-GB recordings.
 */
export async function probeFootage(file: string, { source = 'frames' }: { source?: 'frames' | 'packets' } = {}): Promise<FootageProbe> {
  const { stdout: info } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { maxBuffer: 16 * 1024 * 1024 })
  const parsed = JSON.parse(info) as { format: { format_name: string; size: string; duration: string; tags?: Record<string, string> }; streams: ProbeStream[] }
  const video = parsed.streams.find(stream => stream.codec_type === 'video'), audio = parsed.streams.find(stream => stream.codec_type === 'audio')
  if (!video) throw new Error(`${file} has no video stream`)
  const entries = source === 'frames' ? ['-show_entries', 'frame=pts', '-show_frames'] : ['-show_entries', 'packet=pts', '-show_packets']
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', ...entries, '-of', 'json', file], { maxBuffer: 512 * 1024 * 1024 })
  const list = (JSON.parse(stdout) as { frames?: Array<{ pts?: number }>; packets?: Array<{ pts?: number }> })[source === 'frames' ? 'frames' : 'packets'] ?? []
  const pts = list.map(entry => entry.pts ?? Number.NaN)
  const rotation = video.side_data_list?.find(item => item.side_data_type === 'Display Matrix')?.rotation ?? 0
  return {
    container: { formatName: parsed.format.format_name, majorBrand: parsed.format.tags?.major_brand, sizeBytes: Number(parsed.format.size), durationSeconds: Number(parsed.format.duration) },
    video: {
      codec: video.codec_name, codecTag: video.codec_tag_string, profile: video.profile, width: video.width!, height: video.height!, timeBase: video.time_base,
      rotation, hasBFrames: video.has_b_frames ?? 0, colorSpace: video.color_space, durationSeconds: Number(video.duration),
    },
    audio: audio && { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels ?? 0, timeBase: audio.time_base, durationSeconds: Number(audio.duration) },
    pts: source === 'packets' ? pts.toSorted((a, b) => a - b) : pts,
    source,
  }
}

export interface TimestampReport { ok: boolean; problems: string[]; maxDeviationTicks: number }

/** Every container timestamp must equal the model's tick for tick; container metadata must match the profile. */
export function checkFootageProbe(model: FootageExpectation, probe: FootageProbe): TimestampReport {
  const { profile } = model, problems: string[] = []
  const codec = profile.codec === 'hevc' ? 'hevc' : 'h264'
  if (probe.video.codec !== codec) problems.push(`codec ${probe.video.codec}, expected ${codec}`)
  if (profile.codec === 'hevc' && probe.video.codecTag !== 'hvc1') problems.push(`HEVC tag ${probe.video.codecTag}, expected hvc1`)
  if (probe.video.timeBase !== `1/${profile.timescale}`) problems.push(`video timebase ${probe.video.timeBase}, expected 1/${profile.timescale}`)
  if (probe.video.width !== model.codedWidth || probe.video.height !== model.codedHeight) {
    problems.push(`coded size ${probe.video.width}x${probe.video.height}, expected ${model.codedWidth}x${model.codedHeight}`)
  }
  if (probe.video.rotation !== profile.rotation) problems.push(`display rotation ${probe.video.rotation}, expected ${profile.rotation}`)
  if (profile.bframes > 0 && probe.video.hasBFrames === 0) problems.push('expected B-frames, the stream has none')
  if (profile.bframes === 0 && probe.video.hasBFrames > 0) problems.push(`expected no B-frames, has_b_frames=${probe.video.hasBFrames}`)
  if (!probe.audio) problems.push('no audio stream')
  else {
    if (probe.audio.codec !== 'aac') problems.push(`audio codec ${probe.audio.codec}, expected aac`)
    if (probe.audio.sampleRate !== profile.audio.sampleRate) problems.push(`audio ${probe.audio.sampleRate} Hz, expected ${profile.audio.sampleRate}`)
  }
  if (probe.pts.length !== model.pts.length) problems.push(`${probe.pts.length} frames, expected ${model.pts.length}`)
  let maxDeviationTicks = 0, listed = 0
  model.pts.forEach((tick, index) => {
    const actual = probe.pts[index]
    if (actual === undefined) return
    const deviation = Math.abs(actual - tick)
    maxDeviationTicks = Math.max(maxDeviationTicks, Number.isNaN(deviation) ? Infinity : deviation)
    if (deviation !== 0 && listed++ < 10) problems.push(`frame ${index}: pts ${actual}, expected ${tick}`)
  })
  const expectedSeconds = model.endTicks / profile.timescale
  if (Math.abs(probe.video.durationSeconds - expectedSeconds) > 1.5 / profile.timescale + 1e-6) {
    problems.push(`video duration ${probe.video.durationSeconds}s, expected ${expectedSeconds}s`)
  }
  return { ok: problems.length === 0, problems, maxDeviationTicks }
}

/** Top-level MP4/MOV boxes in file order (a phone's muxer writes `moov` after `mdat`). */
export async function topLevelBoxes(file: string): Promise<Array<{ type: string; offset: number; size: number }>> {
  const handle = await open(file, 'r'), boxes: Array<{ type: string; offset: number; size: number }> = []
  try {
    const { size: fileSize } = await handle.stat(), header = Buffer.alloc(16)
    for (let offset = 0; offset + 8 <= fileSize && boxes.length < 64;) {
      await handle.read(header, 0, 16, offset)
      let size = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      if (size === 1) size = Number(header.readBigUInt64BE(8))
      else if (size === 0) size = fileSize - offset
      if (size < 8) throw new Error(`${file}: broken box ${type} at ${offset}`)
      boxes.push({ type, offset, size })
      offset += size
    }
  } finally {
    await handle.close()
  }
  return boxes
}

/**
 * Streams every decoded frame in display orientation (ffmpeg applies the
 * rotation matrix, as a browser does) and presentation order.
 */
export async function streamDisplayFrames(file: string, onFrame: (pixels: FramePixels, index: number) => void,
  { scaleWidth = 180 }: { scaleWidth?: number } = {}): Promise<{ width: number; height: number; frames: number }> {
  const probe = await probeFootage(file, { source: 'packets' })
  const swap = Math.abs(probe.video.rotation) % 180 === 90
  const displayWidth = swap ? probe.video.height : probe.video.width, displayHeight = swap ? probe.video.width : probe.video.height
  const width = Math.min(scaleWidth, displayWidth), height = Math.round(displayHeight * width / displayWidth / 2) * 2
  const frameSize = width * height * 3
  let index = 0
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${width}:${height}:flags=area`, '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0), errors = ''
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      while (pending.length >= frameSize) {
        onFrame({ width, height, channels: 3, data: pending.subarray(0, frameSize) }, index++)
        pending = pending.subarray(frameSize)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('ffmpeg is not installed on this test host') : error))
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg could not decode ${file}: ${errors.trim().slice(0, 400)}`)))
  })
  return { width, height, frames: index }
}

export interface FootageFrameReport { ok: boolean; frames: number; problems: string[] }

/** Decodes the whole file and checks that presentation frame k shows code k, for every frame of the model. */
export async function checkFootageFrames(file: string, model: FootageExpectation): Promise<FootageFrameReport> {
  const problems: string[] = []
  const { frames } = await streamDisplayFrames(file, (pixels, index) => {
    if (problems.length >= 20) return
    const reading = readPhoneFrameCode(pixels)
    if (!reading.valid) problems.push(`frame ${index}: unreadable (low ${reading.low.reason ?? 'ok'}, high ${reading.high.reason ?? 'ok'})`)
    else if (reading.frame !== index) problems.push(`frame ${index}: shows code ${reading.frame}`)
  })
  if (frames !== model.pts.length) problems.unshift(`${frames} decoded frames, expected ${model.pts.length}`)
  return { ok: problems.length === 0, frames, problems }
}
