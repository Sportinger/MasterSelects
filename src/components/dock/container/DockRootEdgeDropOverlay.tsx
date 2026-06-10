import type { DropPosition } from '../../../types/dock';

interface DockRootEdgeDropOverlayProps {
  isDragging: boolean;
  position: DropPosition | null;
}

export function DockRootEdgeDropOverlay({
  isDragging,
  position,
}: DockRootEdgeDropOverlayProps) {
  if (!isDragging || !position) return null;

  return <div className={`dock-root-drop-overlay ${position}`} />;
}
