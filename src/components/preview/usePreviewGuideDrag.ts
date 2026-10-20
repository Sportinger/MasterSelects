import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  addCompositionGuide,
  moveCompositionGuide,
  removeCompositionGuide,
} from '../../services/compositionGuides';
import type { CompositionGuide } from '../../types/compositionGuides';
import { guidePositionAtPoint, isGuideRemovalPoint, type GuideViewport, type PreviewPoint } from './previewGuideMath';

export interface PreviewGuideDrag {
  orientation: CompositionGuide['orientation'];
  /** The moved guide, or null while a new guide is pulled out of a ruler. */
  guideId: string | null;
  position: number;
  /** Releasing now removes the guide (or creates none). */
  removing: boolean;
  pointer: PreviewPoint;
}

interface UsePreviewGuideDragOptions {
  rootRef: RefObject<HTMLElement | null>;
  compositionId: string | null;
  viewport: GuideViewport;
  rulerSize: number;
}

/**
 * Pointer drag for ruler guides: pull a new guide out of a ruler, move an
 * existing one, or drop it back on the ruler to remove it. Escape cancels.
 * The composition is written once on release, so a drag is one undo step.
 */
export function usePreviewGuideDrag({ rootRef, compositionId, viewport, rulerSize }: UsePreviewGuideDragOptions) {
  const [drag, setDrag] = useState<PreviewGuideDrag | null>(null);
  const dragRef = useRef<PreviewGuideDrag | null>(null);
  const viewportRef = useRef(viewport);
  useLayoutEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const update = useCallback((next: PreviewGuideDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const resolve = useCallback((
    orientation: CompositionGuide['orientation'],
    guideId: string | null,
    clientX: number,
    clientY: number,
    snap: boolean,
  ): PreviewGuideDrag | null => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const pointer = { x: clientX - rect.left, y: clientY - rect.top };
    const position = guidePositionAtPoint(orientation, pointer, viewportRef.current, snap);
    if (position === null) return null;
    const removing = isGuideRemovalPoint(orientation, pointer, viewportRef.current.containerSize, rulerSize);
    return { orientation, guideId, position, removing, pointer };
  }, [rootRef, rulerSize]);

  const start = useCallback((
    event: ReactPointerEvent<Element>,
    orientation: CompositionGuide['orientation'],
    guideId: string | null,
  ) => {
    if (!compositionId || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resolve(orientation, guideId, event.clientX, event.clientY, event.shiftKey);
    if (next) update(next);
  }, [compositionId, resolve, update]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging || !compositionId) return;
    const move = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = resolve(current.orientation, current.guideId, event.clientX, event.clientY, event.shiftKey);
      if (next) update(next);
    };
    const finish = () => {
      const current = dragRef.current;
      update(null);
      if (!current) return;
      if (current.guideId === null) {
        if (!current.removing) addCompositionGuide(compositionId, current.orientation, current.position);
      } else if (current.removing) {
        removeCompositionGuide(compositionId, current.guideId);
      } else {
        moveCompositionGuide(compositionId, current.guideId, current.position);
      }
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      update(null);
    };
    const abort = () => update(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('keydown', cancel, true);
    };
  }, [compositionId, dragging, resolve, update]);

  return {
    drag,
    startCreate: (event: ReactPointerEvent<Element>, orientation: CompositionGuide['orientation']) => start(event, orientation, null),
    startMove: (event: ReactPointerEvent<Element>, guide: CompositionGuide) => start(event, guide.orientation, guide.id),
  };
}
