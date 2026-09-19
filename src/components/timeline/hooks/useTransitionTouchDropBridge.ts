import { useEffect, useRef, type DragEvent, type RefObject } from 'react';

import type { TimelineTrack } from '../../../types/timeline';
import {
  getActiveTransitionDragData,
  serializeTransitionDropData,
  TRANSITION_MIME_TYPE,
  TRANSITION_TOUCH_DRAG_BRIDGE_EVENT,
  type TransitionDropData,
  type TransitionTouchDragBridgeEventDetail,
} from '../transitionDragData';

interface UseTransitionTouchDropBridgeInput {
  isExporting: boolean;
  onTransitionDragLeave: () => void;
  onTransitionDragOver: (event: DragEvent, trackId: string, pointerTime: number) => void;
  onTransitionDrop: (event: DragEvent, trackId: string, pointerTime: number) => void;
  pixelToTime: (pixel: number) => number;
  scrollX: number;
  timelineRef: RefObject<HTMLDivElement | null>;
  trackMap: Map<string, TimelineTrack>;
}

function createTransitionDragEvent(
  detail: TransitionTouchDragBridgeEventDetail,
  data: TransitionDropData,
): DragEvent {
  const dataTransfer = {
    types: [TRANSITION_MIME_TYPE],
    dropEffect: 'copy',
    effectAllowed: 'copy',
    files: { length: 0, item: () => null },
    items: { length: 0, item: () => null },
    getData: (mimeType: string) => (
      mimeType === TRANSITION_MIME_TYPE ? serializeTransitionDropData(data) : ''
    ),
    setData: () => undefined,
    clearData: () => undefined,
    setDragImage: () => undefined,
  } as unknown as DataTransfer;

  return {
    clientX: detail.clientX,
    clientY: detail.clientY,
    dataTransfer,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as DragEvent;
}

function resolveTrackIdAtPoint(clientX: number, clientY: number): string | null {
  const elementAtPoint = document.elementFromPoint(clientX, clientY);
  const targetElement = elementAtPoint instanceof HTMLElement ? elementAtPoint : null;
  return targetElement?.closest<HTMLElement>('.track-lane[data-track-id]')?.dataset.trackId ?? null;
}

export function useTransitionTouchDropBridge({
  isExporting,
  onTransitionDragLeave,
  onTransitionDragOver,
  onTransitionDrop,
  pixelToTime,
  scrollX,
  timelineRef,
  trackMap,
}: UseTransitionTouchDropBridgeInput): void {
  const pointerOverTargetRef = useRef(false);

  useEffect(() => {
    const clearPreview = () => {
      if (!pointerOverTargetRef.current) return;
      pointerOverTargetRef.current = false;
      onTransitionDragLeave();
    };

    const handleTouchDragBridge = (event: Event) => {
      const detail = (event as CustomEvent<TransitionTouchDragBridgeEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'cancel') {
        clearPreview();
        return;
      }

      const data = getActiveTransitionDragData();
      const trackId = resolveTrackIdAtPoint(detail.clientX, detail.clientY);
      const track = trackId ? trackMap.get(trackId) : undefined;
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      if (!data || !trackId || !track || track.locked || isExporting || !timelineRect) {
        if (detail.phase === 'drop') {
          pointerOverTargetRef.current = true;
        }
        clearPreview();
        return;
      }

      const pointerTime = pixelToTime(detail.clientX - timelineRect.left + scrollX);
      const dragEvent = createTransitionDragEvent(detail, data);

      if (detail.phase === 'drop') {
        onTransitionDrop(dragEvent, trackId, pointerTime);
        pointerOverTargetRef.current = false;
        return;
      }

      pointerOverTargetRef.current = true;
      onTransitionDragOver(dragEvent, trackId, pointerTime);
    };

    window.addEventListener(TRANSITION_TOUCH_DRAG_BRIDGE_EVENT, handleTouchDragBridge);
    return () => {
      window.removeEventListener(TRANSITION_TOUCH_DRAG_BRIDGE_EVENT, handleTouchDragBridge);
      clearPreview();
    };
  }, [
    isExporting,
    onTransitionDragLeave,
    onTransitionDragOver,
    onTransitionDrop,
    pixelToTime,
    scrollX,
    timelineRef,
    trackMap,
  ]);
}
