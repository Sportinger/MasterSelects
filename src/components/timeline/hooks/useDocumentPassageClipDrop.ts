import { useState } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { TimelineTrackProps } from '../types';
import { useMediaStore } from '../../../stores/mediaStore';
import { DOCUMENT_PASSAGE_MIME, linkDocumentPassageToClip,
  parseDocumentPassageDrag } from '../../../services/documents/documentClipDrop';

interface Options {
  trackId: string;
  clipRowRef: RefObject<HTMLDivElement | null>;
  hitTestClipAtClientX: (clientX: number, row: HTMLElement) => string | null;
  onDrop: TimelineTrackProps['onDrop'];
  onDragOver: TimelineTrackProps['onDragOver'];
  onDragEnter: TimelineTrackProps['onDragEnter'];
  onDragLeave: TimelineTrackProps['onDragLeave'];
}

export function useDocumentPassageClipDrop({
  trackId, clipRowRef, hitTestClipAtClientX, onDrop, onDragOver, onDragEnter, onDragLeave,
}: Options) {
  const [target, setTarget] = useState<{ clipId: string; x: number } | null>(null);
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(DOCUMENT_PASSAGE_MIME)) {
      onDragOver(event, trackId);
      return;
    }
    const row = clipRowRef.current;
    const clipId = row ? hitTestClipAtClientX(event.clientX, row) : null;
    if (!clipId) { setTarget(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'link';
    setTarget({ clipId, x: event.clientX - event.currentTarget.getBoundingClientRect().left });
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    setTarget(null);
    if (!event.dataTransfer.types.includes(DOCUMENT_PASSAGE_MIME)) {
      onDrop(event, trackId);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const row = clipRowRef.current;
    const clipId = row ? hitTestClipAtClientX(event.clientX, row) : null;
    const compositionId = useMediaStore.getState().activeCompositionId;
    const passage = parseDocumentPassageDrag(event.dataTransfer.getData(DOCUMENT_PASSAGE_MIME));
    if (clipId && compositionId && passage) linkDocumentPassageToClip(passage, compositionId, clipId);
  };
  const dragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(DOCUMENT_PASSAGE_MIME)) event.preventDefault();
    else onDragEnter(event, trackId);
  };
  const dragLeave = (event: DragEvent<HTMLDivElement>) => {
    setTarget(null);
    if (!event.dataTransfer.types.includes(DOCUMENT_PASSAGE_MIME)) onDragLeave(event);
  };
  return { target, dragOver, drop, dragEnter, dragLeave };
}
