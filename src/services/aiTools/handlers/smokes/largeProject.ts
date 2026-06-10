import { flags } from '../../../../engine/featureFlags';
import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  nowMs,
  readLargeProjectFrameLoopBudget,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeSnapshot,
  type TimelineCanvasSmokeStep,
} from './smokeRuntime';
import { createSyntheticTimeline } from './smokeFixtures';
import {
  assertCanvasSmokeSnapshot,
  assertTimelineCanvasStepInvariants,
  buildSmokePhaseRecorder,
  collectSmokeSnapshot,
  compactSmokeSnapshot,
  hasCulledDrawStep,
  maxTimelineScrollX,
  readCanvasTotals,
} from './smokeSnapshots';
import {
  assertTimelineCanvasFrameLoopBudget,
  sampleFrameLoop,
  warmWorkerThumbnailBitmapsForCurrentTimeline,
} from './smokeFrameLoop';

export async function handleRunTimelineCanvasLargeProjectSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const createSynthetic = args.createSynthetic !== false;
  const steps: TimelineCanvasSmokeStep[] = [];
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let frameLoop: Awaited<ReturnType<typeof sampleFrameLoop>> | null = null;
  let workerThumbnailWarmup: Awaited<ReturnType<typeof warmWorkerThumbnailBitmapsForCurrentTimeline>> | null = null;
  const compactResult = args.compactResult === true;
  const phaseRecorder = buildSmokePhaseRecorder();
  const frameLoopBudget = readLargeProjectFrameLoopBudget(args);
  const minWorkerTrackCount = Math.round(clampNumber(args.minWorkerTrackCount, 0, 0, 1000));
  const minWorkerEligibleTrackCount = Math.round(clampNumber(args.minWorkerEligibleTrackCount, 0, 0, 1000));
  const minWorkerWarmThumbnailBitmapCount = Math.round(clampNumber(
    args.minWorkerWarmThumbnailBitmapCount,
    0,
    0,
    100000,
  ));
  const maxWorkerTrackCount = typeof args.maxWorkerTrackCount === 'number'
    ? clampNumber(args.maxWorkerTrackCount, 0, 0, 1000)
    : minWorkerTrackCount > 0
      ? 1000
      : 0;
  const maxWorkerFallbackTrackCount = typeof args.maxWorkerFallbackTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerFallbackTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerPendingTrackCount = typeof args.maxWorkerPendingTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerPendingTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerErrorTrackCount = typeof args.maxWorkerErrorTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerErrorTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerResourceBytes = typeof args.maxWorkerResourceBytes === 'number'
    ? Math.round(clampNumber(args.maxWorkerResourceBytes, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER))
    : undefined;
  const requiredWorkerFallbackReasons = Array.isArray(args.requiredWorkerFallbackReasons)
    ? args.requiredWorkerFallbackReasons.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    : [];
  const allowedWorkerFallbackReasons = Array.isArray(args.allowedWorkerFallbackReasons)
    ? args.allowedWorkerFallbackReasons.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    : [];
  const maxShellCount = clampNumber(args.maxShellCount, 0, 0, 1000);
  const forcedTimelineCanvasWorker = typeof args.forceTimelineCanvasWorker === 'boolean'
    ? args.forceTimelineCanvasWorker
    : null;
  const previousTimelineCanvasWorkerFlag = flags.timelineCanvasWorker;
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    let phaseStartMs = nowMs();
    if (forcedTimelineCanvasWorker !== null) {
      flags.timelineCanvasWorker = forcedTimelineCanvasWorker;
    }
    phaseRecorder.record('worker-flag', phaseStartMs);
    phaseStartMs = nowMs();
    synthetic = createSynthetic ? await createSyntheticTimeline(args) : null;
    phaseRecorder.record(createSynthetic ? 'synthetic-timeline' : 'existing-timeline', phaseStartMs);
    if (args.warmWorkerThumbnails === true) {
      phaseStartMs = nowMs();
      workerThumbnailWarmup = await warmWorkerThumbnailBitmapsForCurrentTimeline({
        timeoutMs: clampNumber(args.workerThumbnailWarmupTimeoutMs, 6000, 0, 30000),
        maxSecondsPerSource: clampNumber(args.workerThumbnailWarmupMaxSecondsPerSource, 300, 1, 3600),
      });
      if (workerThumbnailWarmup.warmedBitmapCount < minWorkerWarmThumbnailBitmapCount) {
        failures.push(
          `worker thumbnail warmup bitmaps ${workerThumbnailWarmup.warmedBitmapCount}/${minWorkerWarmThumbnailBitmapCount}`
        );
      }
      await waitForFrames(3, 180);
      phaseRecorder.record('worker-thumbnail-warmup', phaseStartMs);
    }
    phaseStartMs = nowMs();
    before = collectSmokeSnapshot('before');
    phaseRecorder.record('before-snapshot', phaseStartMs);
    const initialZoom = before.timeline.zoom;
    const zoomLevels = Array.isArray(args.zoomLevels) && args.zoomLevels.length > 0
      ? args.zoomLevels.map((value) => clampNumber(value, initialZoom, 1, 1000))
      : [initialZoom, Math.max(4, initialZoom * 0.5), Math.min(1000, initialZoom * 2)];
    const scrollFractions = Array.isArray(args.scrollFractions) && args.scrollFractions.length > 0
      ? args.scrollFractions.map((value) => clampNumber(value, 0, 0, 1))
      : [0, 0.5, 1];
    const timelineStore = useTimelineStore.getState();

    for (const zoom of zoomLevels) {
      const zoomStartMs = nowMs();
      timelineStore.setZoom(zoom);
      await waitForFrames(2);
      phaseRecorder.record(`zoom:${zoom}`, zoomStartMs);
      const stateAtZoom = useTimelineStore.getState();
      const effectiveZoom = stateAtZoom.zoom;
      const maxScroll = maxTimelineScrollX(stateAtZoom.duration, effectiveZoom);
      for (const fraction of scrollFractions) {
        const scrollStartMs = nowMs();
        const scrollX = Math.round(maxScroll * fraction);
        useTimelineStore.getState().setScrollX(scrollX);
        await waitForFrames(2);
        const stepSnapshot = collectSmokeSnapshot(`zoom:${zoom}:scroll:${fraction}`);
        phaseRecorder.record(`step:${effectiveZoom}:${fraction}`, scrollStartMs);
        steps.push({
          label: stepSnapshot.label,
          requestedZoom: effectiveZoom,
          zoom: stepSnapshot.timeline.zoom,
          scrollFraction: fraction,
          requestedScrollX: scrollX,
          scrollX: stepSnapshot.timeline.scrollX,
          dom: stepSnapshot.dom,
          canvasTotals: readCanvasTotals(stepSnapshot),
        });
      }
    }

    if (args.selectAll !== false) {
      const selectStartMs = nowMs();
      const clipIds = useTimelineStore.getState().clips.map((clip) => clip.id);
      useTimelineStore.getState().selectClips(clipIds);
      await waitForFrames(3);
      phaseRecorder.record('select-all', selectStartMs);
    }

    phaseStartMs = nowMs();
    frameLoop = await sampleFrameLoop(clampNumber(args.frameSampleMs, 750, 100, 10000));
    phaseRecorder.record('frame-loop-sample', phaseStartMs);
    phaseStartMs = nowMs();
    after = collectSmokeSnapshot('after');
    phaseRecorder.record('after-snapshot', phaseStartMs);
    const workerSettleTimeoutMs = clampNumber(
      args.workerSettleTimeoutMs,
      typeof maxWorkerPendingTrackCount === 'number' ? 3000 : 0,
      0,
      30000,
    );
    if (workerSettleTimeoutMs > 0) {
      phaseStartMs = nowMs();
      const settleTimeoutAt = nowMs() + workerSettleTimeoutMs;
      let settleTotals = readCanvasTotals(after);
      while (
        nowMs() < settleTimeoutAt &&
        (
          (typeof maxWorkerPendingTrackCount === 'number' && Number(settleTotals.workerPendingTrackCount ?? 0) > maxWorkerPendingTrackCount) ||
          (typeof maxWorkerErrorTrackCount === 'number' && Number(settleTotals.workerErrorTrackCount ?? 0) > maxWorkerErrorTrackCount)
        )
      ) {
        await waitForFrames(2, 180);
        after = collectSmokeSnapshot('after');
        settleTotals = readCanvasTotals(after);
      }
      phaseRecorder.record('worker-settle', phaseStartMs);
    }
    phaseStartMs = nowMs();
    failures.push(
      ...assertCanvasSmokeSnapshot(after, {
        requireTimelineDom: args.requireTimelineDom !== false,
        requireCulling: args.requireCulling !== false,
        requireSelectedAll: args.selectAll !== false,
        expectedSelectedClipCount: args.selectAll !== false ? after.timeline.clipCount : undefined,
        maxWorkerTrackCount,
        minWorkerTrackCount,
        minWorkerEligibleTrackCount,
        maxWorkerFallbackTrackCount,
        maxWorkerPendingTrackCount,
        maxWorkerErrorTrackCount,
        maxWorkerResourceBytes,
        requiredWorkerFallbackReasons,
        allowedWorkerFallbackReasons,
        maxShellCount,
      }),
      ...steps.flatMap((step) => assertTimelineCanvasStepInvariants(step, {
        requireTimelineDom: args.requireTimelineDom !== false,
        maxWorkerTrackCount,
        maxWorkerResourceBytes,
        maxShellCount,
        assertRequestedPosition: true,
      })),
      ...assertTimelineCanvasFrameLoopBudget(frameLoop, frameLoopBudget),
    );
    if (args.requireCulling !== false && !hasCulledDrawStep(steps, after.timeline.clipCount)) {
      failures.push(`large project did not report a partially culled draw step for ${after.timeline.clipCount} clips`);
    }
    phaseRecorder.record('assertions', phaseStartMs);
  } finally {
    const restoreStartMs = nowMs();
    try {
      if (forcedTimelineCanvasWorker !== null) {
        flags.timelineCanvasWorker = previousTimelineCanvasWorkerFlag;
      }
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
    phaseRecorder.record('restore', restoreStartMs);
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      before: compactResult ? compactSmokeSnapshot(before) : before,
      after: compactResult ? compactSmokeSnapshot(after) : after,
      steps,
      frameLoop,
      frameLoopBudget,
      workerThumbnailWarmup,
      phaseTimings: phaseRecorder.timings,
      invariantBudget: {
        maxWorkerTrackCount,
        minWorkerTrackCount,
        minWorkerEligibleTrackCount,
        minWorkerWarmThumbnailBitmapCount,
        maxWorkerFallbackTrackCount,
        maxWorkerPendingTrackCount,
        maxWorkerErrorTrackCount,
        maxWorkerResourceBytes,
        requiredWorkerFallbackReasons,
        allowedWorkerFallbackReasons,
        maxShellCount,
      },
      workerFlag: {
        forced: forcedTimelineCanvasWorker,
        previous: previousTimelineCanvasWorkerFlag,
        restored: flags.timelineCanvasWorker,
      },
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}
