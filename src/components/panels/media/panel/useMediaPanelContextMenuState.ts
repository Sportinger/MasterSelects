import { useCallback, useEffect, useState } from 'react';
import { useContextMenuPosition } from '../../../../hooks/useContextMenuPosition';
import type { MediaPanelContextMenu } from '../context/types';

export function useMediaPanelContextMenuState() {
  const [contextMenu, setContextMenu] = useState<MediaPanelContextMenu | null>(null);
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);

  useEffect(() => {
    if (!contextMenu) return;

    const closeOnOutsidePress = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    document.addEventListener('touchstart', closeOnOutsidePress, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress, true);
      document.removeEventListener('touchstart', closeOnOutsidePress, true);
    };
  }, [closeContextMenu, contextMenu, contextMenuRef]);

  return {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    contextMenuRef,
    contextMenuPosition,
  };
}
