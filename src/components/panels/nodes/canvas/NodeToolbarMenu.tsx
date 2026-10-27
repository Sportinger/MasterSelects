import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './NodeToolbarMenu.css';

/**
 * Phone skin: the node toolbar's secondary actions (Previews, Signals, Lines, Avoid, Compact,
 * Disconnect, Expand/Collapse all, Arrange, Reset) behind one "More" button, so the toolbar keeps
 * Add, Delete, Fit and the zoom read-out in reach instead of running off a phone screen. The menu
 * holds the same buttons as the desktop toolbar; toggles stay open so several can be flipped.
 * It is portalled into the phone skin root because the toolbar scrolls sideways and would clip it.
 */
export function NodeToolbarMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number; host: HTMLElement } | null>(null);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!open || !button) return;
    const rect = button.getBoundingClientRect();
    const host = button.closest<HTMLElement>('.mobile-skin') ?? document.body;
    setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right), host });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  return <>
    <button ref={buttonRef} type="button" className="node-workspace-toolbar-button node-workspace-toolbar-more" data-testid="node-toolbar-more"
      aria-expanded={open} aria-label="More node tools" title="More node tools"
      onClick={event => { setOpen(value => !value); if (event.detail > 0) event.currentTarget.blur(); }}>
      <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="8" r="1.6" /><circle cx="8" cy="8" r="1.6" /><circle cx="13" cy="8" r="1.6" />
      </svg>
    </button>
    {open && position && createPortal(
      <div ref={menuRef} className="node-workspace-toolbar-menu" data-testid="node-toolbar-menu" role="group" aria-label="Node tools"
        style={{ top: position.top, right: position.right }}
        onPointerUp={event => {
          // Pointer focus hygiene: a tapped entry does not keep a focus ring.
          const control = event.target instanceof Element ? event.target.closest('button') : null;
          if (control && event.pointerType !== 'mouse') control.blur();
        }}>
        {children}
      </div>,
      position.host,
    )}
  </>;
}
