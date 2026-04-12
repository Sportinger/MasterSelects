// Gaussian Avatar clip addition — PLY/splat avatar files
// Creates a timeline clip with is3D=true that renders via GaussianSplatSceneRenderer

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';

const DEFAULT_AVATAR_DURATION = 30; // seconds — avatars are typically used longer
const MAX_AVATAR_DURATION = 3600; // 1 hour

export interface AddGaussianAvatarClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
}

/**
 * Create placeholder gaussian avatar clip immediately.
 * Auto-sets is3D=true so it renders via the 3D pipeline.
 */
export function createGaussianAvatarClipPlaceholder(params: AddGaussianAvatarClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration } = params;
  const clipId = generateClipId('clip-gsplat');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration || DEFAULT_AVATAR_DURATION,
    inPoint: 0,
    outPoint: estimatedDuration || DEFAULT_AVATAR_DURATION,
    source: {
      type: 'gaussian-avatar',
      naturalDuration: MAX_AVATAR_DURATION,
      mediaFileId: params.mediaFileId,
      gaussianBlendshapes: {},
    },
    mediaFileId: params.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    is3D: true,  // Auto-enable 3D for gaussian avatar clips
    isLoading: true,  // Avatar takes time to load
  };
}

export interface LoadGaussianAvatarMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * "Load" gaussian avatar media — creates blob URL for the renderer to load later.
 * No HTMLVideoElement or HTMLImageElement needed.
 */
export function loadGaussianAvatarMedia(params: LoadGaussianAvatarMediaParams): void {
  const { clip, updateClip } = params;

  if (!clip.file) {
    console.error('[GaussianAvatar] loadGaussianAvatarMedia: clip.file is missing — cannot create blob URL', clip.id);
    updateClip(clip.id, { isLoading: false });
    return;
  }

  try {
    // Create a blob URL that the gaussian splat renderer can fetch
    const gaussianAvatarUrl = blobUrlManager.create(clip.id, clip.file, 'model');

    updateClip(clip.id, {
      source: {
        ...clip.source!,
        gaussianAvatarUrl,
        gaussianBlendshapes: {},
      },
      isLoading: false,
    });
  } catch (err) {
    console.error('[GaussianAvatar] loadGaussianAvatarMedia failed:', err);
    updateClip(clip.id, { isLoading: false });
  }
}
