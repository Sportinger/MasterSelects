import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { retimeKeyframesForEdgeTrim } from '../../../utils/keyframeTrimAnchoring';
import type { ClipTrimState } from '../types';
import { computeTrimTiming } from './clipTrimTiming';

export interface TimelineGraphTrimPreview {
  clips: readonly TimelineClip[];
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
}

export function applyTimelineGraphTrimPreview(input: {
  clips: readonly TimelineClip[];
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  clipTrim: ClipTrimState | null | undefined;
  selectedClipIds: ReadonlySet<string>;
}): TimelineGraphTrimPreview {
  const { clips, clipKeyframes, clipTrim, selectedClipIds } = input;
  if (!clipTrim) return { clips, clipKeyframes };

  const primaryIsSelected = selectedClipIds.has(clipTrim.clipId);
  const nextKeyframes = new Map(clipKeyframes);
  const nextClips = clips.map((clip) => {
    const followsPrimarySelection = clipTrim.singleClip !== true &&
      primaryIsSelected && selectedClipIds.has(clip.id);
    const followsLinkedClip = clipTrim.includeLinked === true && clip.linkedClipId === clipTrim.clipId;
    if (clip.id !== clipTrim.clipId && !followsPrimarySelection && !followsLinkedClip) return clip;

    const before = clip.id === clipTrim.clipId
      ? {
          startTime: clipTrim.originalStartTime,
          duration: clipTrim.originalDuration,
          inPoint: clipTrim.originalInPoint,
          outPoint: clipTrim.originalOutPoint,
        }
      : {
          startTime: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
        };
    const after = computeTrimTiming(clip, clipTrim.edge, before, clipTrim.appliedDelta);
    const keyframes = clipKeyframes.get(clip.id);
    if (keyframes?.length) {
      nextKeyframes.set(clip.id, retimeKeyframesForEdgeTrim(keyframes, before, {
        startTime: after.newStartTime,
        duration: after.newDuration,
        inPoint: after.newInPoint,
        outPoint: after.newOutPoint,
      }));
    }

    return {
      ...clip,
      startTime: after.newStartTime,
      duration: after.newDuration,
      inPoint: after.newInPoint,
      outPoint: after.newOutPoint,
    };
  });

  return { clips: nextClips, clipKeyframes: nextKeyframes };
}
