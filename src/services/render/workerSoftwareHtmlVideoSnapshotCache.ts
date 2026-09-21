import { createWorkerSoftwareBitmapSnapshot } from './workerSoftwareBitmapSnapshot';

export interface WorkerSoftwareCachedHtmlVideoSnapshotSource {
  readonly source: ImageBitmapSource;
  readonly width: number;
  readonly height: number;
  readonly workerBitmapCacheKey?: string;
  readonly contentKey?: string;
}

interface CachedHtmlVideoSnapshot {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  readonly mediaTime?: number;
  readonly ownerId?: string;
  readonly workerBitmapCacheKey?: string;
}

const MAX_CACHED_HTML_VIDEO_SNAPSHOTS_PER_VIDEO = 16;
const cachedHtmlVideoSnapshots = new WeakMap<HTMLVideoElement, readonly CachedHtmlVideoSnapshot[]>();
const pendingHtmlVideoSnapshots = new WeakMap<HTMLVideoElement, Map<string, Promise<boolean>>>();

function getCanvas2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context && 'drawImage' in context ? context : null;
}

function quantizedMediaTimeKey(mediaTime: number | undefined): string {
  return typeof mediaTime === 'number' && Number.isFinite(mediaTime)
    ? String(Math.round(mediaTime * 30))
    : 'unknown';
}

export function workerSoftwareHtmlVideoFrameKey(
  video: HTMLVideoElement,
  mediaTime?: number,
): string {
  const mediaTimeKey = quantizedMediaTimeKey(
    typeof mediaTime === 'number' && Number.isFinite(mediaTime)
      ? mediaTime
      : video.currentTime,
  );
  const quality = typeof video.getVideoPlaybackQuality === 'function'
    ? video.getVideoPlaybackQuality()
    : null;
  const totalVideoFrames = quality?.totalVideoFrames;
  if (typeof totalVideoFrames === 'number' && Number.isFinite(totalVideoFrames) && totalVideoFrames > 0) {
    return `${mediaTimeKey}:vf${Math.round(totalVideoFrames)}`;
  }
  return mediaTimeKey;
}

export function workerSoftwareBitmapCacheKeyForSnapshot(input: {
  readonly ownerId?: string;
  readonly mediaTime?: number;
  readonly frameKey?: string;
  readonly width: number;
  readonly height: number;
}): string | undefined {
  if (!input.ownerId) return undefined;
  const frameKey = input.frameKey ?? (
    typeof input.mediaTime === 'number' && Number.isFinite(input.mediaTime)
      ? quantizedMediaTimeKey(input.mediaTime)
      : undefined
  );
  if (!frameKey) return undefined;
  return `html-video:${input.ownerId}:${frameKey}:${input.width}x${input.height}`;
}

function createSnapshotCanvas(width: number, height: number): {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} | null {
  const canvasWidth = Math.max(1, Math.floor(width));
  const canvasHeight = Math.max(1, Math.floor(height));
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(canvasWidth, canvasHeight)
      : null;
  if (!canvas) return null;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = getCanvas2dContext(canvas);
  return context ? { canvas, context } : null;
}

export function canCacheWorkerSoftwareHtmlVideoSnapshot(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.videoWidth > 0
    && video.videoHeight > 0;
}

function snapshotRequestKey(input: {
  readonly video: HTMLVideoElement;
  readonly mediaTime?: number;
  readonly ownerId?: string;
  readonly maxSize?: { readonly width: number; readonly height: number };
  readonly resizeQuality?: ResizeQuality;
}): string {
  const mediaTime = typeof input.mediaTime === 'number' && Number.isFinite(input.mediaTime)
    ? input.mediaTime
    : input.video.currentTime;
  const quantizedTime = typeof mediaTime === 'number' && Number.isFinite(mediaTime)
    ? Math.round(mediaTime * 30)
    : 'unknown';
  const maxSize = input.maxSize
    ? `${Math.round(input.maxSize.width)}x${Math.round(input.maxSize.height)}`
    : 'source';
  return [
    input.ownerId ?? 'unknown',
    quantizedTime,
    maxSize,
    input.resizeQuality ?? 'default',
  ].join(':');
}

