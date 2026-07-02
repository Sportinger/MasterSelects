import type { TimelineClip } from '../../../types';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  type VectorAnimationMetadata,
} from '../../../types/vectorAnimation';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateClipId } from '../helpers/idGenerator';

export interface AddRiveClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  metadata?: VectorAnimationMetadata;
}

export function createRiveClipPlaceholder(params: AddRiveClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, metadata } = params;
  const clipId = generateClipId('clip-rive');
  const duration = metadata?.duration ?? estimatedDuration;

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
      type: 'rive',
      naturalDuration: metadata?.duration ?? duration,
      mediaFileId,
      vectorAnimationSettings: { ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS },
    },
    mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export interface LoadRiveMediaParams {
  clip: TimelineClip;
  file: File;
  mediaFileId?: string;
  metadata?: VectorAnimationMetadata;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

export async function loadRiveMedia(params: LoadRiveMediaParams): Promise<void> {
  const { clip, file, mediaFileId, metadata, updateClip } = params;
  const naturalDuration = metadata?.duration ?? clip.duration;

  updateClip(clip.id, {
    file,
    duration: naturalDuration,
    outPoint: naturalDuration,
    source: {
      ...clip.source!,
      type: 'rive',
      mediaFileId,
      naturalDuration,
      vectorAnimationSettings: {
        ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
        ...clip.source?.vectorAnimationSettings,
      },
    },
    isLoading: false,
  });
}
