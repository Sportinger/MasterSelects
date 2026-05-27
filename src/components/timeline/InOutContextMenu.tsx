import { useEffect } from 'react';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';

export type InOutPointType = 'in' | 'out';

export interface InOutContextMenuState {
  x: number;
  y: number;
  type: InOutPointType;
}

interface InOutContextMenuProps {
  menu: InOutContextMenuState | null;
  onDelete: (type: InOutPointType) => void;
  onClose: () => void;
}

export function InOutContextMenu({
  menu,
  onDelete,
  onClose,
}: InOutContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handleClickOutside = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  const label = menu.type === 'in' ? 'In Point' : 'Out Point';

  return (
    <div
      ref={menuRef}
      className="timeline-context-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? menu.x,
        top: adjustedPosition?.y ?? menu.y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="context-menu-item danger"
        onClick={() => {
          onDelete(menu.type);
          onClose();
        }}
      >
        Delete {label}
      </div>
    </div>
  );
}
