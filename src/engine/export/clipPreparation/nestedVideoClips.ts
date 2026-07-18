import { MAX_NESTING_DEPTH } from '../../../stores/timeline/constants';
import type { TimelineClip } from '../../../stores/timeline/types';

export interface NestedVideoClip {
  clip: TimelineClip;
  parentClip: TimelineClip;
}

export function collectNestedVideoClips(compositionClip: TimelineClip): NestedVideoClip[] {
  if (!compositionClip.isComposition) return [];

  const nestedVideoClips: NestedVideoClip[] = [];
  const collectedClipIds = new Set<string>();
  const collect = (parentClip: TimelineClip, depth: number): void => {
    if (depth >= MAX_NESTING_DEPTH || !parentClip.nestedClips) return;

    for (const clip of parentClip.nestedClips) {
      if (clip.isComposition) {
        collect(clip, depth + 1);
      } else if (clip.source?.type === 'video' && !collectedClipIds.has(clip.id)) {
        collectedClipIds.add(clip.id);
        nestedVideoClips.push({ clip, parentClip });
      }
    }
  };

  collect(compositionClip, 0);
  return nestedVideoClips;
}
