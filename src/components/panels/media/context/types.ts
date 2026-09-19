export interface MediaPanelContextMenu {
  x: number;
  y: number;
  preferAbove?: boolean;
  itemId?: string;
  annotationId?: string;
  parentId?: string | null;
  boardPosition?: { x: number; y: number };
}
