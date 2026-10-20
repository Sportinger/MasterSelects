import type { DockDragState } from '../../types/dock';

export const DEFAULT_DRAG_STATE: DockDragState = {
  isDragging: false,
  draggedPanel: null,
  sourceGroupId: null,
  sourceFloatingId: null,
  dropTarget: null,
  dragOffset: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
  lastDropCommitted: false,
};
