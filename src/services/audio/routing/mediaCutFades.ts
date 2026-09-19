import type { TimelineClip } from '../../../types/timeline';
import { automaticCutFadeSignature, scheduleAutomaticCutFades } from '../automaticCutFadePlayback';

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
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(1, now);
    schedules.delete(gain);
    return;
  }
  const sourceStart = element.currentTime;
  const rate = element.playbackRate;
  const signature = automaticCutFadeSignature(clip);
  const previous = schedules.get(gain);
  if (previous?.signature === signature && Math.abs(previous.rate - rate) < 0.001
    && Math.abs(previous.sourceStart + (now - previous.contextStart) * rate - sourceStart) < 0.01) return;
  scheduleAutomaticCutFades(gain, clip, sourceStart, now, rate, !previous || previous.signature !== signature);
  schedules.set(gain, { signature, sourceStart, contextStart: now, rate });
}
