// Thumbnail creation and deduplication

import { THUMBNAIL_TIMEOUT } from '../constants';
import { projectFileService } from '../../../services/projectFileService';
import { WebCodecsPlayer } from '../../../engine/WebCodecsPlayer';
import { Logger } from '../../../services/logger';

const log = Logger.create('Thumbnail');

/**
 * Create thumbnail for video or image.
 */
export async function createThumbnail(
  file: File,
  type: 'video' | 'image'
): Promise<string | undefined> {
  if (type === 'image') {
    return URL.createObjectURL(file);
  }

  if (type === 'video') {
    try {
      const player = new WebCodecsPlayer({ loop: false });
      const buffer = await file.arrayBuffer();

      // Race with timeout
      const loadPromise = player.loadArrayBuffer(buffer);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), THUMBNAIL_TIMEOUT)
      );
      await Promise.race([loadPromise, timeoutPromise]);

      // Seek to 10% of duration (or 1s, whichever is smaller)
      const seekTime = Math.min(1, player.duration * 0.1);
      await player.seekAsync(seekTime);

      const frame = player.getCurrentFrame();
      if (!frame) {
        player.destroy();
        return undefined;
      }

      // Draw VideoFrame to canvas
      const bitmap = await createImageBitmap(frame);
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      let result: string | undefined;
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        result = canvas.toDataURL('image/jpeg', 0.7);
      }
      bitmap.close();
      player.destroy();
      return result;
    } catch (e) {
      log.warn('Thumbnail generation failed', { file: file.name, error: e });
      return undefined;
    }
  }

  return undefined;
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
