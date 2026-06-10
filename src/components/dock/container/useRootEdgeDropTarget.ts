import { useCallback } from 'react';

import type { DropTarget } from '../../../types/dock';
import { calculateRootEdgeDropPosition } from '../../../utils/dockLayout';

interface UseRootEdgeDropTargetArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rootGroupId: string;
}

export function useRootEdgeDropTarget({
  containerRef,
  rootGroupId,
}: UseRootEdgeDropTargetArgs): (mouseX: number, mouseY: number) => DropTarget | null {
  return useCallback((mouseX: number, mouseY: number): DropTarget | null => {
    const container = containerRef.current;
    if (!container) return null;

    const position = calculateRootEdgeDropPosition(container.getBoundingClientRect(), mouseX, mouseY);
    if (!position) return null;

    return {
      groupId: rootGroupId,
      position,
      scope: 'root-edge',
    };
  }, [containerRef, rootGroupId]);
}
