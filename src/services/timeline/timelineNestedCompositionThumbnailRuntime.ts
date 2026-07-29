import type { TimelineClip } from '../../types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { seekVideo } from '../../engine/export/VideoSeeker';
import { Logger } from '../logger';
import { thumbnailCacheService } from '../thumbnailCacheService';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';

const log = Logger.create('TimelineNestedCompositionThumbnailRuntime');

export interface TimelineNestedSegmentThumbnailParams {
  clip: TimelineClip | undefined;
  clipId: string;
  clipDuration: number;
  inPoint: number;
  maxCount: number;
}

export interface TimelineVideoThumbnailOptions {
  maxCount?: number;
  width?: number;
  height?: number;
  quality?: number;
  intervalSeconds?: number;
  offset?: number;
}

function createCanvasThumbnail(
  source: CanvasImageSource,
  options: { width?: number; height?: number; quality?: number } = {},
): string | null {
  const {
    width = 160,
    height = 90,
    quality = 0.7,
  } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function generateTimelineVideoThumbnails(
  video: HTMLVideoElement,
  duration: number,
  options: TimelineVideoThumbnailOptions = {},
): Promise<string[]> {
  const {
    maxCount = 10,
    width,
    height = 40,
    quality = 0.6,
    intervalSeconds = 30,
    offset = 0,
  } = options;

  const thumbnails: string[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    log.warn('Could not get canvas context');
    return thumbnails;
  }

  const aspectRatio = video.videoWidth > 0 && video.videoHeight > 0
    ? video.videoWidth / video.videoHeight
    : 16 / 9;
  const thumbHeight = height;
  const thumbWidth = width || Math.round(aspectRatio * thumbHeight);
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;

  const thumbCount = Math.max(1, Math.min(maxCount, Math.ceil(duration / intervalSeconds)));
  for (let i = 0; i < thumbCount; i++) {
    const relativeTime = thumbCount > 1 ? (i / (thumbCount - 1)) * duration : 0;
    const absoluteTime = offset + relativeTime;
    const videoDuration = Number.isFinite(video.duration) ? video.duration : absoluteTime;
    const clampedTime = Math.min(absoluteTime, videoDuration - 0.01);
    try {
      await seekVideo(video, clampedTime);
      ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
      thumbnails.push(canvas.toDataURL('image/jpeg', quality));
    } catch (e) {
      log.warn('Thumbnail failed at time', { time: clampedTime, error: e });
    }
  }

  return thumbnails;
}

export async function generateTimelineNestedClipSegmentThumbnails(
  params: TimelineNestedSegmentThumbnailParams,
): Promise<string[]> {
  const source = params.clip?.source;
  const mediaFileId = source?.mediaFileId ?? params.clip?.mediaFileId;
  if (mediaFileId) {
    const cached = thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      params.inPoint,
      params.inPoint + params.clipDuration,
      params.maxCount,
      params.clip?.reversed,
    ).filter((thumbnail): thumbnail is string => Boolean(thumbnail));
    if (cached.length > 0) {
      return cached;
    }
  }

  if (params.clip?.thumbnails?.length) {
    return params.clip.thumbnails;
  }

  if (!source) {
    return [];
  }

  if (source.videoElement) {
    // Never seek the preview element while building timeline decorations.
    // Visible-thumbnail warmup uses an isolated video and updates the cache.
    return [];
  }

  if (source.imageElement) {
    try {
      const thumbnail = createCanvasThumbnail(source.imageElement);
      return thumbnail ? [thumbnail] : [];
    } catch (e) {
      log.warn('Failed to generate image segment thumbnail', { clipId: params.clipId, error: e });
      return [];
    }
  }

  if (source.textCanvas) {
    if (isVectorAnimationSourceType(source.type) && params.clip) {
      vectorAnimationRuntimeManager.renderClipAtTime(params.clip, params.clip.startTime);
    }

    try {
      const thumbnail = createCanvasThumbnail(source.textCanvas);
      return thumbnail ? [thumbnail] : [];
    } catch (e) {
      log.warn('Failed to generate canvas segment thumbnail', { clipId: params.clipId, error: e });
      return [];
    }
  }

  return [];
}

export function getTimelineNestedCompositionFallbackVideo(
  clip: Pick<TimelineClip, 'source'> | null | undefined,
): HTMLVideoElement | null {
  return clip?.source?.videoElement ?? null;
}

export async function generateTimelineNestedCompositionFallbackVideoThumbnails(
  clip: Pick<TimelineClip, 'source'> | null | undefined,
  compDuration: number,
): Promise<string[] | null> {
  const video = getTimelineNestedCompositionFallbackVideo(clip);
  if (!video || video.readyState < 2) {
    return null;
  }

  return generateTimelineVideoThumbnails(video, compDuration);
}
