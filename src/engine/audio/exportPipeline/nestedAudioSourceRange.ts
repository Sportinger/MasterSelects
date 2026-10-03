import type { Keyframe, TimelineClip } from '../../../types';
import { createClipSpeedSource, resolveClipSourceWindow } from '../../../services/timeline/retime/clipRetime';
import { createBuffer } from '../audioBufferFactory';

/**
 * Source PCM remains anchored at inPoint: the clip renderer still owns retiming.
 * Keep all source samples requested from local zero through the export end,
 * including the high endpoint where a backward parent begins. Curves use the
 * contract's conservative window, not duration * abs(speed).
 */
export function trimNestedAudioSourceRange(clip: TimelineClip, buffer: AudioBuffer,
  keys: readonly Keyframe[], exportEndTime?: number): AudioBuffer {
  const localEnd = Number.isFinite(exportEndTime)
    ? Math.max(0, Math.min(clip.duration, exportEndTime! - clip.startTime)) : clip.duration;
  const window = resolveClipSourceWindow(clip, 0, localEnd, createClipSpeedSource(clip, keys));
  // Absolute transition mappings may request samples outside the ordinary trim.
  if (window.minSourceTime < clip.inPoint) return buffer;
  const start = Math.max(0, Math.floor(clip.inPoint * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.max(start + 1, Math.ceil(window.maxSourceTime * buffer.sampleRate)));
  if (start === 0 && end === buffer.length) return buffer;
  const result = createBuffer(buffer.numberOfChannels, Math.max(1, end - start), buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(start, end));
  }
  return result;
}
