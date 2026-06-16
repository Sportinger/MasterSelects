import { useTimelineStore } from '../../../../stores/timeline';
import { getLastRamPreviewGenerationError } from '../../../../stores/timeline/ramPreviewSlice';
import { useMediaStore } from '../../../../stores/mediaStore';
import { renderHostPort } from '../../../render/renderHostPort';
import { RamPreviewEngine } from '../../../ramPreviewEngine';
import {
  createRamPreviewRunId,
  releaseRamPreviewRunResources,
  reportRamPreviewRunJob,
} from '../../../timeline/ramPreviewRuntimeReporting';
import type { ToolResult } from '../../types';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeSnapshot,
  type TimelineStoreSnapshot,
} from './smokeRuntime';
import { createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot } from './smokeSnapshots';

async function runDirectRamPreviewSmokeRange(start: number, end: number): Promise<{
  completed: boolean;
  frameCount: number;
  error: { message: string; stack?: string } | null;
}> {
  const store = useTimelineStore.getState();
  const runId = createRamPreviewRunId();
  reportRamPreviewRunJob({
    runId,
    start,
    end,
    centerTime: (start + end) / 2,
    label: 'Timeline canvas verification direct RAM preview smoke',
    startedAtMs: Date.now(),
  });

  renderHostPort.setGeneratingRamPreview(true);
  try {
    const preview = new RamPreviewEngine(renderHostPort.getRamPreviewRenderEngine());
    const result = await preview.generate(
      {
        start,
        end,
        centerTime: (start + end) / 2,
        clips: store.clips,
        tracks: store.tracks,
        runId,
      },
      {
        isCancelled: () => false,
        isFrameCached: (qt) => useTimelineStore.getState().cachedFrameTimes.has(qt),
        getSourceTimeForClip: (id, t) => useTimelineStore.getState().getSourceTimeForClip(id, t),
        getInterpolatedSpeed: (id, t) => useTimelineStore.getState().getInterpolatedSpeed(id, t),
        getCompositionDimensions: (compId) => {
          const comp = useMediaStore.getState().compositions.find((candidate) => candidate.id === compId);
          return { width: comp?.width || 1920, height: comp?.height || 1080 };
        },
        onFrameCached: (time) => useTimelineStore.getState().addCachedFrame(time),
        onProgress: () => undefined,
      },
    );
    return {
      completed: result.completed,
      frameCount: result.frameCount,
      error: null,
    };
  } catch (error) {
    return {
      completed: false,
      frameCount: 0,
      error: error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) },
    };
  } finally {
    renderHostPort.setGeneratingRamPreview(false);
    releaseRamPreviewRunResources(runId);
    useTimelineStore.setState({ isRamPreviewing: false, ramPreviewProgress: null });
  }
}

export async function handleRunTimelineCanvasRamPreviewSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreTimelineAfterRun = args.restoreTimelineAfterRun === true ||
    (args.createSynthetic === true && args.restoreTimelineAfterRun !== false);
  const restoreState = restoreTimelineAfterRun
    ? captureTimelineCanvasSmokeRestoreState()
    : null;
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let start = 0;
  let end = 0.35;
  const requireNested = args.requireNested === true;
  const requireVideo = args.requireVideo !== false;
  const failures: string[] = [];
  let completed = false;
  let mode: 'store' | 'direct-engine-fallback' = 'store';
  let directResult: Awaited<ReturnType<typeof runDirectRamPreviewSmokeRange>> | null = null;
  let cachedRanges: ReturnType<TimelineStoreSnapshot['getCachedRanges']> = [];
  let generationError: Awaited<ReturnType<typeof runDirectRamPreviewSmokeRange>>['error'] | ReturnType<typeof getLastRamPreviewGenerationError> = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === true
      ? await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 1, 1, 16),
        videoTrackCount: clampNumber(args.videoTrackCount, 1, 1, 4),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 1, 0.35, 30),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 1, 0.35, 30),
        syntheticSourceType: 'image',
      })
      : null;
    const timelineStore = useTimelineStore.getState();
    before = collectSmokeSnapshot('before');
    start = clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration));
    const defaultEnd = Math.min(Math.max(start + 0.35, 0.35), Math.max(0.35, timelineStore.duration || 0.35));
    end = clampNumber(args.endTime, defaultEnd, start + 0.05, Math.max(start + 0.05, timelineStore.duration || defaultEnd));

    if (timelineStore.clips.length === 0) {
      failures.push('timeline has no clips for RAM preview smoke');
    }
    if (requireNested && before.timeline.compositionClipCount === 0) {
      failures.push('timeline has no nested composition clip for RAM preview smoke');
    }
    if (requireVideo && !timelineStore.clips.some((clip) => clip.source?.type !== 'audio')) {
      failures.push('timeline has no video/visual clip for RAM preview smoke');
    }

    if (failures.length === 0) {
      await timelineStore.clearRamPreview();
      completed = await useTimelineStore.getState().startRamPreviewForRange(start, end, {
        centerTime: (start + end) / 2,
        label: 'Timeline canvas verification smoke',
      });
      const storeGenerationError = getLastRamPreviewGenerationError();
      if (
        !completed &&
        args.allowDirectEngineFallback !== false &&
        storeGenerationError?.message.includes('isRamPreviewing became false')
      ) {
        await useTimelineStore.getState().clearRamPreview();
        directResult = await runDirectRamPreviewSmokeRange(start, end);
        completed = directResult.completed;
        mode = 'direct-engine-fallback';
      }
      await waitForFrames(2);
      if (!completed) {
        failures.push('RAM preview generation did not complete');
      }
    }

    after = collectSmokeSnapshot('after');
    cachedRanges = useTimelineStore.getState().getCachedRanges();
    generationError = directResult?.error ?? getLastRamPreviewGenerationError();
    if (completed && cachedRanges.length === 0) {
      failures.push('RAM preview completed without cached ranges');
    }
    if (!completed && generationError) {
      failures.push(`RAM preview error: ${generationError.message}`);
    }

    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom === true,
    }));
  } finally {
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
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
      range: { start, end },
      mode,
      completed,
      generationError,
      directResult,
      cachedRanges,
      before,
      after,
      restore: {
        enabled: restoreTimelineAfterRun,
        result: restoreResult,
      },
      failures,
    },
  };
}
