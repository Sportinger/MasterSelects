import { useCallback, useState } from 'react';
import { useContextMenuPosition } from '../../../../hooks/useContextMenuPosition';
import type { MediaPanelContextMenu } from '../context/types';

export function useMediaPanelContextMenuState() {
  const [contextMenu, setContextMenu] = useState<MediaPanelContextMenu | null>(null);
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);

  return {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    contextMenuRef,
    contextMenuPosition,
  };
}
