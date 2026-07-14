import { useMediaStore } from '../../../stores/mediaStore';
import { createSignalTimelineAdapterPlan } from '../../../runtime/renderers/signalTimelineRendererAdapter';
import {
  isAudioFile,
  isGaussianSplatFile,
  isMediaFile,
  isModelFile,
  isVideoFile,
} from '../utils/fileTypeHelpers';
import { getExternalDragPayload } from '../utils/externalDragSession';
import type { ExternalDragState } from '../types';

interface ExternalDropMetadataCache {
  url: string;
  duration: number;
  hasAudio: boolean;
}

export interface ExternalDropImmediatePreview {
  duration?: number;
  hasAudio?: boolean;
  isAudio: boolean;
  isVideo: boolean;
}

interface ResolveExternalDropImmediatePreviewParams {
  dataTransfer: DataTransfer;
  currentPreview: ExternalDragState | null;
  metadataCache: ExternalDropMetadataCache | null;
  requestVideoMetadata: (cacheKey: string, file: File) => void;
}

const VISUAL_DEFAULT_PREVIEW: ExternalDropImmediatePreview = {
  duration: 5,
  hasAudio: false,
  isAudio: false,
  isVideo: true,
};

function visualPreview(duration: number | undefined, fallbackDuration: number): ExternalDropImmediatePreview {
  return {
    ...VISUAL_DEFAULT_PREVIEW,
    duration: duration ?? fallbackDuration,
  };
}

