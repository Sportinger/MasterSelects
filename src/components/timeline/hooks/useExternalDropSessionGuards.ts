import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { clearExternalDragPayload } from '../utils/externalDragSession';

interface UseExternalDropSessionGuardsProps {
  active: boolean;
  dragCounterRef: MutableRefObject<number>;
  clearExternalDragState: () => void;
}

// OS file drags can end outside the page (drop elsewhere, Escape, leaving the
// window), where no timeline drag handler fires. While a drag session is
// active, watch the whole document so the preview state always clears.
export function useExternalDropSessionGuards({
  active,
  dragCounterRef,
  clearExternalDragState,
}: UseExternalDropSessionGuardsProps): () => void {
  const clearExternalDragSession = useCallback(() => {
    dragCounterRef.current = 0;
    clearExternalDragPayload();
    clearExternalDragState();
  }, [clearExternalDragState, dragCounterRef]);

  useEffect(() => {
    if (!active) return undefined;

    let deferredDropCleanup: number | null = null;
    const finishNow = () => {
      if (deferredDropCleanup !== null) {
        window.clearTimeout(deferredDropCleanup);
        deferredDropCleanup = null;
      }
      clearExternalDragSession();
    };
    const finishAfterDropHandlers = () => {
      if (deferredDropCleanup !== null) return;
      deferredDropCleanup = window.setTimeout(() => {
        deferredDropCleanup = null;
        clearExternalDragSession();
      }, 0);
    };
    const handleDocumentDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        finishNow();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishNow();
      }
    };

    document.addEventListener('drop', finishAfterDropHandlers, true);
    document.addEventListener('dragend', finishNow, true);
    document.addEventListener('dragleave', handleDocumentDragLeave, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      if (deferredDropCleanup !== null) {
        window.clearTimeout(deferredDropCleanup);
      }
      document.removeEventListener('drop', finishAfterDropHandlers, true);
      document.removeEventListener('dragend', finishNow, true);
      document.removeEventListener('dragleave', handleDocumentDragLeave, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [active, clearExternalDragSession]);

  return clearExternalDragSession;
}
