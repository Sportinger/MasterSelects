import { projectDB } from '../projectDB';
import type {
  SourceThumbnailFrame,
  StoredSourceThumbnailFrame,
  ThumbnailCacheLogger,
} from './types';
import { SOURCE_THUMBNAIL_GENERATION_VERSION } from './types';

export class ThumbnailPersistentTier {
  private readonly log: ThumbnailCacheLogger;

  constructor(log: ThumbnailCacheLogger) {
    this.log = log;
  }

  async loadFrames(mediaFileId: string, fileHash?: string): Promise<SourceThumbnailFrame[] | null> {
    try {
      const frames = await projectDB.getSourceThumbnails(mediaFileId);
      const currentFrames = frames.filter(
        (frame) => frame.generationVersion === SOURCE_THUMBNAIL_GENERATION_VERSION,
      );
      if (currentFrames.length > 0) {
        return currentFrames;
      }

      if (fileHash) {
        const hashFrames = await projectDB.getSourceThumbnailsByHash(fileHash);
        const currentHashFrames = hashFrames.filter(
          (frame) => frame.generationVersion === SOURCE_THUMBNAIL_GENERATION_VERSION,
        );
        if (currentHashFrames.length > 0) {
          return currentHashFrames;
        }
      }
    } catch (error) {
      this.log.debug('IndexedDB load failed, will regenerate', { mediaFileId, error });
    }
    return null;
  }

  async saveSourceThumbnailsBatch(frames: StoredSourceThumbnailFrame[]): Promise<void> {
    await projectDB.saveSourceThumbnailsBatch(frames);
  }

  async deleteSource(mediaFileId: string): Promise<void> {
    await projectDB.deleteSourceThumbnails(mediaFileId);
  }

  async clearAll(): Promise<void> {
    await projectDB.clearAllSourceThumbnails();
  }
}
