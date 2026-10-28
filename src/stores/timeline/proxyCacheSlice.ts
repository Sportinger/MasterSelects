// Proxy cache and invalidation actions slice

import type { ProxyCacheActions, SliceCreator, TimelineStore } from './types';
import { Logger } from '../../services/logger';
import { renderHostPort } from '../../services/render/renderHostPort';
import { layerBuilder } from '../../services/layerBuilder';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import { videoBakeProxyCache } from '../../services/videoBakeProxyCache';
import { useMediaStore } from '../mediaStore';
import { resetVolatileVideoBakeRegionStatuses } from './videoBakeSlice';
import {
  collectTimelineProxyWarmupVideos,
  getTimelineClipScrubCacheVideoSrc,
} from '../../services/timeline/timelineProxyCacheRuntime';

const log = Logger.create('ProxyCacheSlice');

interface TimelineCacheRange {
  start: number;
  end: number;
}

function normalizeTimelineCacheRanges(ranges: unknown): TimelineCacheRange[] {
  if (!Array.isArray(ranges)) {
    return [];
  }

  return ranges.filter((range): range is TimelineCacheRange => {
    if (!range || typeof range !== 'object') {
      return false;
    }

    const { start, end } = range as Partial<TimelineCacheRange>;
    return typeof start === 'number'
      && typeof end === 'number'
      && Number.isFinite(start)
      && Number.isFinite(end)
      && end > start;
  });
}

