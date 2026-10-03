import type { Keyframe, TimelineClip } from '../../../types';
import { createClipSpeedSource, resolveClipSourceWindow } from '../../../services/timeline/retime/clipRetime';
import { createBuffer } from '../audioBufferFactory';

/**
 * The renderer evaluates the entire output clip before the mixer crops the export interval.
 * Nested mixdowns without Loop/Warp may stop at the export end: the speed renderer
 * leaves an unrequested source tail silent, while Loop/Warp need their whole clock.
 * A bounded range stays anchored at inPoint so ordinary renders need no origin shift.
 */
export function getExportClipSourceRange(clip: TimelineClip, keys: readonly Keyframe[], exportEndTime?: number) {
  const bounded = clip.isComposition && !clip.timeRemap && Number.isFinite(exportEndTime);
  const localEnd = bounded ? Math.max(0, Math.min(clip.duration, exportEndTime! - clip.startTime)) : clip.duration;
  const window = resolveClipSourceWindow(clip, 0, localEnd, createClipSpeedSource(clip, keys));
  // A pitch-preserved constant Loop renders a complete cycle before repetition.
  // Retain that cycle even when this output interval requests only a prefix.
  const loop = clip.timeRemap?.kind === 'loop';
  const start = Math.max(0, loop || bounded ? Math.min(clip.inPoint, window.minSourceTime) : window.minSourceTime);
  return { start, end: Math.max(start + 0.001, loop ? Math.max(clip.outPoint, window.maxSourceTime) : window.maxSourceTime) };
}

export function sliceExportSourceBuffer(buffer: AudioBuffer, range: { start: number; end: number }) {
  const first = Math.min(buffer.length, Math.floor(range.start * buffer.sampleRate));
  const last = Math.min(buffer.length, Math.max(first + 1, Math.ceil(range.end * buffer.sampleRate)));
  if (first === 0 && last === buffer.length) return { buffer, sourceBufferStart: 0 };
  const sliced = createBuffer(buffer.numberOfChannels, Math.max(1, last - first), buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++)
    sliced.getChannelData(ch).set(buffer.getChannelData(ch).subarray(first, last));
  return { buffer: sliced, sourceBufferStart: first / buffer.sampleRate };
}
