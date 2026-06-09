import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_MEDIA_BOARD_ANNOTATION_BACKGROUND,
  DEFAULT_MEDIA_BOARD_ANNOTATION_FONT_SIZE,
  DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE,
  DEFAULT_MEDIA_BOARD_ANNOTATION_TEXT,
  MEDIA_BOARD_ANNOTATION_MAX_SIZE,
  MEDIA_BOARD_ANNOTATION_MIN_SIZE,
  clampMediaBoardAnnotationFontSize,
  loadMediaBoardAnnotations,
  normalizeMediaBoardAnnotationColor,
  saveMediaBoardAnnotations,
  type MediaBoardAnnotation,
} from './annotations';

export type MediaBoardAnnotationPatch = Partial<Pick<
  MediaBoardAnnotation,
  'text' | 'fontSize' | 'x' | 'y' | 'width' | 'height' | 'backgroundColor' | 'textColor' | 'editing'
>>;

export interface MediaBoardAnnotationPoint {
  x: number;
  y: number;
}

export function useMediaBoardAnnotationState() {
  const [mediaBoardAnnotations, setMediaBoardAnnotations] = useState<MediaBoardAnnotation[]>(loadMediaBoardAnnotations);
  const [selectedMediaBoardAnnotationId, setSelectedMediaBoardAnnotationId] = useState<string | null>(null);

  useEffect(() => {
    saveMediaBoardAnnotations(mediaBoardAnnotations);
  }, [mediaBoardAnnotations]);

  const reloadMediaBoardAnnotations = useCallback(() => {
    setMediaBoardAnnotations(loadMediaBoardAnnotations());
  }, []);

  const updateMediaBoardAnnotation = useCallback((id: string, patch: MediaBoardAnnotationPatch) => {
    setMediaBoardAnnotations((current) => current.map((annotation) => (
      annotation.id === id
        ? {
          ...annotation,
          ...patch,
          width: patch.width === undefined
            ? annotation.width
            : Math.max(MEDIA_BOARD_ANNOTATION_MIN_SIZE.width, Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.width, patch.width)),
          height: patch.height === undefined
            ? annotation.height
            : Math.max(MEDIA_BOARD_ANNOTATION_MIN_SIZE.height, Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.height, patch.height)),
          fontSize: patch.fontSize === undefined
            ? annotation.fontSize
            : clampMediaBoardAnnotationFontSize(patch.fontSize),
          backgroundColor: patch.backgroundColor === undefined
            ? annotation.backgroundColor
            : normalizeMediaBoardAnnotationColor(patch.backgroundColor, annotation.backgroundColor),
          textColor: patch.textColor === undefined
            ? annotation.textColor
            : normalizeMediaBoardAnnotationColor(patch.textColor, annotation.textColor),
          updatedAt: Date.now(),
        }
        : annotation
    )));
  }, []);

  const createMediaBoardAnnotation = useCallback((point: MediaBoardAnnotationPoint): string => {
    const now = Date.now();
    const annotation: MediaBoardAnnotation = {
      id: `media-board-annotation-${now}-${Math.random().toString(36).slice(2, 8)}`,
      x: point.x,
      y: point.y,
      width: DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE.width,
      height: DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE.height,
      text: '',
      fontSize: DEFAULT_MEDIA_BOARD_ANNOTATION_FONT_SIZE,
      backgroundColor: DEFAULT_MEDIA_BOARD_ANNOTATION_BACKGROUND,
      textColor: DEFAULT_MEDIA_BOARD_ANNOTATION_TEXT,
      editing: true,
      createdAt: now,
      updatedAt: now,
    };

    setMediaBoardAnnotations((current) => [...current, annotation]);
    setSelectedMediaBoardAnnotationId(annotation.id);
    return annotation.id;
  }, []);

  return {
    createMediaBoardAnnotation,
    mediaBoardAnnotations,
    reloadMediaBoardAnnotations,
    selectedMediaBoardAnnotationId,
    setSelectedMediaBoardAnnotationId,
    updateMediaBoardAnnotation,
  };
}
