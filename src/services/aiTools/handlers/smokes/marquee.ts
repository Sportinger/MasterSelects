import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  hasBrowserDom,
  restoreTimelineCanvasSmokeState,
  round,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeSnapshot,
} from './smokeRuntime';
import { createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot, dispatchMouseEvent } from './smokeSnapshots';

async function runMarqueeDrag(): Promise<{
  started: boolean;
  startClientX: number;
  startClientY: number;
  endClientX: number;
  endClientY: number;
}> {
  if (!hasBrowserDom()) {
    return {
      started: false,
      startClientX: 0,
      startClientY: 0,
      endClientX: 0,
      endClientY: 0,
    };
  }

  const section = document.querySelector<HTMLElement>('.timeline-section-tracks');
  const row = document.querySelector<HTMLElement>('.track-lane[data-track-id] .track-clip-row');
  if (!section || !row) {
    return {
      started: false,
      startClientX: 0,
      startClientY: 0,
      endClientX: 0,
      endClientY: 0,
    };
  }

  const rowRect = row.getBoundingClientRect();
  const startClientX = rowRect.left + 8;
  const startClientY = rowRect.top + Math.max(8, Math.min(24, rowRect.height / 2));
  const endClientX = Math.min(rowRect.right - 8, startClientX + 760);
  const endClientY = Math.min(window.innerHeight - 8, startClientY + 180);

  dispatchMouseEvent(row, 'mousedown', { clientX: startClientX, clientY: startClientY });
  await waitForFrames(1);
  dispatchMouseEvent(document, 'mousemove', { clientX: endClientX, clientY: endClientY });
  await waitForFrames(2);
  dispatchMouseEvent(document, 'mouseup', { clientX: endClientX, clientY: endClientY, buttons: 0 });
  await waitForFrames(2);

  return {
    started: true,
    startClientX: round(startClientX),
    startClientY: round(startClientY),
    endClientX: round(endClientX),
    endClientY: round(endClientY),
  };
}

export async function handleRunTimelineCanvasMarqueeSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let drag: Awaited<ReturnType<typeof runMarqueeDrag>> | null = null;
  const minSelectedClipCount = Math.round(clampNumber(args.minSelectedClipCount, 1, 0, 100000));
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 160, 1, 1000),
        videoTrackCount: clampNumber(args.videoTrackCount, 4, 1, 16),
        durationSeconds: clampNumber(args.durationSeconds, 120, 5, 3600),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.05, 30),
        initialZoom: clampNumber(args.initialZoom, 16, 1, 1000),
      });
    before = collectSmokeSnapshot('before');

    if (args.clearSelection !== false) {
      useTimelineStore.getState().selectClip(null, false);
      useTimelineStore.getState().deselectAllKeyframes();
      await waitForFrames(2);
    }

    drag = await runMarqueeDrag();
    if (!drag.started) {
      failures.push('marquee drag target was not found');
    }

    after = collectSmokeSnapshot('after');
    if (after.timeline.selectedClipCount < minSelectedClipCount) {
      failures.push(`marquee selected ${after.timeline.selectedClipCount}/${minSelectedClipCount} required clips`);
    }

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
      drag,
      minSelectedClipCount,
      before,
      after,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}