// Gaussian Splat clip addition - PLY/splat/ksplat scene files
// Creates a timeline clip with is3D=true that renders via the gaussian splat pipeline

import type { GaussianSplatSequenceData, TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';
import {
  resolveGaussianSplatSettingsForSource,
} from '../../../engine/gaussian/types';
import { prewarmGaussianSplatRuntime } from '../../../engine/scene/runtime/SharedSplatRuntimeCache';

const DEFAULT_SPLAT_DURATION = 30; // seconds
const MAX_SPLAT_DURATION = 3600; // 1 hour

export interface AddGaussianSplatClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatRuntimeKey?: string;
}

/**
 * Create placeholder gaussian splat clip immediately.
 * Auto-sets is3D=true so it renders via the 3D pipeline.
 */
export function createGaussianSplatClipPlaceholder(params: AddGaussianSplatClipParams): TimelineClip {
  const {
    trackId,
    file,
    startTime,
    estimatedDuration,
    gaussianSplatSequence,
    gaussianSplatUrl,
    gaussianSplatFileName,
    gaussianSplatRuntimeKey,
  } = params;
  const clipId = generateClipId('clip-gsplat');
  const naturalDuration = gaussianSplatSequence
    ? estimatedDuration || DEFAULT_SPLAT_DURATION
    : MAX_SPLAT_DURATION;

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
      naturalDuration,
      mediaFileId: params.mediaFileId,
      threeDEffectorsEnabled: true,
      ...(gaussianSplatSequence ? { gaussianSplatSequence } : {}),
      ...(gaussianSplatUrl ? { gaussianSplatUrl } : {}),
      ...(gaussianSplatFileName ? { gaussianSplatFileName } : {}),
      ...(gaussianSplatRuntimeKey ? { gaussianSplatRuntimeKey } : {}),
      gaussianSplatSettings: resolveGaussianSplatSettingsForSource(undefined, {
        fileName: gaussianSplatFileName ?? file.name,
        sequence: gaussianSplatSequence,
      }),
    },
    mediaFileId: params.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    is3D: true,
    isLoading: true,
  };
}

export interface LoadGaussianSplatMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * "Load" gaussian splat media by attaching a URL for the renderer to fetch.
 * Restored Native projects may only have a reference URL, so an empty
 * placeholder File must not be preferred over that URL.
 */
export function loadGaussianSplatMedia(params: LoadGaussianSplatMediaParams): void {
  const { clip, updateClip } = params;

  try {
    const sequenceFrame = clip.source?.gaussianSplatSequence?.frames[0];
    const renderableFile = clip.file?.size ? clip.file : undefined;
    const gaussianSplatUrl = sequenceFrame?.splatUrl
      ?? clip.source?.gaussianSplatUrl
      ?? (renderableFile ? blobUrlManager.create(clip.id, renderableFile, 'model') : undefined);
    const gaussianSplatFileName =
      sequenceFrame?.name ??
      clip.source?.gaussianSplatFileName ??
      clip.file?.name ??
      'gaussian-splat';
    const runtimeKey =
      sequenceFrame?.projectPath ??
      sequenceFrame?.absolutePath ??
      sequenceFrame?.sourcePath ??
      sequenceFrame?.name ??
      clip.source?.gaussianSplatRuntimeKey ??
      clip.source?.gaussianSplatUrl;

    if (!gaussianSplatUrl) {
      console.error('[GaussianSplat] loadGaussianSplatMedia: no renderable file or URL', clip.id);
      updateClip(clip.id, { isLoading: false });
      return;
    }

    updateClip(clip.id, {
      source: {
        ...clip.source!,
        gaussianSplatUrl,
        gaussianSplatFileName,
        gaussianSplatRuntimeKey: runtimeKey,
        gaussianSplatSettings: resolveGaussianSplatSettingsForSource(
          clip.source?.gaussianSplatSettings,
          {
            fileName: gaussianSplatFileName,
            sequence: clip.source?.gaussianSplatSequence,
          },
        ),
      },
      isLoading: false,
    });

    prewarmGaussianSplatRuntime({
      cacheKey: runtimeKey || clip.mediaFileId || clip.source?.mediaFileId || clip.id,
      file: renderableFile,
      url: gaussianSplatUrl,
      fileName: gaussianSplatFileName,
      gaussianSplatSequence: clip.source?.gaussianSplatSequence,
      requestedMaxSplats: clip.source?.gaussianSplatSettings?.render.maxSplats ?? 0,
    });
  } catch (err) {
    console.error('[GaussianSplat] loadGaussianSplatMedia failed:', err);
    updateClip(clip.id, { isLoading: false });
  }
}
