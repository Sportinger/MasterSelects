import { MAX_NESTING_DEPTH } from '../../../stores/timeline/constants';
import type { TimelineClip } from '../../../stores/timeline/types';

export interface NestedVideoClip {
  clip: TimelineClip;
  parentClip: TimelineClip;
  mainTimelineStart: number;
  mainTimelineDuration: number;
}

export function collectNestedVideoClips(compositionClip: TimelineClip): NestedVideoClip[] {
  if (!compositionClip.isComposition) return [];

  const nestedVideoClips: NestedVideoClip[] = [];
  const collectedClipIds = new Set<string>();
  const getCompositionMapping = (
    clip: TimelineClip,
    parentMainAtSourceZero: number,
    parentMainSecondsPerSourceSecond: number,
  ): { mainAtSourceZero: number; mainSecondsPerSourceSecond: number } => {
    const rawSpeed = clip.speed ?? 1;
    const speed = Math.max(0.0001, Math.abs(rawSpeed));
    const reversed = Boolean(clip.reversed) !== (rawSpeed < 0);
    const sourceAnchor = reversed ? clip.outPoint : clip.inPoint;
    const direction = reversed ? -1 : 1;
    return {
      mainAtSourceZero:
        parentMainAtSourceZero +
        parentMainSecondsPerSourceSecond *
          (clip.startTime - (direction * sourceAnchor) / speed),
      mainSecondsPerSourceSecond:
        parentMainSecondsPerSourceSecond * direction / speed,
    };
  };
  const collect = (
    parentClip: TimelineClip,
    mainAtSourceZero: number,
    mainSecondsPerSourceSecond: number,
    depth: number,
  ): void => {
    if (depth >= MAX_NESTING_DEPTH || !parentClip.nestedClips) return;

    // A nested composition is represented by a visual clip and a linked audio
    // clip. Both carry composition data, but only the instance on a visible
    // video track belongs in the video decoder tree. Traversing the audio twin
    // duplicates every descendant decoder under an "(Audio)" namespace.
    const nestedVideoTrackIds = parentClip.nestedTracks
      ? new Set(
        parentClip.nestedTracks
          .filter((track) => track.type === 'video' && track.visible !== false)
          .map((track) => track.id),
      )
      : null;

    for (const clip of parentClip.nestedClips) {
      if (nestedVideoTrackIds && !nestedVideoTrackIds.has(clip.trackId)) {
        continue;
      }
      if (clip.isComposition) {
        if (clip.source?.type === 'audio') continue;
        const childMapping = getCompositionMapping(
          clip,
          mainAtSourceZero,
          mainSecondsPerSourceSecond,
        );
        collect(
          clip,
          childMapping.mainAtSourceZero,
          childMapping.mainSecondsPerSourceSecond,
          depth + 1,
        );
      } else if (clip.source?.type === 'video' && !collectedClipIds.has(clip.id)) {
        collectedClipIds.add(clip.id);
        const mappedStart = mainAtSourceZero + mainSecondsPerSourceSecond * clip.startTime;
        const mappedEnd =
          mainAtSourceZero +
          mainSecondsPerSourceSecond * (clip.startTime + clip.duration);
        nestedVideoClips.push({
          clip,
          parentClip,
          mainTimelineStart: Math.min(mappedStart, mappedEnd),
          mainTimelineDuration: Math.abs(mappedEnd - mappedStart),
        });
      }
    }
  };

  const rootMapping = getCompositionMapping(compositionClip, 0, 1);
  collect(
    compositionClip,
    rootMapping.mainAtSourceZero,
    rootMapping.mainSecondsPerSourceSecond,
    0,
  );
  return nestedVideoClips;
}
