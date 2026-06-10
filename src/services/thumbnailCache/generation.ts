import { BATCH_SIZE, THUMB_HEIGHT, THUMB_QUALITY, THUMB_WIDTH } from './constants';
import { ThumbnailMemoryTier } from './memoryTier';
import { ThumbnailPersistentTier } from './persistentTier';
import {
  canRetainThumbnailGenerationCanvas,
  getThumbnailGenerationCanvasResourceId,
  releaseThumbnailRuntimeResource,
  reportThumbnailGenerationCanvas,
} from '../timeline/thumbnailRuntimeReporting';
import type {
  StoredSourceThumbnailFrame,
  ThumbnailCacheLogger,
  ThumbnailCacheNotify,
} from './types';

export interface ThumbnailGeneratorOptions {
  memory: ThumbnailMemoryTier;
  persistent: ThumbnailPersistentTier;
  log: ThumbnailCacheLogger;
  notify: ThumbnailCacheNotify;
  setLastGenerationError: (mediaFileId: string, error: string) => void;
}

export class ThumbnailGenerator {
  private readonly options: ThumbnailGeneratorOptions;

  constructor(options: ThumbnailGeneratorOptions) {
    this.options = options;
  }

  async generateThumbnails(
    mediaFileId: string,
    video: HTMLVideoElement,
    duration: number,
    fileHash: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.addEventListener('canplay', () => resolve(), { once: true });
        setTimeout(resolve, 3000);
      });
    }

    const canvasAdmission = canRetainThumbnailGenerationCanvas(mediaFileId);
    if (!canvasAdmission.admitted) {
      this.options.log.debug('Thumbnail generation canvas skipped by runtime admission', {
        mediaFileId,
        reason: canvasAdmission.reason,
        rejectedUnits: canvasAdmission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    reportThumbnailGenerationCanvas(mediaFileId);

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas 2d context');
      }

      const totalThumbs = Math.ceil(duration);
      const sourceCache = this.options.memory.createSourceCache(mediaFileId);
      const captureErrors: string[] = [];
      let batch: StoredSourceThumbnailFrame[] = [];

      for (let s = 0; s < totalThumbs; s++) {
        if (signal.aborted) return false;

        const seekTime = Math.min(s, duration - 0.01);

        try {
          await this.seekVideoSafe(video, seekTime);
          ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
              'image/jpeg',
              THUMB_QUALITY,
            );
          });

          this.options.memory.setGeneratedFrame(mediaFileId, sourceCache, s, blob);
          this.options.notify(mediaFileId, 'generating', {
            type: 'frame-ready',
            secondIndex: s,
            secondIndices: [s],
            count: 1,
          });

          batch.push({
            id: `${mediaFileId}_${s.toString().padStart(6, '0')}`,
            mediaFileId,
            fileHash,
            secondIndex: s,
            blob,
          });

          if (batch.length >= BATCH_SIZE) {
            await this.options.persistent.saveSourceThumbnailsBatch(batch);
            batch = [];
          }
        } catch (error) {
          if (captureErrors.length < 5) {
            captureErrors.push(`second ${s}: ${error instanceof Error ? error.message : String(error)}`);
          }
          this.options.log.debug('Thumbnail capture failed at second', { secondIndex: s, error });
        }
      }

      if (sourceCache.size === 0) {
        const errorMessage = captureErrors.length > 0
          ? `No thumbnail frames captured (${captureErrors.join('; ')})`
          : 'No thumbnail frames captured';
        this.options.setLastGenerationError(mediaFileId, errorMessage);
        this.options.log.warn('Thumbnail generation produced no frames', {
          mediaFileId,
          duration,
          errors: captureErrors,
          readyState: video.readyState,
          currentTime: video.currentTime,
          videoDuration: video.duration,
        });
        return false;
      }

      if (batch.length > 0) {
        await this.options.persistent.saveSourceThumbnailsBatch(batch);
      }

      try {
        video.currentTime = 0;
      } catch {
        // Ignore seek reset failures.
      }
      return true;
    } finally {
      releaseThumbnailRuntimeResource(getThumbnailGenerationCanvasResourceId(mediaFileId));
    }
  }

  private seekVideoSafe(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let settleFallbackId: number | null = null;
      const targetTime = Math.max(0, time);

      const cleanup = () => {
        if (settleFallbackId !== null) {
          clearTimeout(settleFallbackId);
          settleFallbackId = null;
        }
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const isReadyAtTarget = () => (
        video.readyState >= 2 &&
        Number.isFinite(video.currentTime) &&
        Math.abs(video.currentTime - targetTime) <= 0.04
      );

      const timeout = setTimeout(() => {
        if (isReadyAtTarget()) {
          resolveOnce();
          return;
        }
        rejectOnce(new Error('Seek timeout'));
      }, 3000);

      const onSeeked = () => {
        resolveOnce();
      };

      video.addEventListener('seeked', onSeeked);

      try {
        video.currentTime = targetTime;
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error('Seek failed'));
        return;
      }

      if (isReadyAtTarget()) {
        settleFallbackId = window.setTimeout(resolveOnce, 0);
      }
    });
  }
}