export function resolveExternalDropImmediatePreview({
  dataTransfer,
  currentPreview,
  metadataCache,
  requestVideoMetadata,
}: ResolveExternalDropImmediatePreviewParams): ExternalDropImmediatePreview {
  const mediaStore = useMediaStore.getState();
  const dragPayload = getExternalDragPayload();
  const types = dataTransfer.types;

  if (types.includes('application/x-composition-id')) {
    if (dragPayload?.kind === 'composition') {
      return {
        duration: dragPayload.duration ?? 5,
        hasAudio: dragPayload.hasAudio ?? true,
        isAudio: false,
        isVideo: true,
      };
    }

    const compositionId = dataTransfer.getData('application/x-composition-id');
    const comp = mediaStore.compositions.find((c) => c.id === compositionId);
    return {
      duration: comp?.timelineData?.duration ?? comp?.duration ?? 5,
      hasAudio: true,
      isAudio: false,
      isVideo: true,
    };
  }

  if (types.includes('application/x-text-item-id')) {
    if (dragPayload?.kind === 'text') return visualPreview(dragPayload.duration, 5);
    const textItemId = dataTransfer.getData('application/x-text-item-id');
    const textItem = mediaStore.textItems.find((t) => t.id === textItemId);
    return visualPreview(textItem?.duration, 5);
  }

  if (types.includes('application/x-solid-item-id')) {
    if (dragPayload?.kind === 'solid') return visualPreview(dragPayload.duration, 5);
    const solidItemId = dataTransfer.getData('application/x-solid-item-id');
    const solidItem = mediaStore.solidItems.find((s) => s.id === solidItemId);
    return visualPreview(solidItem?.duration, 5);
  }

  if (types.includes('application/x-mesh-item-id')) {
    if (dragPayload?.kind === 'mesh') return visualPreview(dragPayload.duration, 10);
    const meshItemId = dataTransfer.getData('application/x-mesh-item-id');
    const meshItem = mediaStore.meshItems.find((m) => m.id === meshItemId);
    return visualPreview(meshItem?.duration, 10);
  }

  if (types.includes('application/x-camera-item-id')) {
    if (dragPayload?.kind === 'camera') return visualPreview(dragPayload.duration, 10);
    const cameraItemId = dataTransfer.getData('application/x-camera-item-id');
    const cameraItem = mediaStore.cameraItems.find((c) => c.id === cameraItemId);
    return visualPreview(cameraItem?.duration, 10);
  }

  if (types.includes('application/x-light-item-id')) {
    if (dragPayload?.kind === 'light') return visualPreview(dragPayload.duration, 10);
    const lightItemId = dataTransfer.getData('application/x-light-item-id');
    const lightItem = mediaStore.lightItems.find((light) => light.id === lightItemId);
    return visualPreview(lightItem?.duration, 10);
  }

  if (types.includes('application/x-splat-effector-item-id')) {
    if (dragPayload?.kind === 'splat-effector') return visualPreview(dragPayload.duration, 10);
    const effectorItemId = dataTransfer.getData('application/x-splat-effector-item-id');
    const effectorItem = mediaStore.splatEffectorItems.find((effector) => effector.id === effectorItemId);
    return visualPreview(effectorItem?.duration, 10);
  }

  if (types.includes('application/x-math-scene-item-id')) {
    if (dragPayload?.kind === 'math-scene') return visualPreview(dragPayload.duration, 5);
    const mathSceneItemId = dataTransfer.getData('application/x-math-scene-item-id');
    const mathSceneItem = mediaStore.mathSceneItems.find((item) => item.id === mathSceneItemId);
    return visualPreview(mathSceneItem?.duration, 5);
  }

  if (types.includes('application/x-motion-shape-item-id')) {
    if (dragPayload?.kind === 'motion-shape') return visualPreview(dragPayload.duration, 5);
    const motionShapeItemId = dataTransfer.getData('application/x-motion-shape-item-id');
    const motionShapeItem = mediaStore.motionShapeItems.find((item) => item.id === motionShapeItemId);
    return visualPreview(motionShapeItem?.duration, 5);
  }

  if (types.includes('application/x-signal-asset-id')) {
    if (dragPayload?.kind === 'signal') return visualPreview(dragPayload.duration, 5);
    const signalAssetId = dataTransfer.getData('application/x-signal-asset-id');
    const signalAsset = mediaStore.signalAssets.find((item) => item.id === signalAssetId);
    return visualPreview(signalAsset ? createSignalTimelineAdapterPlan(signalAsset).duration : undefined, 5);
  }

  if (types.includes('application/x-media-file-id')) {
    if (dragPayload?.kind === 'media-file') {
      if (dragPayload.file && dragPayload.isVideo && dragPayload.duration === undefined) {
        requestVideoMetadata(`media:${dragPayload.id}`, dragPayload.file);
      }

      return {
        duration: dragPayload.duration,
        hasAudio: dragPayload.hasAudio,
        isAudio: dragPayload.isAudio,
        isVideo: dragPayload.isVideo,
      };
    }

    const mediaFileId = dataTransfer.getData('application/x-media-file-id');
    const mediaFile = mediaStore.files.find((f) => f.id === mediaFileId);
    const isAudio =
      types.includes('application/x-media-is-audio') ||
      mediaFile?.type === 'audio';
    const isVideo = !isAudio;
    const duration = mediaFile?.duration;
    const hasAudio =
      mediaFile?.type === 'image'
        ? false
        : isAudio
          ? true
          : mediaFile?.hasAudio;

    if (mediaFile?.file && mediaFile.type === 'video' && duration === undefined) {
      requestVideoMetadata(`media:${mediaFile.id}`, mediaFile.file);
    }

    return { duration, hasAudio, isAudio, isVideo };
  }

  if (types.includes('Files')) {
    let duration = currentPreview?.duration ?? metadataCache?.duration;
    let hasAudio = currentPreview?.hasAudio ?? metadataCache?.hasAudio;
    let isAudio = false;
    let isVideo = true;

    const items = dataTransfer.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;

        const file = item.getAsFile();
        if (!file) continue;

        if (isAudioFile(file)) {
          isAudio = true;
          isVideo = false;
          hasAudio = true;
          break;
        }

        if (isVideoFile(file)) {
          const cacheKey = `${file.name}_${file.size}`;
          if (metadataCache?.url === cacheKey) {
            duration = metadataCache.duration;
            hasAudio = metadataCache.hasAudio;
          } else {
            requestVideoMetadata(cacheKey, file);
          }
          break;
        }

        if (isGaussianSplatFile(file) || isModelFile(file)) {
          duration = duration ?? 10;
          hasAudio = false;
          isVideo = true;
          isAudio = false;
          break;
        }

        if (isMediaFile(file)) {
          hasAudio = false;
          break;
        }
      }
    }

    return { duration, hasAudio, isAudio, isVideo };
  }

  return {
    duration: currentPreview?.duration ?? metadataCache?.duration,
    hasAudio: currentPreview?.hasAudio ?? metadataCache?.hasAudio,
    isAudio: !!currentPreview?.isAudio,
    isVideo: currentPreview?.isVideo ?? !currentPreview?.isAudio,
  };
}
