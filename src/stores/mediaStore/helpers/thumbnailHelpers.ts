// Thumbnail creation and deduplication

import { THUMBNAIL_TIMEOUT } from '../constants';
import { projectFileService } from '../../../services/projectFileService';
import { Logger } from '../../../services/logger';

const log = Logger.create('Thumbnail');

const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_MAX_HEIGHT = 240;
const THUMBNAIL_QUALITY = 0.72;

/**
 * Create thumbnail for video or image.
 */
export async function createThumbnail(
  file: File,
  type: 'video' | 'image'
): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (type === 'image') {
      void createImageThumbnail(file).then(resolve);
      return;
    }

    if (type === 'video') {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';

      const timeout = setTimeout(() => {
        log.warn('Timeout:', file.name);
        URL.revokeObjectURL(url);
        resolve(undefined);
      }, THUMBNAIL_TIMEOUT);

      const cleanup = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
      };

      video.onloadedmetadata = () => {
        const targetTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, video.duration * 0.1)
          : 0;
        try {
          video.currentTime = targetTime;
        } catch {
          cleanup();
          resolve(undefined);
        }
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        const size = getThumbnailCanvasSize(video.videoWidth || 16, video.videoHeight || 9);
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvasToThumbnailDataUrl(canvas));
        } else {
          resolve(undefined);
        }
        cleanup();
      };

      video.onerror = () => {
        cleanup();
        resolve(undefined);
      };

      video.load();
    } else {
      resolve(undefined);
    }
  });
}

async function createImageThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    const timeout = setTimeout(() => {
      log.warn('Image thumbnail timeout:', file.name);
      cleanup();
      resolve(undefined);
    }, THUMBNAIL_TIMEOUT);

    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        cleanup();
        resolve(undefined);
        return;
      }

      const size = getThumbnailCanvasSize(width, height);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        cleanup();
        resolve(undefined);
        return;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvasToThumbnailDataUrl(canvas);
      cleanup();
      resolve(thumbnail);
    };

    image.onerror = () => {
      cleanup();
      resolve(undefined);
    };

    image.decoding = 'async';
    image.src = url;
  });
}

function getThumbnailCanvasSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: THUMBNAIL_MAX_WIDTH, height: Math.round(THUMBNAIL_MAX_WIDTH * 9 / 16) };
  }

  const scale = Math.min(
    THUMBNAIL_MAX_WIDTH / sourceWidth,
    THUMBNAIL_MAX_HEIGHT / sourceHeight,
    1,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function canvasToThumbnailDataUrl(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', THUMBNAIL_QUALITY);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }
  return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
}

/**
 * Handle thumbnail deduplication - check for existing, save new.
 * UNIFIED: Replaces 3 duplicate blocks in original code.
 */
export async function handleThumbnailDedup(
  fileHash: string | undefined,
  thumbnailUrl: string | undefined
): Promise<string | undefined> {
  if (!fileHash || !projectFileService.isProjectOpen()) {
    return thumbnailUrl;
  }

  try {
    // Check for existing thumbnail
    const existingBlob = await projectFileService.getThumbnail(fileHash);
    if (existingBlob && existingBlob.size > 0) {
      log.debug('Reusing existing for hash:', fileHash.slice(0, 8));
      return URL.createObjectURL(existingBlob);
    }

    // Save new thumbnail
    if (thumbnailUrl) {
      const blob = await fetchThumbnailBlob(thumbnailUrl);
      if (blob && blob.size > 0) {
        await projectFileService.saveThumbnail(fileHash, blob);
        log.debug('Saved to project folder:', fileHash.slice(0, 8));
      }
    }
  } catch (e) {
    log.warn('Dedup error:', e);
  }

  return thumbnailUrl;
}

/**
 * Fetch thumbnail blob from data URL or blob URL.
 */
async function fetchThumbnailBlob(url: string): Promise<Blob | null> {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const response = await fetch(url);
    return response.blob();
  }
  return null;
}
