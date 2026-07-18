// Preview & Frame Capture Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import { captureFrameGrid } from '../utils';
import { flashPreviewCanvas } from '../aiFeedback';
import { ensureRenderForDiagnostics } from './renderOnce';
import {
  captureRenderHostFrame,
  type PreviewCaptureMode,
} from '../previewCapture';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleCaptureFrame(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const time = args.time as number | undefined;
  const mode = (args.mode as PreviewCaptureMode | undefined) ?? 'auto';

  // If time specified, move playhead there first
  if (time !== undefined) {
    timelineStore.setPlayheadPosition(time);
    // Wait a frame for render to update
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const renderDiagnostics = await ensureRenderForDiagnostics();

  // Visual feedback: shutter flash on preview
  flashPreviewCanvas('shutter');

  const capture = await captureRenderHostFrame(mode);
  if (!capture.success) {
    return {
      success: false,
      error: capture.error,
      data: {
        requestedMode: mode,
        renderDiagnostics,
      },
    };
  }

  return {
    success: true,
    data: {
      capturedAt: time ?? timelineStore.playheadPosition,
      width: capture.width,
      height: capture.height,
      mode: capture.mode,
      requestedMode: mode,
      ...(capture.canvasSource ? { canvasSource: capture.canvasSource } : {}),
      renderDiagnostics,
      dataUrl: capture.dataUrl,
    },
  };
}

export async function handleGetCutPreviewQuad(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const cutTime = args.cutTime as number;
  const frameSpacing = (args.frameSpacing as number) || 0.1;
  const mode = args.mode === 'dom' || args.mode === 'gpu' || args.mode === 'auto'
    ? args.mode
    : 'auto';

  // Generate 8 timestamps: 4 before cut, 4 after cut
  const times: number[] = [];
  // Before: -4, -3, -2, -1 spacing from cut
  for (let i = 4; i >= 1; i--) {
    times.push(cutTime - (i * frameSpacing));
  }
  // After: +0, +1, +2, +3 spacing from cut (starting right at cut)
  for (let i = 0; i < 4; i++) {
    times.push(cutTime + (i * frameSpacing));
  }

  // Capture frames and create grid
  const gridResult = await captureFrameGrid(times, 4, timelineStore, { mode });
  if (!gridResult.success) {
    return gridResult;
  }

  return {
    success: true,
    data: {
      cutTime,
      frameSpacing,
      frameTimes: times,
      mode,
      description: 'Top row: 4 frames BEFORE cut. Bottom row: 4 frames AFTER cut (starting at cut point).',
      ...(gridResult.data ?? {}),
    },
  };
}

export async function handleGetFramesAtTimes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const times = Array.isArray(args.times)
    ? args.times.filter((time): time is number => typeof time === 'number' && Number.isFinite(time)).slice(0, 8)
    : [];
  if (times.length === 0) {
    return { success: false, error: 'Provide at least one finite frame time.' };
  }
  const requestedColumns = typeof args.columns === 'number' && Number.isFinite(args.columns)
    ? Math.round(args.columns)
    : 4;
  const columns = Math.max(1, Math.min(times.length, requestedColumns));
  const settleMs = typeof args.settleMs === 'number' ? args.settleMs : undefined;
  const mode = args.mode === 'dom' || args.mode === 'gpu' || args.mode === 'auto'
    ? args.mode
    : 'auto';

  const gridResult = await captureFrameGrid(times, columns, timelineStore, { settleMs, mode });
  if (!gridResult.success) {
    return gridResult;
  }

  return {
    success: true,
    data: {
      frameTimes: times,
      columns,
      settleMs: settleMs ?? 140,
      mode,
      ...(gridResult.data ?? {}),
    },
  };
}
