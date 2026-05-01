// 3D Model clip addition — OBJ, glTF, GLB
// Creates a timeline clip with is3D=true that renders via the shared 3D scene

import type { ModelSequenceData, TimelineClip } from '../../../types';
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
  mediaFileId?: string;
  modelSequence?: ModelSequenceData;
  modelUrl?: string;
  modelFileName?: string;
}

/**
 * Create placeholder model clip immediately.
 * Auto-sets is3D=true so it renders via the shared 3D scene.
 */
export function createModelClipPlaceholder(params: AddModelClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, modelSequence, modelUrl, modelFileName } = params;
  const clipId = generateClipId('clip-3d');
  const naturalDuration = modelSequence
    ? estimatedDuration || DEFAULT_MODEL_DURATION
    : MAX_MODEL_DURATION;

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration || DEFAULT_MODEL_DURATION,
    inPoint: 0,
    outPoint: estimatedDuration || DEFAULT_MODEL_DURATION,
    source: {
      type: 'model',
      naturalDuration,
      mediaFileId: params.mediaFileId,
      threeDEffectorsEnabled: true,
      ...(modelSequence ? { modelSequence } : {}),
      ...(modelUrl ? { modelUrl } : {}),
      ...(modelFileName ? { modelFileName } : {}),
    },
    mediaFileId: params.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    is3D: true,  // Auto-enable 3D for model clips
    isLoading: false,  // No async loading needed — the scene renderer loads lazily
  };
}

export interface LoadModelMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * "Load" model media — creates a blob URL for the shared scene renderer to load later.
 * No HTMLVideoElement or HTMLImageElement needed.
 */
export function loadModelMedia(params: LoadModelMediaParams): void {
  const { clip, updateClip } = params;
  const sequenceModelUrl = clip.source?.modelSequence?.frames[0]?.modelUrl;
  const renderableFile = clip.file?.size ? clip.file : undefined;

  // Create a blob URL that the shared scene renderer can fetch
  const modelUrl = sequenceModelUrl
    ?? clip.source?.modelUrl
    ?? (renderableFile ? blobUrlManager.create(clip.id, renderableFile, 'model') : undefined);

  if (!modelUrl) {
    updateClip(clip.id, { isLoading: false });
    return;
  }

  updateClip(clip.id, {
    source: {
      ...clip.source!,
      modelUrl,
      modelFileName: clip.source?.modelFileName ?? clip.file.name,
    },
    isLoading: false,
  });
}
