// React hook for accessing source-based thumbnail cache
// Clips use this instead of clip.thumbnails for filmstrip display

import { useState, useEffect, useMemo } from 'react';
import { thumbnailCacheService } from '../services/thumbnailCacheService';

/**
 * Hook to get thumbnails for a clip's visible range from the source cache.
 * Returns array of blob URLs (or null for not-yet-loaded thumbs).
 */
export function useThumbnailCache(
  mediaFileId: string | undefined,
  inPoint: number,
  outPoint: number,
  visibleCount: number,
  reversed?: boolean
): (string | null)[] {
  const [cacheVersion, setCacheVersion] = useState(0);

  // Subscribe to thumbnail cache status changes
  useEffect(() => {
    if (!mediaFileId) return;

    const unsubscribe = thumbnailCacheService.subscribe((changedId) => {
      if (changedId === mediaFileId) {
        setCacheVersion(n => n + 1);
      }
    });

    return unsubscribe;
  }, [mediaFileId]);

  // Compute thumbnails for the requested range
  return useMemo(() => {
    void cacheVersion;
    if (!mediaFileId || visibleCount <= 0) {
      return [];
    }
    return thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      inPoint,
      outPoint,
      visibleCount,
      reversed
    );
  }, [cacheVersion, mediaFileId, inPoint, outPoint, visibleCount, reversed]);
}
