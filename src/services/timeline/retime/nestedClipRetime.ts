import type { TimelineClip } from '../../../types/timeline';
import { MAX_NESTING_DEPTH } from '../../../stores/timeline/constants';
import { resolveClipSourceTime, resolveClipSourceWindow, videoFrameSourceTime, type ClipRetimeSample } from './clipRetime';

/** The input is already in this composition's source clock. */
export function visitNestedClipsAtTime(
  composition: TimelineClip,
  compositionTime: number,
  visit: (clip: TimelineClip, timing: ClipRetimeSample) => void,
  parentRate = 1,
  depth = 0,
): void {
  if (depth >= MAX_NESTING_DEPTH) return;
  const tracks = composition.nestedTracks;
  for (const clip of composition.nestedClips ?? []) {
    if (tracks && !tracks.some(track => track.id === clip.trackId && track.type === 'video' && track.visible !== false)) continue;
    if (compositionTime < clip.startTime || compositionTime >= clip.startTime + clip.duration) continue;
    const timing = resolveClipSourceTime(clip, compositionTime - clip.startTime);
    const sourceRate = parentRate * timing.sourceRate;
    const sourceTime = videoFrameSourceTime(timing);
    if (clip.isComposition) {
      visitNestedClipsAtTime(clip, sourceTime, visit, sourceRate, depth + 1);
    } else {
      visit(clip, { ...timing, sourceTime, sourceRate, isHold: timing.isHold || sourceRate === 0 });
    }
  }
}

export function visitNestedClipsInWindow(
  composition: TimelineClip,
  sourceStart: number,
  sourceEnd: number,
  visit: (clip: TimelineClip, localStart: number, localEnd: number) => void,
  depth = 0,
): void {
  if (depth >= MAX_NESTING_DEPTH) return;
  for (const clip of composition.nestedClips ?? []) {
    if (composition.nestedTracks && !composition.nestedTracks.some(track =>
      track.id === clip.trackId && track.type === 'video' && track.visible !== false)) continue;
    const start = Math.max(Math.min(sourceStart, sourceEnd), clip.startTime);
    const end = Math.min(Math.max(sourceStart, sourceEnd), clip.startTime + clip.duration);
    if (end < start || start >= clip.startTime + clip.duration) continue;
    const localStart = (sourceEnd < sourceStart ? end : start) - clip.startTime;
    const localEnd = (sourceEnd < sourceStart ? start : end) - clip.startTime;
    if (clip.isComposition) {
      const window = resolveClipSourceWindow(clip, localStart, localEnd);
      const reverse = window.sourceEnd < window.sourceStart;
      visitNestedClipsInWindow(clip,
        reverse ? window.maxSourceTime : window.minSourceTime,
        reverse ? window.minSourceTime : window.maxSourceTime, visit, depth + 1);
    } else visit(clip, localStart, localEnd);
  }
}
