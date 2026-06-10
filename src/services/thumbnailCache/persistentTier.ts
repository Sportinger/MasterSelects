import { projectDB } from '../projectDB';
import type {
  SourceThumbnailFrame,
  StoredSourceThumbnailFrame,
  ThumbnailCacheLogger,
} from './types';

export class ThumbnailPersistentTier {
  private readonly log: ThumbnailCacheLogger;

  constructor(log: ThumbnailCacheLogger) {
    this.log = log;
  }

  async loadFrames(mediaFileId: string, fileHash?: string): Promise<SourceThumbnailFrame[] | null> {
    try {
      const frames = await projectDB.getSourceThumbnails(mediaFileId);
      if (frames.length > 0) {
        return frames;
      }

      if (fileHash) {
        const hashFrames = await projectDB.getSourceThumbnailsByHash(fileHash);
        if (hashFrames.length > 0) {
          return hashFrames;
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
