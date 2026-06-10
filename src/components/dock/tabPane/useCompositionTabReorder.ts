import { useCallback, useState } from 'react';

import type { HoldProgress } from './useDockTabHoldDrag';

interface UseCompositionTabReorderArgs {
  holdProgress: HoldProgress;
  reorderCompositionTabs: (fromIndex: number, toIndex: number) => void;
}

export function useCompositionTabReorder({
  holdProgress,
  reorderCompositionTabs,
}: UseCompositionTabReorderArgs) {
  const [draggedCompIndex, setDraggedCompIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleCompDragStart = useCallback((event: React.DragEvent, index: number) => {
    if (holdProgress !== 'idle') {
      event.preventDefault();
      return;
    }
    setDraggedCompIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }, [holdProgress]);

  const handleCompDragOver = useCallback((event: React.DragEvent, index: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggedCompIndex !== null && draggedCompIndex !== index) {
      setDropTargetIndex(index);
    }
  }, [draggedCompIndex]);

  const handleCompDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleCompDrop = useCallback((event: React.DragEvent, toIndex: number) => {
    event.preventDefault();
    if (draggedCompIndex !== null && draggedCompIndex !== toIndex) {
      reorderCompositionTabs(draggedCompIndex, toIndex);
    }
    setDraggedCompIndex(null);
    setDropTargetIndex(null);
  }, [draggedCompIndex, reorderCompositionTabs]);

  const handleCompDragEnd = useCallback(() => {
    setDraggedCompIndex(null);
    setDropTargetIndex(null);
  }, []);

  return {
    draggedCompIndex,
    dropTargetIndex,
    handleCompDragStart,
    handleCompDragOver,
    handleCompDragLeave,
    handleCompDrop,
    handleCompDragEnd,
  };
}
