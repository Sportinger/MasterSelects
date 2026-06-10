import { flags } from '../../../../engine/featureFlags';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { MediaFile } from '../../../../stores/mediaStore/types';
import { thumbnailCacheService } from '../../../thumbnailCacheService';
import type { ToolResult } from '../../types';
import { beginTimelineCanvasSmokeMutation, captureTimelineCanvasSmokeRestoreState, clampNumber, hasBrowserDom, nowMs, restoreTimelineCanvasSmokeState, waitForFrames, type TimelineCanvasSmokeRestoreResult, type TimelineCanvasSmokeSnapshot } from './smokeRuntime';
import { createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot, readCanvasTotals } from './smokeSnapshots';
import { warmThumbnailBitmapsForSource } from './smokeFrameLoop';

function chooseSmokeVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

async function createSmokeVideoSourceUrl(durationMs = 1100): Promise<{
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId?: string;
  sourceName?: string;
} | null> {
  if (
    !hasBrowserDom() ||
    typeof MediaRecorder === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  ) {
    return null;
  }

  const mimeType = chooseSmokeVideoMimeType();
  if (!mimeType) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const stream = canvas.captureStream(12);
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const frameCount = Math.max(6, Math.ceil(durationMs / 85));
  for (let index = 0; index < frameCount; index += 1) {
    const hue = (index * 37) % 360;
    context.fillStyle = `hsl(${hue}, 66%, 36%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `hsl(${(hue + 140) % 360}, 78%, 58%)`;
    context.fillRect(24 + (index % 5) * 14, 28, 108, 104);
    context.fillStyle = '#ffffff';
    context.font = '48px sans-serif';
    context.fillText(String(index % 10), 172, 112);
    await new Promise((resolve) => setTimeout(resolve, 85));
  }

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return null;

  return {
    url: URL.createObjectURL(blob),
    durationSeconds: Math.max(0.5, durationMs / 1000),
    mimeType,
    revokeOnCleanup: true,
  };
}

function resolveExistingThumbnailSmokeVideoSource(args: Record<string, unknown>): {
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId: string;
  sourceName: string;
} | null {
  if (args.useExistingMediaFile !== true && typeof args.mediaFileId !== 'string') {
    return null;
  }

  const requestedMediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId : null;
  const mediaFile = useMediaStore.getState().files.find((candidate) => (
    candidate.type === 'video' &&
    Boolean(candidate.url) &&
    (requestedMediaFileId ? candidate.id === requestedMediaFileId : true)
  ));
  if (!mediaFile?.url) {
    return null;
  }

  const sourceDurationSeconds = clampNumber(
    args.sourceDurationSeconds,
    Math.min(Math.max(mediaFile.duration || 5, 0.5), 8),
    0.5,
    Math.max(0.5, mediaFile.duration || 8),
  );

  return {
    url: mediaFile.url,
    durationSeconds: sourceDurationSeconds,
    mimeType: mediaFile.file instanceof File && mediaFile.file.type ? mediaFile.file.type : 'video/mp4',
    revokeOnCleanup: false,
    reusedMediaFileId: mediaFile.id,
    sourceName: mediaFile.name,
  };
}

function resolveBundledThumbnailSmokeVideoSource(args: Record<string, unknown>): {
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId?: string;
  sourceName: string;
} | null {
  if (!hasBrowserDom()) {
    return null;
  }

  const sourceDurationSeconds = clampNumber(
    args.sourceDurationSeconds,
    Math.max(0.5, Math.round(clampNumber(args.sourceDurationMs, 1400, 500, 5000)) / 1000),
    0.5,
    12,
  );

  return {
    url: '/masterselects_github.mp4',
    durationSeconds: sourceDurationSeconds,
    mimeType: 'video/mp4',
    revokeOnCleanup: false,
    sourceName: 'Bundled masterselects_github.mp4',
  };
}

function getTimelineThumbnailReloadSmokeMediaFiles(): MediaFile[] {
  return useMediaStore.getState().files.filter((file) => (
    file.type === 'video' &&
    (file.id.startsWith('timeline-thumb-reload-smoke-') || file.name === 'Timeline Thumbnail Reload Smoke.webm')
  ));
}

async function cleanupTimelineThumbnailReloadSmokeMediaFiles(): Promise<string[]> {
  const staleFiles = getTimelineThumbnailReloadSmokeMediaFiles();
  if (staleFiles.length === 0) return [];

  const staleIds = new Set(staleFiles.map((file) => file.id));
  useMediaStore.setState((state) => ({
    files: state.files.filter((file) => !staleIds.has(file.id)),
    selectedIds: state.selectedIds?.filter((id) => !staleIds.has(id)) ?? state.selectedIds,
  }));

  for (const mediaFileId of staleIds) {
    await thumbnailCacheService.clearSource(mediaFileId);
  }

  return [...staleIds];
}

function removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline(): {
  removedClipCount: number;
  removedTrackCount: number;
} {
  const timelineStore = useTimelineStore.getState();
  const smokeMediaFileIds = new Set(getTimelineThumbnailReloadSmokeMediaFiles().map((file) => file.id));
  const nextClips = timelineStore.clips.filter((clip) => {
    const source = clip.source as TimelineClip['source'] & { mediaFileId?: string; sourceId?: string };
    const mediaFileId = source?.mediaFileId ?? source?.sourceId ?? null;
    if (mediaFileId && mediaFileId.startsWith('timeline-thumb-reload-smoke-')) return false;
    return !(mediaFileId && smokeMediaFileIds.has(mediaFileId));
  });
  if (nextClips.length === timelineStore.clips.length) {
    return { removedClipCount: 0, removedTrackCount: 0 };
  }

  const usedTrackIds = new Set(nextClips.map((clip) => clip.trackId));
  const nextTracks = timelineStore.tracks.filter((track) => (
    !track.name.startsWith('Smoke Video') || usedTrackIds.has(track.id)
  ));
  useTimelineStore.setState({
    clips: nextClips,
    tracks: nextTracks,
    selectedClipIds: new Set([...timelineStore.selectedClipIds].filter((clipId) => (
      nextClips.some((clip) => clip.id === clipId)
    ))),
  });

  return {
    removedClipCount: timelineStore.clips.length - nextClips.length,
    removedTrackCount: timelineStore.tracks.length - nextTracks.length,
  };
}

export async function handleRunTimelineCanvasThumbnailReloadSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  const durationMs = Math.round(clampNumber(args.sourceDurationMs, 1100, 500, 5000));
  const source = resolveExistingThumbnailSmokeVideoSource(args)
    ?? resolveBundledThumbnailSmokeVideoSource(args)
    ?? await createSmokeVideoSourceUrl(durationMs);
  if (!source) {
    return {
      success: false,
      error: 'could not create synthetic video source for thumbnail reload smoke',
      data: {
        restore: {
          enabled: Boolean(restoreState),
          result: null,
        },
        failures: ['video source unavailable'],
      },
    };
  }

  const mediaFileId = `timeline-thumb-reload-smoke-${Date.now()}`;
  const fileHash = `${mediaFileId}-hash`;
  const mediaFile: MediaFile = {
    id: mediaFileId,
    name: 'Timeline Thumbnail Reload Smoke.webm',
    type: 'video',
    parentId: null,
    createdAt: Date.now(),
    url: source.url,
    duration: source.durationSeconds,
    width: 320,
    height: 180,
    fps: 12,
    fileSize: 0,
    hasAudio: false,
    fileHash,
  };

  let generatedThumbnailCount = 0;
  let warmedThumbnailBitmapCount = 0;
  let generationError: string | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let totals: ReturnType<typeof readCanvasTotals> = {};
  const minThumbnailClipCount = Math.round(clampNumber(args.minThumbnailClipCount, 1, 0, 100000));
  const minThumbnailDrawCount = Math.round(clampNumber(args.minThumbnailDrawCount, 1, 0, 100000));
  const minWorkerTrackCount = Math.round(clampNumber(args.minWorkerTrackCount, 0, 0, 1000));
  const minWorkerEligibleTrackCount = Math.round(clampNumber(args.minWorkerEligibleTrackCount, 0, 0, 1000));
  const maxWorkerFallbackTrackCount = typeof args.maxWorkerFallbackTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerFallbackTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerPendingTrackCount = typeof args.maxWorkerPendingTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerPendingTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerErrorTrackCount = typeof args.maxWorkerErrorTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerErrorTrackCount, 1000, 0, 1000))
    : undefined;
  const minWorkerResourceBytes = Math.round(clampNumber(args.minWorkerResourceBytes, 0, 0, Number.MAX_SAFE_INTEGER));
  const maxWorkerResourceBytes = typeof args.maxWorkerResourceBytes === 'number'
    ? Math.round(clampNumber(args.maxWorkerResourceBytes, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER))
    : undefined;
  const forcedTimelineCanvasWorker = typeof args.forceTimelineCanvasWorker === 'boolean'
    ? args.forceTimelineCanvasWorker
    : null;
  const previousTimelineCanvasWorkerFlag = flags.timelineCanvasWorker;
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  let workerTrackCount = 0;
  let workerEligibleTrackCount = 0;
  let workerFallbackTrackCount = 0;
  let workerPendingTrackCount = 0;
  let workerErrorTrackCount = 0;
  let workerResourceBytes = 0;
  let preRunCleanupIds: string[] = [];
  let postRunCleanupIds: string[] = [];
  let postRunTimelineCleanup: ReturnType<typeof removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline> | null = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    preRunCleanupIds = await cleanupTimelineThumbnailReloadSmokeMediaFiles();
    if (forcedTimelineCanvasWorker !== null) {
      flags.timelineCanvasWorker = forcedTimelineCanvasWorker;
    }
    useMediaStore.setState((state) => ({
      files: [mediaFile, ...state.files.filter((file) => file.id !== mediaFileId)],
    }));

    await thumbnailCacheService.generateForSourceUrl(
      mediaFileId,
      source.url,
      source.durationSeconds,
      fileHash,
      'anonymous',
    );
    generatedThumbnailCount = thumbnailCacheService.getCount(mediaFileId);
    generationError = thumbnailCacheService.getLastGenerationError(mediaFileId);
    if (generatedThumbnailCount <= 0) {
      failures.push(generationError
        ? `synthetic source thumbnail generation produced no frames: ${generationError}`
        : 'synthetic source thumbnail generation produced no frames');
    }

    thumbnailCacheService.evictFromMemory(mediaFileId);
    if (forcedTimelineCanvasWorker === true) {
      warmedThumbnailBitmapCount = await warmThumbnailBitmapsForSource(
        mediaFileId,
        fileHash,
        source.durationSeconds,
        clampNumber(args.workerThumbnailWarmupTimeoutMs, 3000, 0, 10000),
      );
    }
    synthetic = await createSyntheticTimeline({
      createSynthetic: true,
      clipCount: clampNumber(args.clipCount, 18, 1, 160),
      videoTrackCount: clampNumber(args.videoTrackCount, 2, 1, 8),
      durationSeconds: clampNumber(args.durationSeconds, 24, 2, 240),
      clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.5, 20),
      initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      syntheticVideoMediaFileId: mediaFileId,
      syntheticSourceDurationSeconds: source.durationSeconds,
    });

    after = collectSmokeSnapshot('after');
    totals = readCanvasTotals(after);
    const timeoutAt = nowMs() + clampNumber(args.timeoutMs, 7000, 1000, 30000);

    while (
      nowMs() < timeoutAt &&
      (
        Number(totals.thumbnailClipCount ?? 0) < minThumbnailClipCount ||
        Number(totals.thumbnailDrawCount ?? 0) < minThumbnailDrawCount ||
        Number(totals.workerTrackCount ?? 0) < minWorkerTrackCount ||
        Number(totals.workerEligibleTrackCount ?? 0) < minWorkerEligibleTrackCount ||
        (typeof maxWorkerFallbackTrackCount === 'number' && Number(totals.workerFallbackTrackCount ?? 0) > maxWorkerFallbackTrackCount) ||
        (typeof maxWorkerPendingTrackCount === 'number' && Number(totals.workerPendingTrackCount ?? 0) > maxWorkerPendingTrackCount) ||
        (typeof maxWorkerErrorTrackCount === 'number' && Number(totals.workerErrorTrackCount ?? 0) > maxWorkerErrorTrackCount) ||
        Number(totals.workerResourceBytes ?? 0) < minWorkerResourceBytes
      )
    ) {
      await waitForFrames(3, 180);
      after = collectSmokeSnapshot('after');
      totals = readCanvasTotals(after);
    }

    thumbnailClipCount = Number(totals.thumbnailClipCount ?? 0);
    thumbnailDrawCount = Number(totals.thumbnailDrawCount ?? 0);
    workerTrackCount = Number(totals.workerTrackCount ?? 0);
    workerEligibleTrackCount = Number(totals.workerEligibleTrackCount ?? 0);
    workerFallbackTrackCount = Number(totals.workerFallbackTrackCount ?? 0);
    workerPendingTrackCount = Number(totals.workerPendingTrackCount ?? 0);
    workerErrorTrackCount = Number(totals.workerErrorTrackCount ?? 0);
    workerResourceBytes = Number(totals.workerResourceBytes ?? 0);
    if (thumbnailClipCount < minThumbnailClipCount) {
      failures.push(`thumbnailClipCount ${thumbnailClipCount}/${minThumbnailClipCount}`);
    }
    if (thumbnailDrawCount < minThumbnailDrawCount) {
      failures.push(`thumbnailDrawCount ${thumbnailDrawCount}/${minThumbnailDrawCount}`);
    }
    if (workerTrackCount < minWorkerTrackCount) {
      failures.push(`worker tracks ${workerTrackCount}/${minWorkerTrackCount} required`);
    }
    if (workerEligibleTrackCount < minWorkerEligibleTrackCount) {
      failures.push(`worker eligible tracks ${workerEligibleTrackCount}/${minWorkerEligibleTrackCount} required`);
    }
    if (typeof maxWorkerFallbackTrackCount === 'number' && workerFallbackTrackCount > maxWorkerFallbackTrackCount) {
      failures.push(`worker fallback tracks ${workerFallbackTrackCount}/${maxWorkerFallbackTrackCount}`);
    }
    if (typeof maxWorkerPendingTrackCount === 'number' && workerPendingTrackCount > maxWorkerPendingTrackCount) {
      failures.push(`worker pending tracks ${workerPendingTrackCount}/${maxWorkerPendingTrackCount}`);
    }
    if (typeof maxWorkerErrorTrackCount === 'number' && workerErrorTrackCount > maxWorkerErrorTrackCount) {
      failures.push(`worker error tracks ${workerErrorTrackCount}/${maxWorkerErrorTrackCount}`);
    }
    if (workerResourceBytes < minWorkerResourceBytes) {
      failures.push(`worker resource bytes ${workerResourceBytes}/${minWorkerResourceBytes}`);
    }
    if (typeof maxWorkerResourceBytes === 'number' && workerResourceBytes > maxWorkerResourceBytes) {
      failures.push(`worker resource bytes ${workerResourceBytes}/${maxWorkerResourceBytes} max`);
    }

    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
      maxWorkerPendingTrackCount,
      maxWorkerErrorTrackCount,
    }));
  } finally {
    try {
      if (forcedTimelineCanvasWorker !== null) {
        flags.timelineCanvasWorker = previousTimelineCanvasWorkerFlag;
      }
      postRunTimelineCleanup = removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline();
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
      const postRestoreTimelineCleanup = removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline();
      postRunTimelineCleanup = {
        removedClipCount: (postRunTimelineCleanup?.removedClipCount ?? 0) + postRestoreTimelineCleanup.removedClipCount,
        removedTrackCount: (postRunTimelineCleanup?.removedTrackCount ?? 0) + postRestoreTimelineCleanup.removedTrackCount,
      };
      useMediaStore.setState((state) => ({
        files: state.files.filter((file) => file.id !== mediaFileId),
      }));
      await thumbnailCacheService.clearSource(mediaFileId);
      postRunCleanupIds = await cleanupTimelineThumbnailReloadSmokeMediaFiles();
      if (source.revokeOnCleanup) {
        URL.revokeObjectURL(source.url);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      source: {
        mediaFileId,
        fileHash,
        mimeType: source.mimeType,
        durationSeconds: source.durationSeconds,
        reusedMediaFileId: source.reusedMediaFileId,
        sourceName: source.sourceName,
        generatedThumbnailCount,
        warmedThumbnailBitmapCount,
        generationError,
      },
      minThumbnailClipCount,
      minThumbnailDrawCount,
      minWorkerTrackCount,
      minWorkerEligibleTrackCount,
      maxWorkerFallbackTrackCount,
      maxWorkerPendingTrackCount,
      maxWorkerErrorTrackCount,
      minWorkerResourceBytes,
      maxWorkerResourceBytes,
      after,
      thumbnailClipCount,
      thumbnailDrawCount,
      workerTrackCount,
      workerEligibleTrackCount,
      workerFallbackTrackCount,
      workerPendingTrackCount,
      workerErrorTrackCount,
      workerResourceBytes,
      workerFlag: {
        forced: forcedTimelineCanvasWorker,
        previous: previousTimelineCanvasWorkerFlag,
        restored: flags.timelineCanvasWorker,
      },
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      smokeCleanup: {
        preRunMediaFileIds: preRunCleanupIds,
        postRunMediaFileIds: postRunCleanupIds,
        postRunTimelineCleanup,
      },
      failures,
    },
  };
}
