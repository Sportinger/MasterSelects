// Gaussian Splat clip addition — PLY/splat/ksplat scene files
// Creates a timeline clip with is3D=true that renders via the gaussian splat pipeline

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../../engine/gaussian/types';
import { prewarmGaussianSplatRuntime } from '../../../engine/three/splatRuntimeCache';

const DEFAULT_SPLAT_DURATION = 30; // seconds
const MAX_SPLAT_DURATION = 3600; // 1 hour

export interface AddGaussianSplatClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
}

/**
 * Create placeholder gaussian splat clip immediately.
 * Auto-sets is3D=true so it renders via the 3D pipeline.
 */
export function createGaussianSplatClipPlaceholder(params: AddGaussianSplatClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration } = params;
  const clipId = generateClipId('clip-gsplat');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration || DEFAULT_SPLAT_DURATION,
    inPoint: 0,
    outPoint: estimatedDuration || DEFAULT_SPLAT_DURATION,
    source: {
      type: 'gaussian-splat',
      naturalDuration: MAX_SPLAT_DURATION,
      mediaFileId: params.mediaFileId,
      gaussianSplatSettings: { ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS },
    },
    mediaFileId: params.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    is3D: true,  // Auto-enable 3D for gaussian splat clips
    isLoading: true,  // Splat takes time to load
  };
}

export interface LoadGaussianSplatMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * "Load" gaussian splat media — creates blob URL for the renderer to load later.
 * No HTMLVideoElement or HTMLImageElement needed.
 */
export function loadGaussianSplatMedia(params: LoadGaussianSplatMediaParams): void {
  const { clip, updateClip } = params;

  if (!clip.file) {
    console.error('[GaussianSplat] loadGaussianSplatMedia: clip.file is missing — cannot create blob URL', clip.id);
    updateClip(clip.id, { isLoading: false });
    return;
  }

  try {
    // Create a blob URL that the gaussian splat renderer can fetch
    const gaussianSplatUrl = blobUrlManager.create(clip.id, clip.file, 'model');

    updateClip(clip.id, {
      source: {
        ...clip.source!,
        gaussianSplatUrl,
        gaussianSplatSettings: clip.source?.gaussianSplatSettings || { ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS },
      },
      isLoading: false,
    });

    prewarmGaussianSplatRuntime({
      cacheKey: clip.mediaFileId || clip.source?.mediaFileId || clip.id,
      file: clip.file,
      url: gaussianSplatUrl,
      fileName: clip.file.name,
      requestedMaxSplats: clip.source?.gaussianSplatSettings?.render.maxSplats ?? 0,
    });
  } catch (err) {
    console.error('[GaussianSplat] loadGaussianSplatMedia failed:', err);
    updateClip(clip.id, { isLoading: false });
  }
}
