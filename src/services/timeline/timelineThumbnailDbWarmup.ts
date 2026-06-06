import { thumbnailCacheService } from '../thumbnailCacheService';
import {
  createThumbnailDbLoadCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';

export interface TimelineThumbnailDbWarmupClip {
  startTime: number;
  duration: number;
  mediaFileId?: string;
  source?: {
    type?: string | null;
    mediaFileId?: string;
  } | null;
}

export interface VisibleTimelineThumbnailRef {
  mediaFileId: string;
  fileHash?: string;
}

export interface TimelineThumbnailDbWarmupDeps {
  loadCachedForSource: (mediaFileId: string, fileHash?: string) => Promise<boolean>;
}

export interface TimelineThumbnailDbWarmupOptions {
  delayMs?: number;
  signal?: AbortSignal;
  deps?: TimelineThumbnailDbWarmupDeps;
}

const DEFAULT_VISIBLE_THUMBNAIL_WARMUP_DELAY_MS = 50;
const inFlightThumbnailDbLoads = new Map<string, Promise<boolean>>();

export function getTimelineThumbnailSourceId(
  clip: TimelineThumbnailDbWarmupClip,
): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source.mediaFileId ?? clip.mediaFileId ?? null;
}

export function collectVisibleTimelineThumbnailRefs(input: {
  clips: readonly TimelineThumbnailDbWarmupClip[];
  scrollX: number;
  viewportWidth: number;
  overscanPx: number;
  timeToPixel: (time: number) => number;
  mediaFileHashById?: ReadonlyMap<string, string | undefined>;
}): VisibleTimelineThumbnailRef[] {
  const visibleLeft = input.scrollX - input.overscanPx;
  const visibleRight = input.scrollX + input.viewportWidth + input.overscanPx;
  const refs = new Map<string, VisibleTimelineThumbnailRef>();

  for (const clip of input.clips) {
    const mediaFileId = getTimelineThumbnailSourceId(clip);
    if (!mediaFileId) continue;

    const x = input.timeToPixel(clip.startTime);
    const w = input.timeToPixel(clip.duration);
    if (x + w < visibleLeft || x > visibleRight) continue;

    const ref = {
      mediaFileId,
      fileHash: input.mediaFileHashById?.get(mediaFileId),
    };
    refs.set(getThumbnailLoadKey(ref), ref);
  }

  return Array.from(refs.values());
}

function normalizeVisibleThumbnailRefs(
  refs: readonly VisibleTimelineThumbnailRef[],
): VisibleTimelineThumbnailRef[] {
  const unique = new Map<string, VisibleTimelineThumbnailRef>();

  for (const ref of refs) {
    if (!ref.mediaFileId) continue;
    const key = getThumbnailLoadKey(ref);
    if (!unique.has(key)) {
      unique.set(key, {
        mediaFileId: ref.mediaFileId,
        fileHash: ref.fileHash,
      });
    }
  }

  return Array.from(unique.values());
}

function getThumbnailLoadKey(ref: VisibleTimelineThumbnailRef): string {
  return formatTimelineCacheCoalescingKey(
    createThumbnailDbLoadCoalescingKey(ref.mediaFileId, ref.fileHash),
  );
}

export async function warmVisibleTimelineThumbnailDbCache(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: TimelineThumbnailDbWarmupOptions = {},
): Promise<boolean[]> {
  const deps = options.deps ?? thumbnailCacheService;
  const results: boolean[] = [];

  for (const ref of normalizeVisibleThumbnailRefs(refs)) {
    if (options.signal?.aborted) break;

    const key = getThumbnailLoadKey(ref);
    let loadPromise = inFlightThumbnailDbLoads.get(key);
    if (!loadPromise) {
      loadPromise = deps.loadCachedForSource(ref.mediaFileId, ref.fileHash)
        .finally(() => {
          inFlightThumbnailDbLoads.delete(key);
        });
      inFlightThumbnailDbLoads.set(key, loadPromise);
    }

    results.push(await loadPromise);
  }

  return results;
}

export function scheduleVisibleTimelineThumbnailDbWarmup(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: TimelineThumbnailDbWarmupOptions = {},
): () => void {
  if (refs.length === 0 || options.signal?.aborted) {
    return () => {};
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  const timer = window.setTimeout(() => {
    void warmVisibleTimelineThumbnailDbCache(refs, {
      ...options,
      signal: controller.signal,
    });
  }, options.delayMs ?? DEFAULT_VISIBLE_THUMBNAIL_WARMUP_DELAY_MS);

  return () => {
    controller.abort();
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  };
}
