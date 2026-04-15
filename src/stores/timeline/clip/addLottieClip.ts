import type { TimelineClip } from '../../../types';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  type VectorAnimationMetadata,
} from '../../../types/vectorAnimation';
import { lottieRuntimeManager } from '../../../services/vectorAnimation/LottieRuntimeManager';
import { DEFAULT_TRANSFORM, calculateNativeScale } from '../constants';
import { generateClipId } from '../helpers/idGenerator';

export interface AddLottieClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  metadata?: VectorAnimationMetadata;
}

export function createLottieClipPlaceholder(params: AddLottieClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, metadata } = params;
  const clipId = generateClipId('clip-lottie');
  const duration = metadata?.duration ?? estimatedDuration;
  const nativeScale = (metadata?.width && metadata?.height)
    ? calculateNativeScale(metadata.width, metadata.height)
    : { x: 1, y: 1 };

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: {
      type: 'lottie',
      naturalDuration: metadata?.duration ?? duration,
      mediaFileId,
      vectorAnimationSettings: { ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS },
    },
    mediaFileId,
    transform: { ...DEFAULT_TRANSFORM, scale: nativeScale },
    effects: [],
    isLoading: true,
  };
}

export interface LoadLottieMediaParams {
  clip: TimelineClip;
  file: File;
  mediaFileId?: string;
  metadata?: VectorAnimationMetadata;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

export async function loadLottieMedia(params: LoadLottieMediaParams): Promise<void> {
  const { clip, file, mediaFileId, metadata, updateClip } = params;
  const runtime = await lottieRuntimeManager.prepareClipSource(clip, file);
  const resolvedMetadata = metadata ?? runtime.metadata;
  const naturalDuration = resolvedMetadata.duration ?? clip.duration;
  const nativeScale = (resolvedMetadata.width && resolvedMetadata.height)
    ? calculateNativeScale(resolvedMetadata.width, resolvedMetadata.height)
    : clip.transform.scale;

  updateClip(clip.id, {
    file,
    duration: naturalDuration,
    outPoint: naturalDuration,
    source: {
      ...clip.source!,
      type: 'lottie',
      mediaFileId,
      naturalDuration,
      textCanvas: runtime.canvas,
      vectorAnimationSettings: {
        ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
        ...clip.source?.vectorAnimationSettings,
      },
    },
    transform: {
      ...clip.transform,
      scale: nativeScale,
    },
    isLoading: false,
  });
}
