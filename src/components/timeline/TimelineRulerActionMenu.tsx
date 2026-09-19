import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';

export interface TimelineRulerActionMenuState {
  time: number;
  x: number;
  y: number;
}

interface TimelineRulerActionMenuProps {
  formatTime: (seconds: number) => string;
  menu: TimelineRulerActionMenuState | null;
  onAddAnnotation?: (time: number) => void;
  onAddMarker?: (time: number) => void;
  onClose: () => void;
  onConvertAnnotationToClip?: (time: number) => void;
  onConvertAnnotationToComposition?: (time: number) => void;
  onSetInPoint?: (time: number) => void;
  onSetOutPoint?: (time: number) => void;
}

export function TimelineRulerActionMenu({
  formatTime,
  menu,
  onAddAnnotation,
  onAddMarker,
  onClose,
  onConvertAnnotationToClip,
  onConvertAnnotationToComposition,
  onSetInPoint,
  onSetOutPoint,
}: TimelineRulerActionMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  useEffect(() => {
    if (!menu) return undefined;

    const close = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('pointerdown', close);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const run = (action: ((time: number) => void) | undefined) => {
    action?.(menu.time);
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      aria-label={`Ruler actions at ${formatTime(menu.time)}`}
      className="timeline-context-menu timeline-ruler-action-menu"
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => event.stopPropagation()}
      role="menu"
      style={{
        left: adjustedPosition?.x ?? menu.x,
        position: 'fixed',
        top: adjustedPosition?.y ?? menu.y,
        zIndex: 10000,
      }}
    >
      <button className="context-menu-item" onClick={() => run(onSetInPoint)} role="menuitem" type="button">
        Set In
      </button>
      <button className="context-menu-item" onClick={() => run(onSetOutPoint)} role="menuitem" type="button">
        Set Out
      </button>
      <button className="context-menu-item" onClick={() => run(onAddAnnotation)} role="menuitem" type="button">
        Add Annotation
      </button>
      {onConvertAnnotationToClip && (
        <button className="context-menu-item" onClick={() => run(onConvertAnnotationToClip)} role="menuitem" type="button">
          Link Annotation to Clip
        </button>
      )}
      {onConvertAnnotationToComposition && (
        <button className="context-menu-item" onClick={() => run(onConvertAnnotationToComposition)} role="menuitem" type="button">
          Convert to Composition Annotation
        </button>
      )}
      <button className="context-menu-item" onClick={() => run(onAddMarker)} role="menuitem" type="button">
        Add Marker
      </button>
    </div>,
    document.body,
  );
}
