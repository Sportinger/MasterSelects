import { thumbnailCacheService } from '../../../services/thumbnailCacheService';

export function restoreLoadStateSourceThumbnails(
  mediaFileId: string | undefined,
  fileHash: string | undefined,
): void {
  if (!mediaFileId) return;
  void thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
}
