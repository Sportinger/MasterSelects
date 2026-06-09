import type { RefObject } from 'react';

import { MediaContextMenuFrame } from './MediaContextMenuFrame';
import {
  MediaAnnotationContextMenu,
  type MediaAnnotationColorOption,
  type MediaAnnotationColorTarget,
} from './MediaAnnotationContextMenu';
import type { MediaBoardAnnotation } from '../board/annotations';

export interface MediaAnnotationContextMenuMountProps {
  annotationId: string | undefined;
  annotations: readonly MediaBoardAnnotation[];
  colorOptions: readonly MediaAnnotationColorOption[];
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  onClose: () => void;
  onUpdateColor: (
    annotationId: string,
    target: MediaAnnotationColorTarget,
    value: string,
  ) => void;
}

export function renderMediaAnnotationContextMenuMount({
  annotationId,
  annotations,
  colorOptions,
  menuRef,
  x,
  y,
  onClose,
  onUpdateColor,
}: MediaAnnotationContextMenuMountProps) {
  const annotation = annotationId
    ? annotations.find((candidate) => candidate.id === annotationId) ?? null
    : null;

  if (!annotation) return null;

  return (
    <MediaContextMenuFrame menuRef={menuRef} x={x} y={y}>
      <MediaAnnotationContextMenu
        annotation={annotation}
        colorOptions={colorOptions}
        onUpdateColor={onUpdateColor}
        onClose={onClose}
      />
    </MediaContextMenuFrame>
  );
}
