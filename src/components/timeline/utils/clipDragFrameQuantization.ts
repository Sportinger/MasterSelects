import type { TimelineClip } from '../../../types';
import type { ClipDragState } from '../types';
import { isFrameLockedClip, quantizeTimeToFrame } from '../../../utils/timelineFrameQuantization';

const quantizationDecisionCache = new WeakMap<
  ClipDragState,
  { clipMap: ReadonlyMap<string, TimelineClip>; shouldQuantize: boolean }
>();

export function shouldQuantizeClipDrag(
  drag: ClipDragState,
  clipMap: ReadonlyMap<string, TimelineClip>,
): boolean {
  const cached = quantizationDecisionCache.get(drag);
  if (cached?.clipMap === clipMap) return cached.shouldQuantize;

  const affectedIds = new Set([drag.clipId, ...(drag.multiSelectClipIds ?? [])]);
  if (!drag.altKeyPressed) {
    for (const clipId of [...affectedIds]) {
      const linkedClipId = clipMap.get(clipId)?.linkedClipId;
      if (linkedClipId) affectedIds.add(linkedClipId);
    }
    if (drag.linkedGroupId) {
      for (const clip of clipMap.values()) {
        if (clip.linkedGroupId === drag.linkedGroupId) affectedIds.add(clip.id);
      }
    }
  }
  const shouldQuantize = [...affectedIds].some((clipId) => {
    const clip = clipMap.get(clipId);
    return clip ? isFrameLockedClip(clip) : false;
  });
  quantizationDecisionCache.set(drag, { clipMap, shouldQuantize });
  return shouldQuantize;
}

export function quantizeClipDragTime(
  drag: ClipDragState,
  clipMap: ReadonlyMap<string, TimelineClip>,
  time: number,
  frameRate: number,
): number {
  return shouldQuantizeClipDrag(drag, clipMap)
    ? Math.max(0, quantizeTimeToFrame(time, frameRate))
    : Math.max(0, time);
}
