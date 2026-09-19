import { useEffect } from 'react';

import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';

export interface SceneObjectOrbitContextMenuState {
  x: number;
  y: number;
  clipId: string;
  name: string;
}

interface SceneObjectOrbitContextMenuProps {
  menu: SceneObjectOrbitContextMenuState | null;
  onClose: () => void;
  onOrbit: (clipId: string) => void;
}

export function SceneObjectOrbitContextMenu({
  menu,
  onClose,
  onOrbit,
}: SceneObjectOrbitContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  useEffect(() => {
    if (!menu) return undefined;

    const close = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const timeoutId = window.setTimeout(() => window.addEventListener('click', close), 0);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="preview-scene-object-context-menu"
      role="menu"
      style={{
        left: adjustedPosition?.x ?? menu.x,
        top: adjustedPosition?.y ?? menu.y,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="preview-scene-object-context-menu-title">{menu.name}</div>
      <button
        type="button"
        role="menuitem"
        onClick={() => onOrbit(menu.clipId)}
        onPointerUp={(event) => event.currentTarget.blur()}
      >
        Orbit
      </button>
    </div>
  );
}
