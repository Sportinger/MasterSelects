import { useCallback } from 'react';
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from 'react';
import type { TimelineTrackProps } from '../types';
import { isTimelineActiveTarget } from '../utils/timelineActiveTargets';
import { hitTestTimelineClipRowHover } from '../utils/timelineClipRowHoverHitTest';
import { useTimelineTrackClipDoubleClick } from './useTimelineTrackClipDoubleClick';
import { useTimelineTrackClipTouchRowEvent } from './useTimelineTrackClipTouchRowEvent';
import { useTouchCompatibilityMouseSuppression } from './useTouchCompatibilityMouseSuppression';

type UseTimelineTrackClipRowEventsArgs = Pick<
  TimelineTrackProps,
  | 'onClipContextMenu'
  | 'onClipDoubleClick'
  | 'onClipMouseDown'
  | 'onEmptyContextMenu'
  | 'onEmptyMouseDown'
  | 'pixelToTime'
> & {
  clearPointerToolPreview: () => void;
  handleTimelineToolPointerClick: (
    event: ReactMouseEvent<HTMLDivElement>,
    clipId: string,
  ) => boolean;
  handleTimelineToolPointerMove: (
    event: ReactMouseEvent<HTMLDivElement>,
    clipId: string | null,
  ) => boolean;
  hitTestClipAtClientX: (clientX: number, rowEl: HTMLElement) => string | null;
  setHoveredClipId: Dispatch<SetStateAction<string | null>>;
  trackId: string;
};

export function useTimelineTrackClipRowEvents({
  clearPointerToolPreview,
  handleTimelineToolPointerClick,
  handleTimelineToolPointerMove,
  hitTestClipAtClientX,
  onClipContextMenu,
  onClipDoubleClick,
  onClipMouseDown,
  onEmptyContextMenu,
  onEmptyMouseDown,
  pixelToTime,
  setHoveredClipId,
  trackId,
}: UseTimelineTrackClipRowEventsArgs) {
  const { onTouchPointerHandled, suppressCompatibilityMouseEvent } = useTouchCompatibilityMouseSuppression();

  const onMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTestTimelineClipRowHover(event, hitTestClipAtClientX);
    setHoveredClipId((previous) => (previous === hit ? previous : hit));
    handleTimelineToolPointerMove(event, hit);
  }, [handleTimelineToolPointerMove, hitTestClipAtClientX, setHoveredClipId]);

  const onMouseLeave = useCallback(() => {
    setHoveredClipId(null);
    clearPointerToolPreview();
  }, [clearPointerToolPreview, setHoveredClipId]);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressCompatibilityMouseEvent(event)) return;
    if (event.button === 0) {
      const target = event.target as HTMLElement;
      if (!isTimelineActiveTarget(target)) {
        const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
        if (hit) {
          setHoveredClipId(hit);
          if (handleTimelineToolPointerClick(event, hit)) {
            return;
          }
          onClipMouseDown(event, hit);
          return;
        }
      }
    }
    if (event.button !== 2) return;
    const target = event.target as HTMLElement;
    if (isTimelineActiveTarget(target)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, pixelToTime(event.clientX - rect.left));
    onEmptyMouseDown(event, trackId, time);
  }, [
    handleTimelineToolPointerClick,
    hitTestClipAtClientX,
    onClipMouseDown,
    onEmptyMouseDown,
    pixelToTime,
    setHoveredClipId,
    suppressCompatibilityMouseEvent,
    trackId,
  ]);

  const onPointerDown = useTimelineTrackClipTouchRowEvent({
    handleTimelineToolPointerClick,
    hitTestClipAtClientX,
    onClipDoubleClick,
    onClipMouseDown,
    onTouchPointerHandled,
    setHoveredClipId,
  });

  const onDoubleClick = useTimelineTrackClipDoubleClick({
    hitTestClipAtClientX,
    onClipDoubleClick,
    setHoveredClipId,
  });

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (isTimelineActiveTarget(target)) return;
    const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
    if (hit) {
      onClipContextMenu(event, hit);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, pixelToTime(event.clientX - rect.left));
    onEmptyContextMenu(event, trackId, time);
  }, [
    hitTestClipAtClientX,
    onClipContextMenu,
    onEmptyContextMenu,
    pixelToTime,
    trackId,
  ]);

  return {
    onContextMenu,
    onDoubleClick,
    onMouseDown,
    onMouseLeave,
    onMouseMove,
    onPointerDown,
  };
}
