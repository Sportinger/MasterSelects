import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TestInfo } from '@playwright/test'
import { ffmpeg } from './mediaOracle'

const frameBytes = 640 * 360 * 3
export interface CounterClip { startTime: number; duration: number }
export interface SequenceFrame { time: number; background: number | null; foreground: number | null }

export function assertPatternLayout(frame: Buffer, backgroundActive: boolean, foregroundActive: boolean) {
  if (frame.length !== frameBytes) throw new Error('Invalid decoded frame size')
  for (const [x, y, channel] of [[5, 5, backgroundActive ? 2 : -1],
    [635, 355, backgroundActive ? 2 : -1], [320, 180, foregroundActive ? 0 : backgroundActive ? 2 : -1]]) {
    const pixel = [...frame.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)]
    if (pixel.some((value, i) => i === channel ? value < 200 : value > 45)) {
      throw new Error(`Unexpected pattern content at ${x},${y}: ${pixel}; expected channel ${channel}`)
    }
  }
}

// Read the interior of each black/white cell. Also reject colored pixels: an
// absent marker must not accidentally decode to a plausible zero frame number.
export function readCounter(frame: Buffer, x: number, y: number): number | null {
  let value = 0
  for (let bit = 0; bit < 7; bit++) {
    let light = 0
    for (let dy = 5; dy < 11; dy++) for (let dx = 2; dx < 6; dx++) {
      const offset = ((y + dy) * 640 + x + bit * 8 + dx) * 3
      const pixel = [...frame.subarray(offset, offset + 3)]
      if (pixel.length !== 3 || Math.max(...pixel) - Math.min(...pixel) > 40) return null
      light += (pixel[0] + pixel[1] + pixel[2]) / 3
    }
    const average = light / 24
    if (average > 70 && average < 185) return null
    if (average >= 185) value |= 1 << bit
  }
  return value
}

export function assertSequence(frames: SequenceFrame[], clips: { background: CounterClip; foreground: CounterClip }) {
  if (frames.length !== 90) throw new Error(`Expected 90 frames, received ${frames.length}`)
  for (const [index, frame] of frames.entries()) {
    if (!Number.isFinite(frame.time) || Math.abs(frame.time - index / 30) > 0.00001) {
      throw new Error(`Invalid frame timestamp at ${index}: ${frame.time}`)
    }
    for (const layer of ['background', 'foreground'] as const) {
      const clip = clips[layer], localTime = frame.time - clip.startTime
      const active = localTime >= -0.000001 && localTime < clip.duration - 0.000001
      if (!active) continue
      // FAST uses nearest presentation timestamp for sub-frame clip offsets
      // (exportSamplePlanning.findClosestSampleIndex). Do not allow drift or
      // a per-frame +/-1 tolerance: the expected sequence remains exact.
      const expected = Math.round(localTime * 30)
      if (frame[layer] !== expected) {
        throw new Error(`${layer} frame ${index}: expected source frame ${expected}, decoded ${frame[layer]}`)
      }
    }
  }
}

export async function inspectFrameSequence(file: string, testInfo: TestInfo,
  clips?: { background: CounterClip; foreground: CounterClip }) {
  const probe = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file],
  { windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 })
  const timestamps = (JSON.parse(probe.stdout) as { frames: Array<{ best_effort_timestamp_time: string }> })
    .frames.map(frame => Number(frame.best_effort_timestamp_time))
  // Passthrough preserves actual decoded frames; FFmpeg must not insert duplicates.
  const decoded = (await ffmpeg(['-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], 70_000_000)).stdout
  if (decoded.length !== timestamps.length * frameBytes) throw new Error('Decoded frame count/size disagrees with timestamps')
  const frames = timestamps.map((time, index) => {
    const frame = decoded.subarray(index * frameBytes, (index + 1) * frameBytes)
    return { time, background: clips ? readCounter(frame, 32, 8) : null,
      foreground: clips ? readCounter(frame, 200, 170) : null }
  })
  await testInfo.attach('frame-sequence', { body: JSON.stringify({ clips, frames }), contentType: 'application/json' })
  if (clips) {
    assertSequence(frames, clips)
    for (const [index, frame] of frames.entries()) {
      const active = (clip: CounterClip) => frame.time >= clip.startTime - 0.000001
        && frame.time < clip.startTime + clip.duration - 0.000001
      try {
        assertPatternLayout(decoded.subarray(index * frameBytes, (index + 1) * frameBytes),
          active(clips.background), active(clips.foreground))
      } catch (error) { throw new Error(`Export frame ${index}: ${String(error)}`) }
    }
  }
  else {
    if (frames.length !== 90) throw new Error(`Expected 90 decoded video frames, received ${frames.length}`)
    for (const [index, frame] of frames.entries()) {
      if (!Number.isFinite(frame.time) || Math.abs(frame.time - index / 30) > 0.00001) {
        throw new Error(`Invalid real-footage frame timestamp at ${index}: ${frame.time}`)
      }
    }
  }
  return frames
}