export const createProxyCacheSlice: SliceCreator<ProxyCacheActions> = (set, get) => ({
  // Get proxy frame cached ranges (for yellow timeline indicator)
  // Returns ranges in timeline time coordinates
  getProxyCachedRanges: () => {
    const { clips } = get();
    const mediaFiles = useMediaStore.getState().files;
    const allRanges: Array<{ start: number; end: number }> = [];

    // Process all video clips with proxy enabled
    for (const clip of clips) {
      // Check if clip has video source and mediaFileId
      if (clip.source?.type !== 'video') continue;

      // Try to get mediaFileId from clip or from source
      const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
      if (!mediaFileId) continue;

      const mediaFile = mediaFiles.find(f => f.id === mediaFileId);
      if (!mediaFile?.proxyFps || mediaFile.proxyStatus !== 'ready') continue;

      // Get cached ranges for this media file (in media time)
      const mediaCachedRanges = normalizeTimelineCacheRanges(
        proxyFrameCache.getCachedRanges(mediaFileId, mediaFile.proxyFps),
      );

      // Convert media time ranges to timeline time ranges
      const playbackRate = clip.speed || 1;
      for (const range of mediaCachedRanges) {
        // Media time is relative to inPoint
        const mediaStart = range.start;
        const mediaEnd = range.end;

        // Only include ranges that overlap with the visible clip portion
        const clipMediaStart = clip.inPoint;
        const clipMediaEnd = clip.inPoint + clip.duration * playbackRate;

        if (mediaEnd < clipMediaStart || mediaStart > clipMediaEnd) continue;

        // Clamp to visible portion
        const visibleMediaStart = Math.max(mediaStart, clipMediaStart);
        const visibleMediaEnd = Math.min(mediaEnd, clipMediaEnd);

        // Convert to timeline time
        const timelineStart = clip.startTime + (visibleMediaStart - clip.inPoint) / playbackRate;
        const timelineEnd = clip.startTime + (visibleMediaEnd - clip.inPoint) / playbackRate;

        allRanges.push({ start: timelineStart, end: timelineEnd });
      }

      // Also process nested clips if this is a composition
      if (clip.isComposition && clip.nestedClips) {
        for (const nestedClip of clip.nestedClips) {
          if (nestedClip.source?.type !== 'video' || !nestedClip.mediaFileId) continue;

          const nestedMediaFile = mediaFiles.find(f => f.id === nestedClip.mediaFileId);
          if (!nestedMediaFile?.proxyFps || nestedMediaFile.proxyStatus !== 'ready') continue;

          const nestedCachedRanges = normalizeTimelineCacheRanges(
            proxyFrameCache.getCachedRanges(nestedMediaFile.id, nestedMediaFile.proxyFps),
          );
          const nestedPlaybackRate = nestedClip.speed || 1;

          for (const range of nestedCachedRanges) {
            // Convert nested clip media time to parent clip timeline time
            const mediaStart = range.start;
            const mediaEnd = range.end;

            const nestedMediaStart = nestedClip.inPoint;
            const nestedMediaEnd = nestedClip.inPoint + nestedClip.duration * nestedPlaybackRate;

            if (mediaEnd < nestedMediaStart || mediaStart > nestedMediaEnd) continue;

            const visibleMediaStart = Math.max(mediaStart, nestedMediaStart);
            const visibleMediaEnd = Math.min(mediaEnd, nestedMediaEnd);

            // First convert to nested clip's local time
            const nestedLocalStart = nestedClip.startTime + (visibleMediaStart - nestedClip.inPoint) / nestedPlaybackRate;
            const nestedLocalEnd = nestedClip.startTime + (visibleMediaEnd - nestedClip.inPoint) / nestedPlaybackRate;

            // Then convert to parent timeline time (accounting for composition's inPoint)
            const compInPoint = clip.inPoint;
            if (nestedLocalEnd < compInPoint || nestedLocalStart > compInPoint + clip.duration) continue;

            const visibleNestedStart = Math.max(nestedLocalStart, compInPoint);
            const visibleNestedEnd = Math.min(nestedLocalEnd, compInPoint + clip.duration);

            const timelineStart = clip.startTime + (visibleNestedStart - compInPoint);
            const timelineEnd = clip.startTime + (visibleNestedEnd - compInPoint);

            allRanges.push({ start: timelineStart, end: timelineEnd });
          }
        }
      }
    }

    // Merge overlapping ranges
    if (allRanges.length === 0) return [];

    allRanges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [allRanges[0]];

    for (let i = 1; i < allRanges.length; i++) {
      const last = merged[merged.length - 1];
      const current = allRanges[i];

      if (current.start <= last.end + 0.05) { // Allow 50ms gap
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  },

  // Get non-proxy HTMLVideo scrub-cache ranges (for the yellow timeline indicator).
  // Returns ranges in timeline time coordinates.
  getScrubCachedRanges: () => {
    const { clips } = get();
    const allRanges: Array<{ start: number; end: number }> = [];

    const addClipRanges = (
      clip: typeof clips[number],
      addTimelineRange: (start: number, end: number) => void
    ) => {
      const videoSrc = getTimelineClipScrubCacheVideoSrc(clip);
      if (!videoSrc) return;

      const mediaCachedRanges = normalizeTimelineCacheRanges(
        renderHostPort.getScrubbingCachedRanges(videoSrc),
      );
      if (mediaCachedRanges.length === 0) return;

      const playbackRate = Math.max(Math.abs(clip.speed || 1), 0.001);
      const mediaStart = Math.min(clip.inPoint, clip.outPoint);
      const mediaEnd = Math.max(clip.inPoint, clip.outPoint);
      const reverse = clip.reversed || (clip.speed ?? 1) < 0;

      for (const range of mediaCachedRanges) {
        if (range.end < mediaStart || range.start > mediaEnd) continue;

        const visibleMediaStart = Math.max(range.start, mediaStart);
        const visibleMediaEnd = Math.min(range.end, mediaEnd);
        if (visibleMediaEnd <= visibleMediaStart) continue;

        const timelineStart = reverse
          ? clip.startTime + (mediaEnd - visibleMediaEnd) / playbackRate
          : clip.startTime + (visibleMediaStart - mediaStart) / playbackRate;
        const timelineEnd = reverse
          ? clip.startTime + (mediaEnd - visibleMediaStart) / playbackRate
          : clip.startTime + (visibleMediaEnd - mediaStart) / playbackRate;

        addTimelineRange(Math.min(timelineStart, timelineEnd), Math.max(timelineStart, timelineEnd));
      }
    };

    for (const clip of clips) {
      if (clip.source?.type === 'video') {
        addClipRanges(clip, (start, end) => allRanges.push({ start, end }));
      }

      if (clip.isComposition && clip.nestedClips) {
        for (const nestedClip of clip.nestedClips) {
          if (nestedClip.source?.type !== 'video') continue;

          addClipRanges(nestedClip, (nestedStart, nestedEnd) => {
            const compStart = clip.inPoint;
            const compEnd = clip.inPoint + clip.duration;
            if (nestedEnd < compStart || nestedStart > compEnd) return;

            const visibleNestedStart = Math.max(nestedStart, compStart);
            const visibleNestedEnd = Math.min(nestedEnd, compEnd);
            allRanges.push({
              start: clip.startTime + (visibleNestedStart - compStart),
              end: clip.startTime + (visibleNestedEnd - compStart),
            });
          });
        }
      }
    }

    if (allRanges.length === 0) return [];

    allRanges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [allRanges[0]];

    for (let i = 1; i < allRanges.length; i++) {
      const last = merged[merged.length - 1];
      const current = allRanges[i];

      if (current.start <= last.end + 0.05) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  },

  // Invalidate cache when content changes (clip moved, trimmed, etc.)
  // It runs after every content edit, including each drag sample: it writes only what actually changes, and
  // never mixes cache state into a content write (the repository keeps a drag sample a cheap live preview
  // only when it carries clips/keyframes alone).
  invalidateCache: () => {
    const state = get();
    // Baked video regions become stale with the content they were rendered from.
    const reset = resetVolatileVideoBakeRegionStatuses(state.clips, state.videoBakeRegions);
    const contentPatch: Partial<TimelineStore> = {
      ...(reset.clips !== state.clips ? { clips: reset.clips } : {}),
      ...(reset.videoBakeRegions !== state.videoBakeRegions ? { videoBakeRegions: reset.videoBakeRegions } : {}),
    };
    if (Object.keys(contentPatch).length) set(contentPatch);
    // Cancel any ongoing RAM preview and drop the cached frame list.
    const cachePatch: Partial<TimelineStore> = {
      ...(state.isRamPreviewing ? { isRamPreviewing: false } : {}),
      ...(state.isClipVideoBakeRendering ? { isClipVideoBakeRendering: false } : {}),
      ...(state.cachedFrameTimes.size ? { cachedFrameTimes: new Set<number>() } : {}),
      ...(state.ramPreviewRange !== null ? { ramPreviewRange: null } : {}),
      ...(state.ramPreviewProgress !== null ? { ramPreviewProgress: null } : {}),
      ...(state.clipVideoBakeProgress !== null ? { clipVideoBakeProgress: null } : {}),
    };
    if (Object.keys(cachePatch).length) set(cachePatch);
    // Immediately clear all caches and request render
    layerBuilder.invalidateCache(); // Force layer rebuild
    videoBakeProxyCache.clear();
    renderHostPort.setGeneratingRamPreview(false);
    renderHostPort.clearCompositeCache();
    renderHostPort.requestRender(); // Wake up render loop to show changes immediately
  },

  // Video warmup - seek through all videos to fill browser cache for smooth scrubbing
  startProxyCachePreload: async () => {
    const { clips, isProxyCaching } = get();

    if (isProxyCaching) return;

    const videoClips = collectTimelineProxyWarmupVideos(clips);

    if (videoClips.length === 0) {
      log.info('No video clips to warmup');
      return;
    }

    set({ isProxyCaching: true, proxyCacheProgress: 0 });
    log.info(`Starting video warmup for ${videoClips.length} clips`);

    try {
      const SEEK_INTERVAL = 0.5; // Seek every 0.5 seconds
      let totalSeeks = 0;
      let completedSeeks = 0;

      // Calculate total seeks needed
      for (const clip of videoClips) {
        totalSeeks += Math.ceil(clip.duration / SEEK_INTERVAL);
      }

      // Warmup each video
      for (const clip of videoClips) {
        const video = clip.video;
        const duration = clip.duration;
        const seekCount = Math.ceil(duration / SEEK_INTERVAL);

        for (let i = 0; i < seekCount; i++) {
          // Check if cancelled
          if (!get().isProxyCaching) {
            log.info('Video warmup cancelled');
            return;
          }

          const seekTime = Math.min(i * SEEK_INTERVAL, duration - 0.1);

          // Seek to position
          video.currentTime = seekTime;

          // Wait for seek to complete
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            };
            video.addEventListener('seeked', onSeeked);
            // Timeout fallback
            setTimeout(resolve, 200);
          });

          completedSeeks++;
          const progress = Math.round((completedSeeks / totalSeeks) * 100);
          set({ proxyCacheProgress: progress });

          // Small delay to not overwhelm the browser
          await new Promise(r => setTimeout(r, 10));
        }
      }

      log.info('Video warmup complete');
    } catch (e) {
      log.error('Video warmup failed', e);
    } finally {
      set({ isProxyCaching: false, proxyCacheProgress: null });
    }
  },

  cancelProxyCachePreload: () => {
    proxyFrameCache.cancelPreload();
    set({ isProxyCaching: false, proxyCacheProgress: null });
    log.info('Proxy cache preload cancelled');
  },
});
