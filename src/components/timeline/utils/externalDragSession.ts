export interface ExternalDragPayload {
  kind:
    | 'media-file'
    | 'composition'
    | 'text'
    | 'solid'
    | 'mesh'
    | 'camera'
    | 'splat-effector'
    | 'math-scene'
    | 'motion-shape'
    | 'signal';
  id: string;
  duration?: number;
  hasAudio?: boolean;
  isAudio: boolean;
  isVideo: boolean;
  file?: File;
  meshType?: import('../../../stores/mediaStore/types').MeshPrimitiveType;
  primitive?: import('../../../types/motionDesign').ShapePrimitive;
}

export const EXTERNAL_DRAG_BRIDGE_EVENT = 'masterselects:external-drag-bridge';

export interface ExternalDragBridgeEventDetail {
  phase: 'move' | 'drop' | 'cancel';
  clientX: number;
  clientY: number;
}

let currentExternalDragPayload: ExternalDragPayload | null = null;

export function setExternalDragPayload(payload: ExternalDragPayload | null): void {
  currentExternalDragPayload = payload;
}

export function getExternalDragPayload(): ExternalDragPayload | null {
  return currentExternalDragPayload;
}

export function clearExternalDragPayload(): void {
  currentExternalDragPayload = null;
}

export function dispatchExternalDragBridgeEvent(detail: ExternalDragBridgeEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EXTERNAL_DRAG_BRIDGE_EVENT, { detail }));
}
