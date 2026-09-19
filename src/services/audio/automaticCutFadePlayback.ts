import type { TimelineClip } from '../../types/timeline';
import { isAutomaticCutFade } from './automaticCutDeClick';
import { getAudioEditOperationPreviewVolumeMultiplier } from './clipAudioEditPreview';

export function automaticCutFadeSignature(clip: TimelineClip): string {
  return JSON.stringify([clip.id, clip.inPoint, clip.outPoint,
    (clip.audioState?.editStack ?? []).filter(isAutomaticCutFade)]);
}

/** Schedule against the audio clock; a display frame may miss an entire short fade. */
export function scheduleAutomaticCutFades(
  gain: AudioParam,
  clip: TimelineClip,
  sourceStart: number,
  contextStart: number,
  rate = 1,
  fadePlaybackStart = false,
): void {
  gain.cancelScheduledValues(contextStart);
  const operations = (clip.audioState?.editStack ?? []).filter(isAutomaticCutFade);
  const attack = fadePlaybackStart && operations.length > 0 ? Math.min(0.003 * rate, (clip.outPoint - sourceStart) / 2) : 0;
  const valueAt = (time: number) => (attack > 0 ? Math.min(1, Math.max(0, (time - sourceStart) / attack)) : 1) * operations.reduce((value, operation) => (
    value * getAudioEditOperationPreviewVolumeMultiplier(operation, time)
  ), 1);
  gain.setValueAtTime(valueAt(sourceStart), contextStart);
  if (operations.length === 0 || rate <= 0 || !Number.isFinite(rate)) return;

  // Only subdivide the tiny fade ranges, never the full source duration. Include
  // overlapping operations in the product so repeated edits keep their envelope.
  const points = new Set<number>();
  if (attack > 0) points.add(sourceStart + attack);
  for (const operation of operations) {
    const range = operation.timeRange!;
    const start = Math.max(sourceStart, clip.inPoint, Math.min(range.start, range.end));
    const end = Math.min(clip.outPoint, Math.max(range.start, range.end));
    if (end <= start) continue;
    for (let index = 0; index <= 32; index += 1) {
      points.add(start + (end - start) * index / 32);
    }
  }
  for (const time of [...points].toSorted((a, b) => a - b)) {
    gain.linearRampToValueAtTime(valueAt(time), contextStart + (time - sourceStart) / rate);
  }
  // Hold silence after the out edge, even if the display loop pauses us late.
  if (clip.outPoint > sourceStart && valueAt(clip.outPoint) < 0.001) {
    gain.setValueAtTime(0, contextStart + (clip.outPoint - sourceStart) / rate);
  }
}
