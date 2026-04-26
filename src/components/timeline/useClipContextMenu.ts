import { useCallback } from 'react';
import type { ContextMenuState } from './types';

export function useClipContextMenu(
  selectedClipIds: Set<string>,
  selectClip: (clipId: string) => void,
  setContextMenu: (menu: ContextMenuState | null) => void
) {
  return useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedClipIds.has(clipId)) {
        selectClip(clipId);
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        clipId,
      });
    },
    [selectedClipIds, selectClip, setContextMenu]
  );
}
