import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';

import { focusMediaBoardAnnotationText } from './annotationDom';
import type { MediaBoardAnnotation } from './annotations';

type MediaBoardAnnotationCommandPatch = Partial<Pick<MediaBoardAnnotation, 'editing'>>;

interface MediaBoardAnnotationContextMenu {
  x: number;
  y: number;
  annotationId: string;
}

export interface UseMediaBoardAnnotationCommandsOptions {
  boardRootRef: { current: ParentNode | null };
  consumeSuppressedMediaBoardContextMenu: () => boolean;
  setAnnotationContextMenu: (menu: MediaBoardAnnotationContextMenu) => void;
  setSelectedMediaBoardAnnotationId: (id: string) => void;
  setSelection: (ids: string[]) => void;
  updateMediaBoardAnnotation: (id: string, patch: MediaBoardAnnotationCommandPatch) => void;
}

export function useMediaBoardAnnotationCommands({
  boardRootRef,
  consumeSuppressedMediaBoardContextMenu,
  setAnnotationContextMenu,
  setSelectedMediaBoardAnnotationId,
  setSelection,
  updateMediaBoardAnnotation,
}: UseMediaBoardAnnotationCommandsOptions) {
  const requestMediaBoardAnnotationTextFocus = useCallback((annotationId: string) => {
    window.requestAnimationFrame(() => {
      focusMediaBoardAnnotationText(boardRootRef.current, annotationId);
    });
  }, [boardRootRef]);

  const handleMediaBoardAnnotationContextMenu = useCallback((event: ReactMouseEvent, annotation: MediaBoardAnnotation) => {
    if (consumeSuppressedMediaBoardContextMenu()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelection([]);
    setSelectedMediaBoardAnnotationId(annotation.id);
    setAnnotationContextMenu({ x: event.clientX, y: event.clientY, annotationId: annotation.id });
  }, [
    consumeSuppressedMediaBoardContextMenu,
    setAnnotationContextMenu,
    setSelectedMediaBoardAnnotationId,
    setSelection,
  ]);

  const handleMediaBoardAnnotationFocus = useCallback((annotation: MediaBoardAnnotation) => {
    setSelection([]);
    setSelectedMediaBoardAnnotationId(annotation.id);
  }, [setSelectedMediaBoardAnnotationId, setSelection]);

  const handleMediaBoardAnnotationEditToggle = useCallback((annotation: MediaBoardAnnotation, editing: boolean) => {
    updateMediaBoardAnnotation(annotation.id, { editing });
  }, [updateMediaBoardAnnotation]);

  return {
    handleMediaBoardAnnotationContextMenu,
    handleMediaBoardAnnotationEditToggle,
    handleMediaBoardAnnotationFocus,
    requestMediaBoardAnnotationTextFocus,
  };
}
