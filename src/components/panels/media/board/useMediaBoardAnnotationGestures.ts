import { useCallback, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';

import {
  getDraggedMediaBoardAnnotationPosition,
  getResizedMediaBoardAnnotationRect,
  type MediaBoardAnnotation,
  type MediaBoardAnnotationResizeCorner,
} from './annotations';
import { MEDIA_BOARD_DRAG_START_DISTANCE, MEDIA_BOARD_PAN_ZOOM_MIN } from './constants';

type MediaBoardAnnotationGesturePatch = Partial<Pick<MediaBoardAnnotation, 'x' | 'y' | 'width' | 'height'>>;

interface MediaBoardAnnotationGestureViewport {
  zoom: number;
}

export interface UseMediaBoardAnnotationGesturesOptions {
  closeContextMenu: () => void;
  mediaBoardViewportRef: RefObject<MediaBoardAnnotationGestureViewport>;
  setSelectedMediaBoardAnnotationId: (id: string) => void;
  setSelection: (ids: string[]) => void;
  suppressNextMediaBoardContextMenu: () => void;
  updateMediaBoardAnnotation: (id: string, patch: MediaBoardAnnotationGesturePatch) => void;
}

export function useMediaBoardAnnotationGestures({
  closeContextMenu,
  mediaBoardViewportRef,
  setSelectedMediaBoardAnnotationId,
  setSelection,
  suppressNextMediaBoardContextMenu,
  updateMediaBoardAnnotation,
}: UseMediaBoardAnnotationGesturesOptions) {
  const startMediaBoardAnnotationDrag = useCallback((e: ReactMouseEvent, annotation: MediaBoardAnnotation) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, button')) {
      return;
    }

    if (e.button === 0) {
      setSelection([]);
      setSelectedMediaBoardAnnotationId(annotation.id);
      return;
    }

    if (e.button !== 2) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    setSelection([]);
    setSelectedMediaBoardAnnotationId(annotation.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startAnnotation = { x: annotation.x, y: annotation.y };
    const startZoom = Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, mediaBoardViewportRef.current.zoom);
    let didDrag = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!didDrag && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;
      if (!didDrag) {
        didDrag = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - startX) / startZoom;
      const dy = (moveEvent.clientY - startY) / startZoom;
      updateMediaBoardAnnotation(annotation.id, getDraggedMediaBoardAnnotationPosition(startAnnotation, dx, dy));
    };

    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (didDrag) {
        suppressNextMediaBoardContextMenu();
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [
    closeContextMenu,
    mediaBoardViewportRef,
    setSelectedMediaBoardAnnotationId,
    setSelection,
    suppressNextMediaBoardContextMenu,
    updateMediaBoardAnnotation,
  ]);

  const startMediaBoardAnnotationResize = useCallback((
    e: ReactMouseEvent,
    annotation: MediaBoardAnnotation,
    corner: MediaBoardAnnotationResizeCorner,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    setSelection([]);
    setSelectedMediaBoardAnnotationId(annotation.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startZoom = Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, mediaBoardViewportRef.current.zoom);
    const start = {
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - startX) / startZoom;
      const dy = (moveEvent.clientY - startY) / startZoom;
      updateMediaBoardAnnotation(annotation.id, getResizedMediaBoardAnnotationRect(start, corner, dx, dy));
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [
    closeContextMenu,
    mediaBoardViewportRef,
    setSelectedMediaBoardAnnotationId,
    setSelection,
    updateMediaBoardAnnotation,
  ]);

  return {
    startMediaBoardAnnotationDrag,
    startMediaBoardAnnotationResize,
  };
}
