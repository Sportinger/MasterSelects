// Thumbnail creation and deduplication

import { THUMBNAIL_TIMEOUT } from '../constants';
import { projectFileService } from '../../../services/projectFileService';
import { projectDB } from '../../../services/projectDB';
import { Logger } from '../../../services/logger';

const log = Logger.create('Thumbnail');

const THUMBNAIL_MAX_WIDTH = 256;
const THUMBNAIL_MAX_HEIGHT = 192;
const THUMBNAIL_QUALITY = 0.68;
const isBlobUrl = (value?: string): value is string => typeof value === 'string' && value.startsWith('blob:');

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
        void drawThumbnailFromSource(video, video.videoWidth || 16, video.videoHeight || 9)
          .then(resolve)
          .finally(cleanup);
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
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        return await drawThumbnailFromSource(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall back to HTMLImageElement decoding for formats createImageBitmap cannot decode.
    }
  }

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

      void drawThumbnailFromSource(image, width, height)
        .then(resolve)
        .finally(cleanup);
    };

    image.onerror = () => {
      cleanup();
      resolve(undefined);
    };

    image.decoding = 'async';
    image.src = url;
  });
}

async function drawThumbnailFromSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<string | undefined> {
  const size = getThumbnailCanvasSize(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) return undefined;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToThumbnailUrl(canvas);
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

async function canvasToThumbnailUrl(canvas: HTMLCanvasElement): Promise<string> {
  const webp = await canvasToBlob(canvas, 'image/webp', THUMBNAIL_QUALITY);
  if (webp?.type === 'image/webp' && webp.size > 0) {
    return URL.createObjectURL(webp);
  }

  const jpeg = await canvasToBlob(canvas, 'image/jpeg', THUMBNAIL_QUALITY);
  if (jpeg && jpeg.size > 0) {
    return URL.createObjectURL(jpeg);
  }

  return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * Handle thumbnail deduplication - check for existing, save new.
 * UNIFIED: Replaces 3 duplicate blocks in original code.
 */
export async function handleThumbnailDedup(
  fileHash: string | undefined,
  thumbnailUrl: string | undefined
): Promise<string | undefined> {
  if (!fileHash) {
    return thumbnailUrl;
  }

  try {
    let existingBlob: Blob | null = null;

    if (projectFileService.isProjectOpen()) {
      existingBlob = await projectFileService.getThumbnail(fileHash);
    }

    if (!existingBlob || existingBlob.size <= 0) {
      const storedThumbnail = await projectDB.getThumbnail(fileHash);
      existingBlob = storedThumbnail?.blob ?? null;
    }

    if (existingBlob && existingBlob.size > 0) {
      log.debug('Reusing existing for hash:', fileHash.slice(0, 8));
      if (isBlobUrl(thumbnailUrl)) {
        URL.revokeObjectURL(thumbnailUrl);
      }
      if (projectFileService.isProjectOpen()) {
        void projectFileService.saveThumbnail(fileHash, existingBlob);
      }
      return URL.createObjectURL(existingBlob);
    }

    // Save new thumbnail
    if (thumbnailUrl) {
      const blob = await fetchThumbnailBlob(thumbnailUrl);
      if (blob && blob.size > 0) {
        await projectDB.saveThumbnail({
          fileHash,
          blob,
          createdAt: Date.now(),
        });
        if (projectFileService.isProjectOpen()) {
          await projectFileService.saveThumbnail(fileHash, blob);
        }
        log.debug('Saved thumbnail cache:', fileHash.slice(0, 8));
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
