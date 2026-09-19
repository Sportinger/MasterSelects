import { useEffect, useRef, useState } from 'react';
import type { SavedDockLayout } from '../../../types/dock';

interface ToolbarLayoutPickerProps {
  activeLayoutId: string | null;
  layouts: SavedDockLayout[];
  onSelectLayout: (layoutId: string) => void;
}

export function ToolbarLayoutPicker({
  activeLayoutId,
  layouts,
  onSelectLayout,
}: ToolbarLayoutPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="toolbar-layout-picker" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`toolbar-layout-picker-trigger${isOpen ? ' active' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        Layout
      </button>
      {isOpen && (
        <div aria-label="Layouts" className="toolbar-layout-metaball-menu" role="menu">
          <span aria-hidden="true" className="toolbar-layout-glass-lens" />
          {layouts.map((layout) => {
            const active = layout.id === activeLayoutId;
            return (
              <button
                aria-checked={active}
                className={`toolbar-layout-metaball-option${active ? ' active' : ''}`}
                key={layout.id}
                onClick={() => {
                  onSelectLayout(layout.id);
                  setIsOpen(false);
                }}
                role="menuitemradio"
                type="button"
              >
                {layout.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
