import type { MediaFolder, ProjectItem } from '../../../../stores/mediaStore';

export type MediaBoardItem = ProjectItem;

export interface MediaBoardViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface MediaBoardViewportSize {
  width: number;
  height: number;
}

export interface MediaBoardVisibleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MediaBoardGroupOffset {
  x: number;
  y: number;
}

export interface MediaBoardNodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaBoardGroupLayout {
  id: string | null;
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  itemCount: number;
  depth: number;
  isDraggingPreview?: boolean;
}

export interface MediaBoardNodePlacement {
  item: MediaBoardItem;
  layout: MediaBoardNodeLayout;
  defaultLayout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
  isDraggingPreview?: boolean;
}

export interface MediaBoardInsertGapPlacement {
  id: string;
  layout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
}

export interface MediaBoardSlotPlacement {
  id: string;
  layout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
  itemId?: string;
  isEmptySlot?: boolean;
}

export interface MediaBoardLayoutResult {
  groups: MediaBoardGroupLayout[];
  placements: MediaBoardNodePlacement[];
  insertGaps: MediaBoardInsertGapPlacement[];
  slots: MediaBoardSlotPlacement[];
}

export interface MediaBoardNodePlacementSnapshot {
  itemId: string;
  layout: MediaBoardNodeLayout;
  defaultLayout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
  isDraggingPreview?: boolean;
}

export interface MediaBoardLayoutSnapshot {
  version: number;
  signature: string;
  groups: MediaBoardGroupLayout[];
  placements: MediaBoardNodePlacementSnapshot[];
  insertGaps: MediaBoardInsertGapPlacement[];
  slots: MediaBoardSlotPlacement[];
}

export interface MediaBoardMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface MediaBoardInsertionPreview {
  movingIds: string[];
  targetGroupId: string | null;
  targetPosition: MediaBoardGroupOffset;
  sourceLayouts: Record<string, MediaBoardNodeLayout>;
}

export interface MediaBoardRenderLod {
  overviewCanvas: boolean;
  compact: boolean;
  showImages: boolean;
  requestThumbnails: boolean;
}

export type MediaBoardFolderLookup = Pick<MediaFolder, 'id' | 'name' | 'parentId'>;
