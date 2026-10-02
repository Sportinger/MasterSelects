import { getRenderableImageBlob, isRawImageFile } from '../../../services/rawImage/rawImageDecode';
// Image clip addition - extracted from addClip
// Handles image file loading and thumbnail generation

import type { TimelineClip } from '../../../types/timeline';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { startTimelineImageHydration } from '../../../services/timeline/imageRuntimeHydrator';
import { generateImageThumbnail } from '../helpers/thumbnailHelpers';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';

export interface AddImageClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
}

/**
 * Create placeholder image clip immediately.
 * Returns clip ready to be added to state while media loads in background.
 */
export function createImageClipPlaceholder(params: AddImageClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, mediaFileId } = params;
  const clipId = generateClipId('clip-img');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'image', naturalDuration: estimatedDuration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export interface LoadImageMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  isCurrent?: () => boolean;
}

/**
 * Load image media in background - handles loading and thumbnail generation.
 */
export async function loadImageMedia(params: LoadImageMediaParams): Promise<void> {
  const { clip, updateClip } = params;
  const isCurrent = params.isCurrent ?? (() => true);
  if (!isCurrent()) return;
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;

  const imageBlob = isRawImageFile(clip.file) ? await getRenderableImageBlob(clip.file) : clip.file;
  if (!isCurrent()) return;
  const imageUrl = blobUrlManager.create(clip.id, imageBlob, 'image');
  const img = await new Promise<HTMLImageElement>((resolve) => {
    startTimelineImageHydration({
      url: imageUrl,
      onReady: resolve,
      onError: (_event, image) => resolve(image),
    });
  });

  if (!isCurrent()) { URL.revokeObjectURL(imageUrl); img.removeAttribute('src'); return; }

  // Generate thumbnail
  const thumbnail = generateImageThumbnail(img);
  const thumbnails = thumbnail ? [thumbnail] : [];

  updateClip(clip.id, {
    source: { type: 'image', imageUrl, naturalDuration: clip.duration, mediaFileId },
    thumbnails,
    isLoading: false,
  });

  // Sync to media store
  if (!isCurrent()) return;
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(clip.file.name)) {
    mediaStore.importFile(clip.file);
  }
}
