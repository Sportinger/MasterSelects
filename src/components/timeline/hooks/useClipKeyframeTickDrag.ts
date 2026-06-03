import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineClipProps } from '../types';
import type { ClipKeyframeTickGroupView } from '../components/ClipKeyframeTicks';

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;

type MoveKeyframeGroup = TimelineClipProps['onMoveKeyframeGroup'];

type KeyframeGroupDragState = {
  keyframeIds: string[];
  startX: number;
  startTime: number;
  clipWidth: number;
  clipDuration: number;
};

export function useClipKeyframeTickDrag(input: {
  keyframeTickGroups: readonly ClipKeyframeTickGroupView[];
  displayDuration: number;
  width: number;
  onMoveKeyframeGroup: MoveKeyframeGroup;
}) {
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);

  const handleKeyframeTickMouseDown = useCallback((
    e: ReactMouseEvent<HTMLButtonElement>,
    group: ClipKeyframeTickGroupView,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!input.onMoveKeyframeGroup || group.keyframeIds.length === 0) return;

    setKeyframeGroupDrag({
      keyframeIds: group.keyframeIds,
      startX: e.clientX,
      startTime: group.time,
      clipWidth: Math.max(1, input.width),
      clipDuration: Math.max(0.001, input.displayDuration),
    });
  }, [input.displayDuration, input.onMoveKeyframeGroup, input.width]);

  useEffect(() => {
    if (!keyframeGroupDrag || !input.onMoveKeyframeGroup) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const deltaX = e.clientX - keyframeGroupDrag.startX;
      const deltaTime = (deltaX / keyframeGroupDrag.clipWidth) * keyframeGroupDrag.clipDuration;
      let newTime = Math.max(
        0,
        Math.min(keyframeGroupDrag.clipDuration, keyframeGroupDrag.startTime + deltaTime)
      );

      if (e.shiftKey) {
        const movingIds = new Set(keyframeGroupDrag.keyframeIds);
        let bestDistancePx = KEYFRAME_TICK_SNAP_THRESHOLD_PX;

        for (const group of input.keyframeTickGroups) {
          if (group.keyframeIds.some(id => movingIds.has(id))) continue;

          const distancePx = Math.abs(
            ((group.time - newTime) / keyframeGroupDrag.clipDuration) * keyframeGroupDrag.clipWidth
          );

          if (distancePx <= bestDistancePx) {
            bestDistancePx = distancePx;
            newTime = group.time;
          }
        }
      }

      input.onMoveKeyframeGroup(keyframeGroupDrag.keyframeIds, newTime);
    };

    const handleDocumentMouseUp = () => {
      setKeyframeGroupDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [input.keyframeTickGroups, input.onMoveKeyframeGroup, keyframeGroupDrag]);

  return {
    keyframeGroupDrag,
    handleKeyframeTickMouseDown,
  };
}
