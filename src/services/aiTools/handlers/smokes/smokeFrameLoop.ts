import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { thumbnailCacheService } from '../../../thumbnailCacheService';
import { ensureThumbnailBitmap, hasThumbnailBitmap } from '../../../timeline/thumbnailBitmapCache';
import {
  hasBrowserDom,
  nowMs,
  round,
  summarizeNumbers,
  waitForFrames,
  type NumberSummary,
  type TimelineCanvasFrameLoopBudget,
} from './smokeRuntime';

export async function warmThumbnailBitmapsForSource(
  mediaFileId: string,
  fileHash: string | undefined,
  durationSeconds: number,
  timeoutMs: number,
): Promise<number> {
  await thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
  const urls = new Set<string>();
  const maxSecond = Math.max(0, Math.ceil(durationSeconds) + 1);
  for (let second = 0; second <= maxSecond; second += 1) {
    const url = thumbnailCacheService.getThumbnail(mediaFileId, second);
    if (url) {
      urls.add(url);
    }
  }
  if (urls.size === 0) return 0;

  urls.forEach((url) => {
    ensureThumbnailBitmap(url, () => undefined, mediaFileId);
  });

  const timeoutAt = nowMs() + Math.max(0, timeoutMs);
  while (nowMs() < timeoutAt) {
    let readyCount = 0;
    urls.forEach((url) => {
      if (hasThumbnailBitmap(url)) readyCount += 1;
    });
    if (readyCount >= urls.size) return readyCount;
    await waitForFrames(1, 180);
  }

  let readyCount = 0;
  urls.forEach((url) => {
    if (hasThumbnailBitmap(url)) readyCount += 1;
  });
  return readyCount;
}

function getSmokeClipThumbnailMediaFileId(clip: TimelineClip): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

export async function warmWorkerThumbnailBitmapsForCurrentTimeline(input: {
  timeoutMs: number;
  maxSecondsPerSource: number;
}): Promise<{
  sourceCount: number;
  requestedUrlCount: number;
  warmedBitmapCount: number;
  missingSourceIds: string[];
}> {
  const clips = useTimelineStore.getState().clips;
  const mediaFilesById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const sources = new Map<string, {
    fileHash?: string;
    durationSeconds: number;
  }>();

  for (const clip of clips) {
    const mediaFileId = getSmokeClipThumbnailMediaFileId(clip);
    if (!mediaFileId) continue;
    const mediaFile = mediaFilesById.get(mediaFileId);
    const durationSeconds = Math.max(
      clip.source?.naturalDuration ?? 0,
      clip.outPoint ?? 0,
      clip.duration ?? 0,
      mediaFile?.duration ?? 0,
    );
    sources.set(mediaFileId, {
      fileHash: mediaFile?.fileHash,
      durationSeconds: Math.max(durationSeconds, sources.get(mediaFileId)?.durationSeconds ?? 0),
    });
  }

  const urls = new Map<string, { url: string; mediaFileId: string }>();
  const missingSourceIds: string[] = [];
  for (const [mediaFileId, source] of sources) {
    await thumbnailCacheService.loadCachedForSource(mediaFileId, source.fileHash);
    const maxSecond = Math.max(0, Math.min(
      Math.ceil(source.durationSeconds) + 1,
      Math.round(input.maxSecondsPerSource),
    ));
    let sourceUrlCount = 0;
    for (let second = 0; second <= maxSecond; second += 1) {
      const url = thumbnailCacheService.getThumbnail(mediaFileId, second);
      if (!url) continue;
      sourceUrlCount += 1;
      urls.set(url, { url, mediaFileId });
    }
    if (sourceUrlCount === 0) {
      missingSourceIds.push(mediaFileId);
    }
  }

  urls.forEach(({ url, mediaFileId }) => {
    ensureThumbnailBitmap(url, () => undefined, mediaFileId);
  });

  const timeoutAt = nowMs() + Math.max(0, input.timeoutMs);
  while (nowMs() < timeoutAt) {
    let readyCount = 0;
    urls.forEach(({ url }) => {
      if (hasThumbnailBitmap(url)) readyCount += 1;
    });
    if (readyCount >= urls.size) {
      return {
        sourceCount: sources.size,
        requestedUrlCount: urls.size,
        warmedBitmapCount: readyCount,
        missingSourceIds,
      };
    }
    await waitForFrames(1, 180);
  }

  let warmedBitmapCount = 0;
  urls.forEach(({ url }) => {
    if (hasThumbnailBitmap(url)) warmedBitmapCount += 1;
  });
  return {
    sourceCount: sources.size,
    requestedUrlCount: urls.size,
    warmedBitmapCount,
    missingSourceIds,
  };
}

