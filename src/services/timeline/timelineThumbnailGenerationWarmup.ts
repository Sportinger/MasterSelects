import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClipDragPreview } from '../../stores/timeline/types';
import {
  thumbnailCacheService,
  type ThumbnailStatus,
} from '../thumbnailCacheService';
import {
  createThumbnailGenerationCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';
import type { VisibleTimelineThumbnailRef } from './timelineThumbnailDbWarmup';
import {
  clearTimelineWarmupTimers,
  getTimelineWarmupTimerDeps,
} from './timelineWarmupTimers';

const DEFAULT_VISIBLE_THUMBNAIL_GENERATION_DELAY_MS = 250;
const DEFAULT_MAX_CONCURRENT_THUMBNAIL_GENERATIONS = 2;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TimelineThumbnailGenerationClipRef {
  id: string;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  mediaFileId?: string;
  source?: {
    type?: string | null;
    mediaFileId?: string;
    videoElement?: HTMLVideoElement;
    naturalDuration?: number;
  } | null;
}

export interface TimelineThumbnailGenerationMediaFileRef {
  id: string;
  url?: string;
  duration?: number;
  fileHash?: string;
}

export interface TimelineThumbnailGenerationState {
  clips: readonly TimelineThumbnailGenerationClipRef[];
  mediaFiles: readonly TimelineThumbnailGenerationMediaFileRef[];
  isPlaying?: boolean;
  clipDragPreview?: TimelineClipDragPreview | null;
}

export interface TimelineThumbnailGenerationWarmupDeps {
  getState: () => TimelineThumbnailGenerationState;
  getStatus: (mediaFileId: string) => ThumbnailStatus;
  generateForSourceUrl: (
    mediaFileId: string,
    sourceUrl: string,
    duration: number,
    fileHash?: string,
    crossOrigin?: string,
  ) => Promise<void>;
  maxConcurrentGenerations?: number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export type TimelineThumbnailGenerationWarmupStatus =
  | 'generated'
  | 'ready'
  | 'generating'
  | 'blocked'
  | 'skipped';

export interface TimelineThumbnailGenerationWarmupResult {
  mediaFileId: string;
  status: TimelineThumbnailGenerationWarmupStatus;
}

interface TimelineThumbnailGenerationRequest {
  mediaFileId: string;
  fileHash?: string;
  sourceUrl: string;
  crossOrigin?: string;
  duration: number;
  requestKey: string;
}

const scheduledThumbnailGenerationTimers = new Map<string, TimerHandle>();
const inFlightThumbnailGenerations = new Map<string, Promise<TimelineThumbnailGenerationWarmupResult>>();
let activeThumbnailGenerationCount = 0;
const queuedThumbnailGenerationSlots: Array<() => void> = [];

function getDefaultDeps(): TimelineThumbnailGenerationWarmupDeps {
  return {
    getState: () => {
      const timelineState = useTimelineStore.getState();
      return {
        clips: timelineState.clips,
        mediaFiles: useMediaStore.getState().files,
        isPlaying: timelineState.isPlaying,
        clipDragPreview: timelineState.clipDragPreview,
      };
    },
    getStatus: (mediaFileId) => thumbnailCacheService.getStatus(mediaFileId),
    generateForSourceUrl: (mediaFileId, sourceUrl, duration, fileHash, crossOrigin) => (
      thumbnailCacheService.generateForSourceUrl(mediaFileId, sourceUrl, duration, fileHash, crossOrigin)
    ),
    ...getTimelineWarmupTimerDeps(),
  };
}

function getThumbnailGenerationKey(mediaFileId: string, fileHash?: string): string {
  return formatTimelineCacheCoalescingKey(
    createThumbnailGenerationCoalescingKey(mediaFileId, fileHash),
  );
}

function getClipMediaFileId(clip: TimelineThumbnailGenerationClipRef): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source.mediaFileId ?? clip.mediaFileId ?? null;
}

function getFinitePositiveDuration(...values: Array<number | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function normalizeThumbnailGenerationRefs(
  refs: readonly VisibleTimelineThumbnailRef[],
): VisibleTimelineThumbnailRef[] {
  const unique = new Map<string, VisibleTimelineThumbnailRef>();

  for (const ref of refs) {
    if (!ref.mediaFileId) continue;
    const key = getThumbnailGenerationKey(ref.mediaFileId, ref.fileHash);
    if (unique.has(key)) continue;
    unique.set(key, {
      mediaFileId: ref.mediaFileId,
      fileHash: ref.fileHash,
    });
  }

  return Array.from(unique.values());
}

function resolveThumbnailGenerationRequest(
  ref: VisibleTimelineThumbnailRef,
  state: TimelineThumbnailGenerationState,
): TimelineThumbnailGenerationRequest | null {
  const mediaFile = state.mediaFiles.find((file) => file.id === ref.mediaFileId);
  const fileHash = ref.fileHash ?? mediaFile?.fileHash;
  const clip = state.clips.find((candidate) => (
    getClipMediaFileId(candidate) === ref.mediaFileId
  ));
  const video = clip?.source?.videoElement;
  const sourceUrl = mediaFile?.url || video?.currentSrc || video?.src || '';
  if (!clip || !sourceUrl) return null;

  const duration = getFinitePositiveDuration(
    clip.source?.naturalDuration,
    video?.duration,
    mediaFile?.duration,
    clip.outPoint,
    clip.duration,
  );
  if (!duration) return null;

  return {
    mediaFileId: ref.mediaFileId,
    fileHash,
    sourceUrl,
    crossOrigin: video?.crossOrigin || 'anonymous',
    duration,
    requestKey: getThumbnailGenerationKey(ref.mediaFileId, fileHash),
  };
}

async function acquireThumbnailGenerationSlot(limit: number): Promise<void> {
  if (activeThumbnailGenerationCount < limit) {
    activeThumbnailGenerationCount += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    queuedThumbnailGenerationSlots.push(resolve);
  });
}

function releaseThumbnailGenerationSlot(): void {
  const next = queuedThumbnailGenerationSlots.shift();
  if (next) {
    next();
    return;
  }
  activeThumbnailGenerationCount = Math.max(0, activeThumbnailGenerationCount - 1);
}

async function runThumbnailGenerationRequest(
  request: TimelineThumbnailGenerationRequest,
  deps: TimelineThumbnailGenerationWarmupDeps,
): Promise<TimelineThumbnailGenerationWarmupResult> {
  await acquireThumbnailGenerationSlot(
    Math.max(1, deps.maxConcurrentGenerations ?? DEFAULT_MAX_CONCURRENT_THUMBNAIL_GENERATIONS),
  );

  try {
    const latestState = deps.getState();
    if (latestState.isPlaying || latestState.clipDragPreview) {
      return { mediaFileId: request.mediaFileId, status: 'blocked' };
    }

    await deps.generateForSourceUrl(
      request.mediaFileId,
      request.sourceUrl,
      request.duration,
      request.fileHash,
      request.crossOrigin,
    );

    return { mediaFileId: request.mediaFileId, status: 'generated' };
  } finally {
    releaseThumbnailGenerationSlot();
  }
}

export async function warmVisibleTimelineThumbnailGeneration(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: { deps?: TimelineThumbnailGenerationWarmupDeps } = {},
): Promise<TimelineThumbnailGenerationWarmupResult[]> {
  const deps = options.deps ?? getDefaultDeps();
  const state = deps.getState();
  const normalizedRefs = normalizeThumbnailGenerationRefs(refs);

  if (state.isPlaying || state.clipDragPreview) {
    return normalizedRefs.map((ref) => ({
      mediaFileId: ref.mediaFileId,
      status: 'blocked' as const,
    }));
  }

  const results: TimelineThumbnailGenerationWarmupResult[] = [];
  for (const ref of normalizedRefs) {
    const currentStatus = deps.getStatus(ref.mediaFileId);
    if (currentStatus === 'ready' || currentStatus === 'generating') {
      results.push({
        mediaFileId: ref.mediaFileId,
        status: currentStatus,
      });
      continue;
    }

    const request = resolveThumbnailGenerationRequest(ref, state);
    if (!request) {
      results.push({
        mediaFileId: ref.mediaFileId,
        status: 'skipped',
      });
      continue;
    }

    let generation = inFlightThumbnailGenerations.get(request.requestKey);
    if (!generation) {
      generation = runThumbnailGenerationRequest(request, deps)
        .finally(() => {
          inFlightThumbnailGenerations.delete(request.requestKey);
        });
      inFlightThumbnailGenerations.set(request.requestKey, generation);
    }

    results.push(await generation);
  }

  return results;
}

export function scheduleVisibleTimelineThumbnailGeneration(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: {
    deps?: TimelineThumbnailGenerationWarmupDeps;
    delayMs?: number;
  } = {},
): () => void {
  const deps = options.deps ?? getDefaultDeps();
  const scheduled: Array<{ key: string; timer: TimerHandle }> = [];

  for (const ref of normalizeThumbnailGenerationRefs(refs)) {
    const key = getThumbnailGenerationKey(ref.mediaFileId, ref.fileHash);
    if (scheduledThumbnailGenerationTimers.has(key) || inFlightThumbnailGenerations.has(key)) {
      continue;
    }

    const timer = deps.setTimeout(() => {
      if (scheduledThumbnailGenerationTimers.get(key) !== timer) return;
      scheduledThumbnailGenerationTimers.delete(key);
      void warmVisibleTimelineThumbnailGeneration([ref], { deps });
    }, options.delayMs ?? DEFAULT_VISIBLE_THUMBNAIL_GENERATION_DELAY_MS);

    scheduledThumbnailGenerationTimers.set(key, timer);
    scheduled.push({ key, timer });
  }

  return () => {
    for (const { key, timer } of scheduled) {
      if (scheduledThumbnailGenerationTimers.get(key) !== timer) continue;
      deps.clearTimeout(timer);
      scheduledThumbnailGenerationTimers.delete(key);
    }
  };
}

export function resetTimelineThumbnailGenerationWarmupForTest(): void {
  clearTimelineWarmupTimers(scheduledThumbnailGenerationTimers.values());
  scheduledThumbnailGenerationTimers.clear();
  inFlightThumbnailGenerations.clear();
  activeThumbnailGenerationCount = 0;
  queuedThumbnailGenerationSlots.splice(0);
}
