// 3D Model clip addition — OBJ, glTF, GLB, FBX
// Creates a timeline clip with is3D=true that renders via Three.js

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';

const DEFAULT_MODEL_DURATION = 10; // seconds — initial display duration
const MAX_MODEL_DURATION = 3600; // 1 hour — models are static, can be any length

export interface AddModelClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
}

/**
 * Create placeholder model clip immediately.
 * Auto-sets is3D=true so it renders via Three.js.
 */
export function createModelClipPlaceholder(params: AddModelClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration } = params;
  const clipId = generateClipId('clip-3d');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration || DEFAULT_MODEL_DURATION,
    inPoint: 0,
    outPoint: estimatedDuration || DEFAULT_MODEL_DURATION,
    source: { type: 'model', naturalDuration: MAX_MODEL_DURATION },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    is3D: true,  // Auto-enable 3D for model clips
    isLoading: false,  // No async loading needed — Three.js loads lazily
  };
}

export interface LoadModelMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * "Load" model media — creates blob URL for Three.js to load later.
 * No HTMLVideoElement or HTMLImageElement needed.
 */
export function loadModelMedia(params: LoadModelMediaParams): void {
  const { clip, updateClip } = params;

  // Create a blob URL that Three.js can fetch
  const modelUrl = blobUrlManager.create(clip.id, clip.file, 'model');

  updateClip(clip.id, {
    source: {
      ...clip.source!,
      modelUrl,
    },
    isLoading: false,
  });
}
