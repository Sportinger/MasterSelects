import type { LayerSource } from '../../types/layers';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { RuntimeProviderDemand } from '../../timeline';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { mathSceneRenderer } from '../mathScene/MathSceneRenderer';
import type {
  CompositionClipSourceEntry,
  CompositionImageSource,
  CompositionLoadClip,
  CompositionMediaFile,
  CompositionSources,
} from './sourceTypes';

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function getRuntimeOwnerId(compositionId: string, clipId: string): string {
  return `composition:${compositionId}:clip:${clipId}`;
}

export function getRuntimeAdmissionClip(
  compositionId: string,
  clip: SerializableClip
): TimelineClip {
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: null,
    transform: clip.transform as TimelineClip['transform'],
    effects: clip.effects ?? [],
    mediaFileId: clip.mediaFileId,
    compositionId,
  } as TimelineClip;
}

export function createImageHydrationDemand(
  sources: CompositionSources,
  clip: CompositionLoadClip,
  imageSource: CompositionImageSource,
  runtimeOwnerId: string
): RuntimeProviderDemand {
  const resourceId = `composition-render:${sources.compositionId}:${clip.id}:image-canvas:image`;
  return {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'composition-render',
    leasePolicy: 'background-cache',
    owner: removeUndefinedValues({
      ownerId: runtimeOwnerId,
      ownerType: 'composition' as const,
      clipId: clip.id,
      compositionId: sources.compositionId,
      mediaFileId: clip.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: clip.mediaFileId,
      mediaFileId: clip.mediaFileId,
      clipId: clip.id,
      compositionId: sources.compositionId,
      previewPath: imageSource.url,
    }),
    dimensions: {
      durationSeconds: clip.naturalDuration || 5,
    },
    priority: 'background',
    tags: ['composition-render', 'image'],
  };
}

export function getBackgroundSessionKey(
  compositionId: string,
  clipId: string,
  source?: Pick<LayerSource, 'runtimeSourceId' | 'runtimeSessionKey'> | null
): string | undefined {
  if (!source?.runtimeSourceId) {
    return source?.runtimeSessionKey;
  }
  return `background:${getRuntimeOwnerId(compositionId, clipId)}`;
}

export function getTimelineImageSource(
  clip: TimelineClip,
  mediaFile?: Pick<CompositionMediaFile, 'url' | 'file' | 'name'> | null
): CompositionImageSource | null {
  if (clip.source?.imageUrl) {
    return {
      url: clip.source.imageUrl,
      file: clip.source.file ?? mediaFile?.file ?? clip.file,
      name: clip.name,
    };
  }

  if (mediaFile?.url) {
    return {
      url: mediaFile.url,
      file: mediaFile.file ?? clip.source?.file ?? clip.file,
      name: mediaFile.name ?? clip.name,
    };
  }

  const file = mediaFile?.file ?? clip.source?.file ?? clip.file;
  if (file && file.size > 0) {
    const objectUrl = URL.createObjectURL(file);
    return {
      url: objectUrl,
      file,
      objectUrl,
      name: file.name || clip.name,
    };
  }

  return null;
}

export function getSerializableImageSource(
  clip: SerializableClip,
  mediaFile?: Pick<CompositionMediaFile, 'url' | 'file' | 'name'> | null
): CompositionImageSource | null {
  if (mediaFile?.url) {
    return {
      url: mediaFile.url,
      file: mediaFile.file,
      name: mediaFile.name ?? clip.name,
    };
  }

  if (mediaFile?.file && mediaFile.file.size > 0) {
    const objectUrl = URL.createObjectURL(mediaFile.file);
    return {
      url: objectUrl,
      file: mediaFile.file,
      objectUrl,
      name: mediaFile.file.name || mediaFile.name || clip.name,
    };
  }

  return null;
}

export function getBaseLayerSource(entry: CompositionClipSourceEntry): LayerSource {
  if (entry.type === 'video') {
    return {
      type: 'video',
      file: entry.file,
      videoElement: entry.videoElement,
      canvasElement: entry.canvasElement,
      isLiveInput: entry.isLiveInput,
      intrinsicWidth: entry.intrinsicWidth,
      intrinsicHeight: entry.intrinsicHeight,
      webCodecsPlayer: entry.webCodecsPlayer,
      runtimeSourceId: entry.runtimeSourceId,
      runtimeSessionKey: entry.runtimeSessionKey,
    };
  }

  if (entry.type === 'image') {
    return {
      type: 'image',
      file: entry.file,
      imageElement: entry.imageElement,
    };
  }

  return {
    type: 'text',
    textCanvas: entry.textCanvas,
  };
}

export function buildSerializableVectorAnimationClip(
  clip: SerializableClip,
  file: File
): TimelineClip {
  const sourceType = isVectorAnimationSourceType(clip.sourceType) ? clip.sourceType : 'lottie';
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    file,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: {
      type: sourceType,
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration ?? clip.duration,
      vectorAnimationSettings: clip.vectorAnimationSettings,
    },
    effects: clip.effects || [],
    transform: clip.transform,
    reversed: clip.reversed,
    isLoading: false,
  } as TimelineClip;
}

export function buildSerializableMathSceneClip(clip: SerializableClip): TimelineClip | null {
  if (!clip.mathScene) {
    return null;
  }

  const canvas = mathSceneRenderer.createCanvas();
  const mathClip: TimelineClip = {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    file: new File([JSON.stringify(clip.mathScene)], 'math-scene.json', { type: 'application/json' }),
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: {
      type: 'math-scene',
      textCanvas: canvas,
      naturalDuration: clip.duration,
    },
    mathScene: structuredClone(clip.mathScene),
    effects: clip.effects || [],
    transform: clip.transform,
    reversed: clip.reversed,
    isLoading: false,
  } as TimelineClip;

  mathSceneRenderer.renderClip(mathClip, 0);
  return mathClip;
}
