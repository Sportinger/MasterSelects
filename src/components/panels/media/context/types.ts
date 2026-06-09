export interface MediaPanelContextMenu {
  x: number;
  y: number;
  itemId?: string;
  annotationId?: string;
  parentId?: string | null;
  boardPosition?: { x: number; y: number };
}
