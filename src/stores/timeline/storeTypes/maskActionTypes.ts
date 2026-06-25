import type { ClipMask, MaskVertex, MaskVertexHandleMode } from '../../../types';
import type { MaskEditMode } from './toolTypes';

export interface MaskActions {
  setMaskEditMode: (mode: MaskEditMode) => void;
  setMaskPanelActive: (active: boolean) => void;
  setMaskDragging: (dragging: boolean) => void;
  setMaskDrawStart: (point: { x: number; y: number } | null) => void;
  setActiveMask: (clipId: string | null, maskId: string | null) => void;
  selectVertex: (vertexId: string, addToSelection?: boolean) => void;
  selectVertices: (vertexIds: string[]) => void;
  selectMaskEdge: (edgeId: string | null) => void;
  deselectAllVertices: () => void;
  showMaskFeatherPreview: (maskId: string, edgeId?: string | null) => void;
  addMask: (clipId: string, mask?: Partial<ClipMask>) => string;
  removeMask: (clipId: string, maskId: string) => void;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
  setMaskEdgeFeather: (clipId: string, maskId: string, edgeId: string, feather: number) => void;
  reorderMasks: (clipId: string, fromIndex: number, toIndex: number) => void;
  getClipMasks: (clipId: string) => ClipMask[];
  addVertex: (clipId: string, maskId: string, vertex: Omit<MaskVertex, 'id'>, index?: number) => string;
  removeVertex: (clipId: string, maskId: string, vertexId: string) => void;
  updateVertex: (clipId: string, maskId: string, vertexId: string, updates: Partial<MaskVertex>, skipCacheInvalidation?: boolean) => void;
  updateVertices: (
    clipId: string,
    maskId: string,
    vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>,
    skipCacheInvalidation?: boolean
  ) => void;
  setVertexHandleMode: (clipId: string, maskId: string, vertexIds: string[], mode: MaskVertexHandleMode) => void;
  closeMask: (clipId: string, maskId: string) => void;
  addRectangleMask: (clipId: string) => string;
  addEllipseMask: (clipId: string) => string;
  copyClipMask: (clipId: string, maskId: string) => void;
  pasteClipMask: (targetClipIds?: string[]) => void;
  hasClipboardMask: () => boolean;
}