export async function sampleFrameLoop(durationMs: number): Promise<{
  durationMs: number;
  frameCount: number;
  estimatedFps: number;
  frameDeltaMs: NumberSummary;
  slowFrameCount: number;
  droppedFrameEstimate: number;
}> {
  const safeDurationMs = Math.max(100, Math.min(10000, Math.round(durationMs)));
  const expectedFrameMs = 1000 / 60;
  const startedAt = nowMs();
  const deltas: number[] = [];
  let previousFrameAt: number | null = null;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const scheduleNext = () => {
      if (nowMs() - startedAt >= safeDurationMs) {
        finish();
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        const timeout = setTimeout(() => tick(nowMs()), 120);
        requestAnimationFrame((timestamp) => {
          clearTimeout(timeout);
          tick(timestamp);
        });
      } else {
        setTimeout(() => tick(Date.now()), 16);
      }
    };
    const tick = (timestamp: number) => {
      if (resolved) {
        return;
      }
      if (previousFrameAt !== null) {
        deltas.push(timestamp - previousFrameAt);
      }
      previousFrameAt = timestamp;
      if (timestamp - startedAt >= safeDurationMs) {
        finish();
        return;
      }
      scheduleNext();
    };

    scheduleNext();
  });

  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);

  return {
    durationMs: safeDurationMs,
    frameCount: deltas.length,
    estimatedFps: round(deltas.length / Math.max(0.001, safeDurationMs / 1000)),
    frameDeltaMs: summarizeNumbers(deltas),
    slowFrameCount: deltas.filter((delta) => delta > expectedFrameMs * 1.75).length,
    droppedFrameEstimate,
  };
}

export function assertTimelineCanvasFrameLoopBudget(
  frameLoop: Awaited<ReturnType<typeof sampleFrameLoop>>,
  budget: TimelineCanvasFrameLoopBudget,
): string[] {
  const failures: string[] = [];
  if (frameLoop.estimatedFps < budget.minEstimatedFps) {
    failures.push(`large project estimated FPS ${frameLoop.estimatedFps}/${budget.minEstimatedFps}`);
  }
  if (frameLoop.droppedFrameEstimate > budget.maxDroppedFrameEstimate) {
    failures.push(`large project dropped frame estimate ${frameLoop.droppedFrameEstimate}/${budget.maxDroppedFrameEstimate}`);
  }
  if (frameLoop.slowFrameCount > budget.maxSlowFrameCount) {
    failures.push(`large project slow frame count ${frameLoop.slowFrameCount}/${budget.maxSlowFrameCount}`);
  }
  if (frameLoop.frameDeltaMs.max > budget.maxFrameDeltaMs) {
    failures.push(`large project max frame delta ${frameLoop.frameDeltaMs.max}ms/${budget.maxFrameDeltaMs}ms`);
  }
  return failures;
}

export function readPlayheadLeftPx(): number | null {
  if (!hasBrowserDom()) return null;
  const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"], .playhead');
  if (!playhead) return null;
  const styleLeft = Number.parseFloat(playhead.style.left);
  if (Number.isFinite(styleLeft)) {
    return styleLeft;
  }
  const computedLeft = Number.parseFloat(window.getComputedStyle(playhead).left);
  return Number.isFinite(computedLeft) ? computedLeft : null;
}

export async function samplePlayheadMotion(durationMs: number): Promise<{
  durationMs: number;
  sampleCount: number;
  forwardDistancePx: number;
  backtrackCount: number;
  maxBacktrackPx: number;
  backtrackDistancePx: number;
  leftPx: NumberSummary;
  frameDeltaMs: NumberSummary;
  samples: Array<{ atMs: number; leftPx: number; storeTime: number }>;
}> {
  const safeDurationMs = Math.max(200, Math.min(10000, Math.round(durationMs)));
  const startedAt = nowMs();
  const samples: Array<{ atMs: number; leftPx: number; storeTime: number }> = [];
  const frameDeltas: number[] = [];
  let previousFrameAt: number | null = null;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const tick = (timestamp: number) => {
      if (resolved) {
        return;
      }
      if (previousFrameAt !== null) {
        frameDeltas.push(timestamp - previousFrameAt);
      }
      previousFrameAt = timestamp;

      const leftPx = readPlayheadLeftPx();
      if (leftPx !== null) {
        samples.push({
          atMs: round(nowMs() - startedAt),
          leftPx: round(leftPx),
          storeTime: round(useTimelineStore.getState().playheadPosition),
        });
      }

      if (nowMs() - startedAt >= safeDurationMs) {
        finish();
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        const timeout = setTimeout(() => tick(nowMs()), 120);
        requestAnimationFrame((nextTimestamp) => {
          clearTimeout(timeout);
          tick(nextTimestamp);
        });
      } else {
        setTimeout(() => tick(Date.now()), 16);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tick);
    } else {
      setTimeout(() => tick(Date.now()), 16);
    }
  });

  let backtrackCount = 0;
  let maxBacktrackPx = 0;
  let backtrackDistancePx = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].leftPx;
    const current = samples[index].leftPx;
    if (current < previous) {
      const delta = previous - current;
      backtrackCount += 1;
      backtrackDistancePx += delta;
      maxBacktrackPx = Math.max(maxBacktrackPx, delta);
    }
  }

  const firstLeft = samples[0]?.leftPx ?? 0;
  const lastLeft = samples[samples.length - 1]?.leftPx ?? firstLeft;
  return {
    durationMs: safeDurationMs,
    sampleCount: samples.length,
    forwardDistancePx: round(lastLeft - firstLeft),
    backtrackCount,
    maxBacktrackPx: round(maxBacktrackPx),
    backtrackDistancePx: round(backtrackDistancePx),
    leftPx: summarizeNumbers(samples.map((sample) => sample.leftPx)),
    frameDeltaMs: summarizeNumbers(frameDeltas),
    samples: samples.slice(0, 160),
  };
}