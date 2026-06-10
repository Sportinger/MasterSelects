import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  hasBrowserDom,
  restoreTimelineCanvasSmokeState,
  shouldRestoreTimelineAfterCanvasSmoke,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeSnapshot,
} from './smokeRuntime';
import { createExistingMediaTimeline, createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot } from './smokeSnapshots';
import { readPlayheadLeftPx, samplePlayheadMotion } from './smokeFrameLoop';

export async function handleRunTimelineCanvasPlayheadSmoothnessSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreTimelineAfterRun = shouldRestoreTimelineAfterCanvasSmoke(args);
  const restoreState = restoreTimelineAfterRun
    ? captureTimelineCanvasSmokeRestoreState()
    : null;
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let mediaSetup: Awaited<ReturnType<typeof createExistingMediaTimeline>> | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  const failures: string[] = [];
  let startTime = 0;
  let durationMs = 1200;
  const maxAllowedBacktrackPx = clampNumber(args.maxAllowedBacktrackPx, 2, 0, 50);
  const maxAllowedBacktrackCount = Math.round(clampNumber(args.maxAllowedBacktrackCount, 0, 0, 60));
  const minForwardDistancePx = clampNumber(args.minForwardDistancePx, 20, 0, 10000);
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  let motion: Awaited<ReturnType<typeof samplePlayheadMotion>> | null = null;
  try {
    mediaSetup = args.useExistingMediaFile === true
      ? await createExistingMediaTimeline(args)
      : null;
    synthetic = mediaSetup || args.useExistingMediaFile === true || args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 36, 1, 500),
        videoTrackCount: clampNumber(args.videoTrackCount, 3, 1, 12),
        durationSeconds: clampNumber(args.durationSeconds, 18, 2, 600),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.1, 30),
        initialZoom: clampNumber(args.initialZoom, 96, 16, 1000),
      });
    const timelineStore = useTimelineStore.getState();
    before = collectSmokeSnapshot('before');
    startTime = clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration - 0.1));
    durationMs = clampNumber(args.durationMs, 1200, 300, 10000);

    if (!hasBrowserDom()) {
      failures.push('browser DOM is unavailable');
    }
    if (args.useExistingMediaFile === true && !mediaSetup) {
      failures.push('no existing video MediaFile was available for playhead smoothness smoke');
    }
    if (readPlayheadLeftPx() === null) {
      failures.push('timeline playhead DOM node was not found');
    }
    if (timelineStore.duration <= startTime) {
      failures.push('timeline duration is too short for playhead smoothness smoke');
    }

    const previousSpeed = timelineStore.playbackSpeed;
    const wasPlaying = timelineStore.isPlaying;
    try {
      if (failures.length === 0) {
        if (timelineStore.isPlaying) {
          timelineStore.pause();
          await waitForFrames(2);
        }
        useTimelineStore.setState({
          playheadPosition: startTime,
          playbackSpeed: 1,
          isDraggingPlayhead: false,
        });
        if (args.ensurePlayheadVisible !== false) {
          const { zoom } = useTimelineStore.getState();
          useTimelineStore.getState().setScrollX(Math.max(0, Math.round(startTime * zoom - 80)));
        }
        await waitForFrames(3);
        await useTimelineStore.getState().play();
        await waitForFrames(2);
        motion = await samplePlayheadMotion(durationMs);
        if (motion.sampleCount < 8) {
          failures.push(`playhead motion sampled only ${motion.sampleCount} frames`);
        }
        if (motion.forwardDistancePx < minForwardDistancePx) {
          failures.push(`playhead advanced only ${motion.forwardDistancePx}px/${minForwardDistancePx}px`);
        }
        if (motion.backtrackCount > maxAllowedBacktrackCount) {
          failures.push(`playhead backtracked ${motion.backtrackCount}/${maxAllowedBacktrackCount} frames`);
        }
        if (motion.maxBacktrackPx > maxAllowedBacktrackPx) {
          failures.push(`playhead max backtrack ${motion.maxBacktrackPx}px/${maxAllowedBacktrackPx}px`);
        }
      }
    } finally {
      useTimelineStore.getState().pause();
      useTimelineStore.setState({ playbackSpeed: previousSpeed });
      if (wasPlaying) {
        void useTimelineStore.getState().play();
      }
    }

    after = collectSmokeSnapshot('after');
    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
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
      mediaSetup,
      before,
      after,
      restore: {
        enabled: restoreTimelineAfterRun,
        result: restoreResult,
      },
      motion,
      thresholds: {
        maxAllowedBacktrackPx,
        maxAllowedBacktrackCount,
        minForwardDistancePx,
      },
      failures,
    },
  };
}
