import type { ReactNode, RefObject } from 'react';

export interface MediaContextMenuFrameProps {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  children: ReactNode;
}

export function MediaContextMenuFrame({
  menuRef,
  x,
  y,
  children,
}: MediaContextMenuFrameProps) {
  return (
    <div
      ref={menuRef}
      className="media-context-menu"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