function quantizedSnapshotTime(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 30)
    : null;
}

export function expectedWorkerSoftwareHtmlVideoSnapshotSize(input: {
  readonly video: HTMLVideoElement;
  readonly maxSize?: { readonly width: number; readonly height: number };
}): { readonly width: number; readonly height: number } {
  const sourceWidth = Math.max(1, Math.round(input.video.videoWidth || 1));
  const sourceHeight = Math.max(1, Math.round(input.video.videoHeight || 1));
  const maxWidth = input.maxSize?.width;
  const maxHeight = input.maxSize?.height;
  if (
    typeof maxWidth !== 'number' ||
    typeof maxHeight !== 'number' ||
    !Number.isFinite(maxWidth) ||
    !Number.isFinite(maxHeight) ||
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  if (scale >= 0.999) {
    return { width: sourceWidth, height: sourceHeight };
  }
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function hasCachedWorkerSoftwareHtmlVideoSnapshot(input: {
  readonly video: HTMLVideoElement;
  readonly mediaTime?: number;
  readonly ownerId?: string;
  readonly maxSize?: { readonly width: number; readonly height: number };
}): boolean {
  const mediaTime = typeof input.mediaTime === 'number' && Number.isFinite(input.mediaTime)
    ? input.mediaTime
    : input.video.currentTime;
  const targetTime = quantizedSnapshotTime(mediaTime);
  if (targetTime === null) return false;

  const minSize = expectedWorkerSoftwareHtmlVideoSnapshotSize(input);
  const entries = cachedHtmlVideoSnapshots.get(input.video) ?? [];
  return entries.some((entry) => {
    if (input.ownerId && entry.ownerId && entry.ownerId !== input.ownerId) {
      return false;
    }
    if (quantizedSnapshotTime(entry.mediaTime) !== targetTime) {
      return false;
    }
    return entry.width >= minSize.width && entry.height >= minSize.height;
  });
}

export function updateCachedWorkerSoftwareHtmlVideoSnapshot(input: {
  readonly video: HTMLVideoElement;
  readonly source: ImageBitmapSource;
  readonly width: number;
  readonly height: number;
  readonly mediaTime?: number;
  readonly ownerId?: string;
  readonly workerBitmapCacheKey?: string;
}): boolean {
  const existingEntries = cachedHtmlVideoSnapshots.get(input.video) ?? [];
  const workerBitmapCacheKey = input.workerBitmapCacheKey ?? workerSoftwareBitmapCacheKeyForSnapshot({
    ownerId: input.ownerId,
    mediaTime: input.mediaTime,
    width: input.width,
    height: input.height,
  });
  const existingIndex = workerBitmapCacheKey
    ? existingEntries.findIndex((entry) => entry.workerBitmapCacheKey === workerBitmapCacheKey)
    : -1;
  const existing = existingIndex >= 0 ? existingEntries[existingIndex] : undefined;
  const canReuse = existing && existing.width === input.width && existing.height === input.height;
  const target = canReuse ? {
    canvas: existing.canvas,
    context: getCanvas2dContext(existing.canvas),
  } : createSnapshotCanvas(input.width, input.height);
  if (!target?.context) return false;
  try {
    target.context.clearRect(0, 0, input.width, input.height);
    target.context.drawImage(input.source as CanvasImageSource, 0, 0, input.width, input.height);
    const nextEntry: CachedHtmlVideoSnapshot = {
      canvas: target.canvas,
      width: input.width,
      height: input.height,
      ...(typeof input.mediaTime === 'number' && Number.isFinite(input.mediaTime)
        ? { mediaTime: input.mediaTime }
        : {}),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(workerBitmapCacheKey ? { workerBitmapCacheKey } : {}),
    };
    const retainedEntries = existingEntries.filter((_, index) => index !== existingIndex);
    cachedHtmlVideoSnapshots.set(input.video, [
      nextEntry,
      ...retainedEntries,
    ].slice(0, MAX_CACHED_HTML_VIDEO_SNAPSHOTS_PER_VIDEO));
    return true;
  } catch {
    return false;
  }
}

export function getCachedWorkerSoftwareHtmlVideoSnapshotSource(
  video: HTMLVideoElement,
  ownerId?: string,
  targetMediaTime?: number,
  maxDriftSeconds?: number,
): WorkerSoftwareCachedHtmlVideoSnapshotSource | null {
  const entries = cachedHtmlVideoSnapshots.get(video) ?? [];
  const ownerMatches = (entry: CachedHtmlVideoSnapshot): boolean => (
    !ownerId || !entry.ownerId || ownerId === entry.ownerId
  );
  const candidates = entries.filter(ownerMatches);
  if (candidates.length === 0) return null;

  const exactOwnerCandidates = ownerId
    ? candidates.filter((entry) => entry.ownerId === ownerId)
    : [];
  const searchCandidates = exactOwnerCandidates.length > 0
    ? exactOwnerCandidates
    : candidates;

  let cached: CachedHtmlVideoSnapshot | undefined;
  if (
    typeof targetMediaTime === 'number' &&
    Number.isFinite(targetMediaTime) &&
    typeof maxDriftSeconds === 'number' &&
    Number.isFinite(maxDriftSeconds) &&
    maxDriftSeconds >= 0
  ) {
    cached = searchCandidates
      .filter((entry) => typeof entry.mediaTime === 'number' && Number.isFinite(entry.mediaTime))
      .map((entry) => ({ entry, drift: Math.abs((entry.mediaTime ?? targetMediaTime) - targetMediaTime) }))
      .filter(({ drift }) => drift <= maxDriftSeconds)
      .sort((a, b) => a.drift - b.drift)[0]?.entry;
  } else {
    cached = searchCandidates[0];
  }
  if (!cached) return null;
  const cachedIndex = entries.indexOf(cached);
  if (cachedIndex > 0) {
    cachedHtmlVideoSnapshots.set(video, [
      cached,
      ...entries.filter((_, index) => index !== cachedIndex),
    ]);
  }
  return {
    source: cached.canvas,
    width: cached.width,
    height: cached.height,
    workerBitmapCacheKey: cached.workerBitmapCacheKey,
    ...(cached.workerBitmapCacheKey ? { contentKey: cached.workerBitmapCacheKey } : {}),
  };
}

export async function cacheWorkerSoftwareHtmlVideoSnapshot(input: {
  readonly video: HTMLVideoElement;
  readonly mediaTime?: number;
  readonly ownerId?: string;
  readonly maxSize?: { readonly width: number; readonly height: number };
  readonly resizeQuality?: ResizeQuality;
  readonly skipIfCached?: boolean;
}): Promise<boolean> {
  if (!canCacheWorkerSoftwareHtmlVideoSnapshot(input.video)) {
    return false;
  }
  if (input.skipIfCached === true && hasCachedWorkerSoftwareHtmlVideoSnapshot(input)) {
    return false;
  }
  const key = snapshotRequestKey(input);
  let pendingForVideo = pendingHtmlVideoSnapshots.get(input.video);
  const existing = pendingForVideo?.get(key);
  if (existing) return existing;

  const snapshotPromise = (async () => {
    try {
      const snapshot = await createWorkerSoftwareBitmapSnapshot({
        source: input.video,
        sourceWidth: input.video.videoWidth,
        sourceHeight: input.video.videoHeight,
        maxSize: input.maxSize,
        resizeQuality: input.resizeQuality,
      });
      const cached = updateCachedWorkerSoftwareHtmlVideoSnapshot({
        video: input.video,
        source: snapshot.bitmap,
        width: snapshot.width,
        height: snapshot.height,
        mediaTime: input.mediaTime,
        ownerId: input.ownerId,
      });
      snapshot.bitmap.close();
      return cached;
    } catch {
      return false;
    } finally {
      const currentPending = pendingHtmlVideoSnapshots.get(input.video);
      currentPending?.delete(key);
      if (currentPending?.size === 0) {
        pendingHtmlVideoSnapshots.delete(input.video);
      }
    }
  })();

  if (!pendingForVideo) {
    pendingForVideo = new Map();
    pendingHtmlVideoSnapshots.set(input.video, pendingForVideo);
  }
  pendingForVideo.set(key, snapshotPromise);
  return snapshotPromise;
}
