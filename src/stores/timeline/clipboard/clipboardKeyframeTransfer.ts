import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { isFlockProperty } from '../../../types/flock';
import { readFlockParamForProperty } from '../../../services/flock/flockPropertyValues';
import {
  clipLocalToKeyframeTime,
  keyframeTimeToClipLocal,
  type SourceOffsetResolver,
} from '../../../services/flock/time/flockKeyframeTime';
import type { ClipboardKeyframeData } from '../storeTypes/clipboardTypes';

/**
 * Clipboard keyframes are stored clip-local and relative to the earliest
 * copied key. Flock graph keys (source-time basis) are converted on copy and
 * converted back against the target clip's time map on paste.
 */
export function createClipboardKeyframes(
  selected: readonly Keyframe[],
  clips: readonly TimelineClip[],
  resolveSourceOffset?: SourceOffsetResolver,
): { keyframes: ClipboardKeyframeData[]; skipped: number } {
  let skipped = 0;
  const located = selected.flatMap((keyframe) => {
    const clip = clips.find((candidate) => candidate.id === keyframe.clipId);
    const local = clip ? keyframeTimeToClipLocal(clip, keyframe, resolveSourceOffset) : keyframe.time;
    if (local === null) {
      skipped += 1;
      return [];
    }
    return [{ keyframe, local }];
  });
  if (located.length === 0) return { keyframes: [], skipped };
  const earliest = Math.min(...located.map((entry) => entry.local));
  return {
    skipped,
    keyframes: located.map(({ keyframe, local }) => ({
      clipId: keyframe.clipId,
      property: keyframe.property,
      time: local - earliest,
      value: keyframe.value,
      pathValue: keyframe.pathValue ? structuredClone(keyframe.pathValue) : undefined,
      easing: keyframe.easing,
      rotationInterpolation: keyframe.rotationInterpolation,
      handleIn: keyframe.handleIn ? { ...keyframe.handleIn } : undefined,
      handleOut: keyframe.handleOut ? { ...keyframe.handleOut } : undefined,
    })),
  };
}

export interface PastedKeyframesPlan {
  keyframes: Keyframe[];
  pasted: number;
  /** Flock keys whose node/parameter does not exist on the target clip. */
  skipped: number;
}

export function planPastedKeyframes(input: {
  clipboardKeyframes: readonly ClipboardKeyframeData[];
  targetClip: TimelineClip;
  clipLocalTime: number;
  existing: readonly Keyframe[];
  resolveSourceOffset?: SourceOffsetResolver;
  createId: () => string;
}): PastedKeyframesPlan {
  const { targetClip } = input;
  const next = [...input.existing];
  let pasted = 0;
  let skipped = 0;
  for (const data of input.clipboardKeyframes) {
    if (isFlockProperty(data.property)
      && (!targetClip.flock || readFlockParamForProperty(targetClip.flock, data.property) === undefined)) {
      skipped += 1;
      continue;
    }
    const local = Math.max(0, Math.min(targetClip.duration, input.clipLocalTime + data.time));
    next.push({
      id: input.createId(),
      clipId: targetClip.id,
      time: clipLocalToKeyframeTime(targetClip, data.property, local, input.resolveSourceOffset),
      property: data.property,
      value: data.value,
      pathValue: data.pathValue ? structuredClone(data.pathValue) : undefined,
      easing: data.easing,
      rotationInterpolation: data.rotationInterpolation,
      handleIn: data.handleIn ? { ...data.handleIn } : undefined,
      handleOut: data.handleOut ? { ...data.handleOut } : undefined,
    });
    pasted += 1;
  }
  return { keyframes: next.toSorted((a, b) => a.time - b.time), pasted, skipped };
}
