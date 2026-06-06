import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ClipKeyframeTickGroupView } from '../components/ClipKeyframeTicks';

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;

type MoveKeyframeGroup = ((keyframeIds: string[], newTime: number) => void) | undefined;
type KeyframeGroupDragLifecycle = ((keyframeIds: string[], time: number) => void) | undefined;

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
  onKeyframeGroupDragBegin?: KeyframeGroupDragLifecycle;
  onKeyframeGroupDragCommit?: KeyframeGroupDragLifecycle;
}) {
  const {
    keyframeTickGroups,
    displayDuration,
    width,
    onMoveKeyframeGroup,
    onKeyframeGroupDragBegin,
    onKeyframeGroupDragCommit,
  } = input;
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);

  const handleKeyframeTickMouseDown = useCallback((
    e: ReactMouseEvent<HTMLButtonElement>,
    group: ClipKeyframeTickGroupView,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!onMoveKeyframeGroup || group.keyframeIds.length === 0) return;
    onKeyframeGroupDragBegin?.(group.keyframeIds, group.time);

    setKeyframeGroupDrag({
      keyframeIds: group.keyframeIds,
      startX: e.clientX,
      startTime: group.time,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
    });
  }, [displayDuration, onKeyframeGroupDragBegin, onMoveKeyframeGroup, width]);

  useEffect(() => {
    if (!keyframeGroupDrag || !onMoveKeyframeGroup) return;
    let latestResolvedTime = keyframeGroupDrag.startTime;

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

        for (const group of keyframeTickGroups) {
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

      latestResolvedTime = newTime;
      onMoveKeyframeGroup(keyframeGroupDrag.keyframeIds, newTime);
    };

    const handleDocumentMouseUp = () => {
      onKeyframeGroupDragCommit?.(keyframeGroupDrag.keyframeIds, latestResolvedTime);
      setKeyframeGroupDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [keyframeTickGroups, onKeyframeGroupDragCommit, onMoveKeyframeGroup, keyframeGroupDrag]);

  return {
    keyframeGroupDrag,
    handleKeyframeTickMouseDown,
  };
}
