import type { TimelineClip } from '../../../types/timeline';
import {
  automaticCutFadeSignature,
  getScheduledEdgeGainAt,
  scheduleAutomaticCutFades,
} from '../automaticCutFadePlayback';

const schedules = new WeakMap<AudioParam, {
  signature: string;
  sourceStart: number;
  contextStart: number;
  rate: number;
}>();

export function syncMediaCutFades(
  gain: AudioParam,
  context: AudioContext,
  element: HTMLMediaElement,
  clip: TimelineClip | null,
): void {
  const now = context.currentTime;
  if (!clip || element.paused || element.seeking) {
    // A paused or seeking element starts from the gain at its position (0 at a
    // crossfade's silent start), not from a full-level burst before the next frame.
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(clip ? getScheduledEdgeGainAt(clip, element.currentTime) : 1, now);
    schedules.delete(gain);
    return;
  }
  const sourceStart = element.currentTime;
  const rate = element.playbackRate;
  const signature = automaticCutFadeSignature(clip);
  const previous = schedules.get(gain);
  if (previous?.signature === signature && Math.abs(previous.rate - rate) < 0.001
    && Math.abs(previous.sourceStart + (now - previous.contextStart) * rate - sourceStart) < 0.01) return;
  // The short attack protects a playback start only; a running element that
  // moves to another clip (a handoff, a crossfade's end) keeps its level.
  scheduleAutomaticCutFades(gain, clip, sourceStart, now, rate, !previous);
  schedules.set(gain, { signature, sourceStart, contextStart: now, rate });
}
