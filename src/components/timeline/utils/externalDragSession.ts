import type {
  Composition,
  MediaFile,
  ProjectItem,
  SignalAssetItem,
} from '../../../stores/mediaStore';
import { createSignalTimelineAdapterPlan } from '../../../runtime/renderers/signalTimelineRendererAdapter';

export interface ExternalDragPayload {
  kind:
    | 'media-file'
    | 'composition'
    | 'text'
    | 'solid'
    | 'mesh'
    | 'camera'
    | 'light'
    | 'splat-effector'
    | 'math-scene'
    | 'motion-shape'
    | 'signal';
  id: string;
  duration?: number;
  hasAudio?: boolean;
  isAudio: boolean;
  isVideo: boolean;
  label?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  file?: File;
  meshType?: import('../../../stores/mediaStore/types').MeshPrimitiveType;
  primitive?: import('../../../types/motionDesign').ShapePrimitive;
}

export const EXTERNAL_DRAG_BRIDGE_EVENT = 'masterselects:external-drag-bridge';

export interface ExternalDragBridgeEventDetail {
  phase: 'move' | 'drop' | 'cancel';
  clientX: number;
  clientY: number;
  targetTrackId?: string;
  targetNewTrackType?: 'video' | 'audio';
}

interface CreateExternalDragPayloadOptions {
  activeCompositionId?: string | null;
  requireMediaFileObject?: boolean;
  slotGridProgress?: number;
}

let currentExternalDragPayload: ExternalDragPayload | null = null;

export function createExternalDragPayloadForProjectItem(
  item: ProjectItem,
  options: CreateExternalDragPayloadOptions = {},
): ExternalDragPayload | null {
  if (isMediaFolderProjectItem(item)) {
    return null;
  }
  if (!('type' in item)) {
    return null;
  }

  if (item.type === 'composition') {
    const comp = item as Composition;
    const inSlotView = (options.slotGridProgress ?? 0) > 0.5;
    if (comp.id === options.activeCompositionId && !inSlotView) {
      return null;
    }
    return {
      kind: 'composition',
      id: comp.id,
      duration: comp.timelineData?.duration ?? comp.duration ?? 5,
      hasAudio: true,
      isAudio: false,
      isVideo: true,
      label: comp.name,
      mediaType: comp.type,
    };
  }

  if (item.type === 'text') {
    return {
      kind: 'text',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'solid') {
    return {
      kind: 'solid',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'model' && 'meshType' in item) {
    return {
      kind: 'mesh',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      meshType: item.meshType,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'camera') {
    return {
      kind: 'camera',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'light') {
    return {
      kind: 'light',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'splat-effector') {
    return {
      kind: 'splat-effector',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'math-scene') {
    return {
      kind: 'math-scene',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'motion-shape') {
    return {
      kind: 'motion-shape',
      id: item.id,
      duration: item.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      primitive: item.primitive,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (item.type === 'signal') {
    const plan = createSignalTimelineAdapterPlan(item as SignalAssetItem);
    return {
      kind: 'signal',
      id: item.id,
      duration: plan.duration,
      hasAudio: false,
      isAudio: false,
      isVideo: true,
      label: item.name,
      mediaType: item.type,
    };
  }

  if (isImportedMediaFileProjectItem(item)) {
    if (options.requireMediaFileObject && !item.file) {
      return null;
    }

    const fileName = item.file?.name ?? item.name;
    const isAudioOnly =
      item.type === 'audio' ||
      item.file?.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(fileName);
    return {
      kind: 'media-file',
      id: item.id,
      duration: item.duration,
      hasAudio: item.type === 'image' ? false : isAudioOnly ? true : item.hasAudio,
      isAudio: isAudioOnly,
      isVideo: !isAudioOnly,
      label: item.name,
      mediaType: item.type,
      thumbnailUrl: item.thumbnailUrl ?? (item.type === 'image' ? item.url : undefined),
      file: item.file,
    };
  }

  return null;
}

export function getExternalDragPayloadMimeTypes(payload: ExternalDragPayload): string[] {
  switch (payload.kind) {
    case 'composition':
      return ['application/x-composition-id'];
    case 'text':
      return ['application/x-text-item-id'];
    case 'solid':
      return ['application/x-solid-item-id'];
    case 'mesh':
      return ['application/x-mesh-item-id'];
    case 'camera':
      return ['application/x-camera-item-id'];
    case 'light':
      return ['application/x-light-item-id'];
    case 'splat-effector':
      return ['application/x-splat-effector-item-id'];
    case 'math-scene':
      return ['application/x-math-scene-item-id'];
    case 'motion-shape':
      return ['application/x-motion-shape-item-id'];
    case 'signal':
      return ['application/x-signal-asset-id'];
    case 'media-file':
      return payload.isAudio
        ? ['application/x-media-file-id', 'application/x-media-is-audio']
        : ['application/x-media-file-id'];
  }
}

export function getExternalDragPayloadMimeData(
  payload: ExternalDragPayload,
  mimeType: string,
): string {
  if (mimeType === 'application/x-composition-id' && payload.kind === 'composition') return payload.id;
  if (mimeType === 'application/x-text-item-id' && payload.kind === 'text') return payload.id;
  if (mimeType === 'application/x-solid-item-id' && payload.kind === 'solid') return payload.id;
  if (mimeType === 'application/x-mesh-item-id' && payload.kind === 'mesh') return payload.id;
  if (mimeType === 'application/x-camera-item-id' && payload.kind === 'camera') return payload.id;
  if (mimeType === 'application/x-light-item-id' && payload.kind === 'light') return payload.id;
  if (mimeType === 'application/x-splat-effector-item-id' && payload.kind === 'splat-effector') return payload.id;
  if (mimeType === 'application/x-math-scene-item-id' && payload.kind === 'math-scene') return payload.id;
  if (mimeType === 'application/x-motion-shape-item-id' && payload.kind === 'motion-shape') return payload.id;
  if (mimeType === 'application/x-signal-asset-id' && payload.kind === 'signal') return payload.id;
  if (mimeType === 'application/x-media-file-id' && payload.kind === 'media-file') return payload.id;
  if (mimeType === 'application/x-media-is-audio' && payload.kind === 'media-file' && payload.isAudio) return 'true';
  return '';
}

export function applyExternalDragPayloadToDataTransfer(
  dataTransfer: DataTransfer,
  payload: ExternalDragPayload,
): void {
  for (const mimeType of getExternalDragPayloadMimeTypes(payload)) {
    dataTransfer.setData(mimeType, getExternalDragPayloadMimeData(payload, mimeType));
  }
}

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

function isMediaFolderProjectItem(item: ProjectItem): boolean {
  return 'isExpanded' in item;
}

function isImportedMediaFileProjectItem(item: ProjectItem): item is MediaFile {
  if (!('type' in item) || isMediaFolderProjectItem(item)) {
    return false;
  }

  if (
    item.type === 'composition' ||
    item.type === 'text' ||
    item.type === 'solid' ||
    item.type === 'camera' ||
    item.type === 'light' ||
    item.type === 'splat-effector' ||
    item.type === 'math-scene' ||
    item.type === 'motion-shape'
  ) {
    return false;
  }

  if (item.type === 'model' && 'meshType' in item) {
    return false;
  }

  return 'url' in item;
}
