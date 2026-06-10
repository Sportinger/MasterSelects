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
  type TimelineStoreSnapshot,
} from './smokeRuntime';
import { createExistingMediaTimeline, createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot, dispatchMouseEvent } from './smokeSnapshots';

async function runBladeToolGesture(args: Record<string, unknown>): Promise<{
  started: boolean;
  rowFound: boolean;
  targetClipId: string | null;
  splitTime: number;
  clientX: number;
  clientY: number;
  beforeClipCount: number;
  afterClipCount: number;
  previewBeforeClick: TimelineStoreSnapshot['timelineToolPreview'];
}> {
  const store = useTimelineStore.getState();
  const targetClip = store.clips
    .filter((clip) => clip.source?.type !== 'audio')
    .toSorted((a, b) => a.startTime - b.startTime)[0] ?? null;
  const splitTime = targetClip
    ? clampNumber(args.splitTime, targetClip.startTime + targetClip.duration * 0.5, targetClip.startTime + 0.05, targetClip.startTime + targetClip.duration - 0.05)
    : 0;

  if (!hasBrowserDom() || !targetClip) {
    return {
      started: false,
      rowFound: false,
      targetClipId: targetClip?.id ?? null,
      splitTime,
      clientX: 0,
      clientY: 0,
      beforeClipCount: store.clips.length,
      afterClipCount: store.clips.length,
      previewBeforeClick: null,
    };
  }

  const row = document.querySelector<HTMLElement>(`.track-lane[data-track-id="${targetClip.trackId}"] .track-clip-row`)
    ?? document.querySelector<HTMLElement>('.track-lane[data-track-id] .track-clip-row');
  if (!row) {
    return {
      started: false,
      rowFound: false,
      targetClipId: targetClip.id,
      splitTime,
      clientX: 0,
      clientY: 0,
      beforeClipCount: store.clips.length,
      afterClipCount: store.clips.length,
      previewBeforeClick: null,
    };
  }

  const rowRect = row.getBoundingClientRect();
  const zoom = Math.max(0.001, useTimelineStore.getState().zoom);
  const clientX = rowRect.left + splitTime * zoom;
  const clientY = rowRect.top + Math.max(8, Math.min(24, rowRect.height / 2));
  const beforeClipCount = useTimelineStore.getState().clips.length;

  useTimelineStore.getState().setTimelineToolPreview(null);
  useTimelineStore.getState().setActiveTimelineTool('blade');
  await waitForFrames(2);
  dispatchMouseEvent(row, 'mousemove', { clientX, clientY, buttons: 0 });
  await waitForFrames(2);
  const previewBeforeClick = useTimelineStore.getState().timelineToolPreview;
  dispatchMouseEvent(row, 'mousedown', { clientX, clientY, buttons: 1 });
  await waitForFrames(1);
  dispatchMouseEvent(document, 'mouseup', { clientX, clientY, buttons: 0 });
  await waitForFrames(2);

  return {
    started: true,
    rowFound: true,
    targetClipId: targetClip.id,
    splitTime: round(splitTime),
    clientX: round(clientX),
    clientY: round(clientY),
    beforeClipCount,
    afterClipCount: useTimelineStore.getState().clips.length,
    previewBeforeClick,
  };
}

export async function handleRunTimelineCanvasBladeToolSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  let mediaSetup: Awaited<ReturnType<typeof createExistingMediaTimeline>> | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let gesture: Awaited<ReturnType<typeof runBladeToolGesture>> | null = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    mediaSetup = args.useExistingMediaFile === true
      ? await createExistingMediaTimeline({
        ...args,
        durationSeconds: clampNumber(args.durationSeconds, 18, 0.5, 7200),
      })
      : null;
    synthetic = mediaSetup || args.useExistingMediaFile === true
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 1, 1, 4),
        videoTrackCount: clampNumber(args.videoTrackCount, 1, 1, 4),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 8, 1, 120),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 6, 0.2, 60),
        initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      });
    before = collectSmokeSnapshot('before');
    gesture = await runBladeToolGesture(args);
    after = collectSmokeSnapshot('after');

    if (args.useExistingMediaFile === true && !mediaSetup) {
      failures.push('no existing video MediaFile was available for blade tool smoke');
    }
    if (!gesture.rowFound) {
      failures.push('blade smoke could not find a canvas track row');
    }
    if (!gesture.started) {
      failures.push('blade smoke did not dispatch the pointer gesture');
    }
    if (gesture.previewBeforeClick?.toolId !== 'blade') {
      failures.push('blade hover did not publish a blade tool preview');
    }
    if (gesture.previewBeforeClick?.clipId !== gesture.targetClipId) {
      failures.push('blade hover preview did not target the hit clip');
    }
    if (Math.abs((gesture.previewBeforeClick?.time ?? Number.NaN) - gesture.splitTime) > 0.05) {
      failures.push(`blade hover preview time ${gesture.previewBeforeClick?.time ?? 'missing'} did not match split time ${gesture.splitTime}`);
    }
    if (gesture.afterClipCount <= gesture.beforeClipCount) {
      failures.push(`blade click did not split the clip: ${gesture.beforeClipCount} -> ${gesture.afterClipCount}`);
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
      mediaSetup,
      synthetic,
      before,
      after,
      gesture,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}
