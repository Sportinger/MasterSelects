// Preview & Frame Capture Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import { engine } from '../../../engine/WebGPUEngine';
import type { ToolResult } from '../types';
import { captureFrameGrid } from '../utils';
import { flashPreviewCanvas } from '../aiFeedback';
import { ensureRenderForDiagnostics } from './renderOnce';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

function getCaptureCanvas(): { canvas: HTMLCanvasElement; source: string } | null {
  const engineState = engine as unknown as {
    mainPreviewCanvas?: HTMLCanvasElement | null;
    targetCanvases?: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  };

  const mainPreviewCanvas = engineState.mainPreviewCanvas;
  if (mainPreviewCanvas && mainPreviewCanvas.width > 0 && mainPreviewCanvas.height > 0) {
    return { canvas: mainPreviewCanvas, source: 'mainPreviewCanvas' };
  }

  const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
  for (const target of activeTargets) {
    if (target.canvas && target.canvas.width > 0 && target.canvas.height > 0) {
      return { canvas: target.canvas, source: `renderTarget:${target.id}` };
    }
  }

  const targetCanvases = engineState.targetCanvases;
  if (targetCanvases) {
    for (const [targetId, entry] of targetCanvases) {
      if (entry.canvas.width > 0 && entry.canvas.height > 0) {
        return { canvas: entry.canvas, source: `engineTarget:${targetId}` };
      }
    }
  }

  return null;
}

export async function handleCaptureFrame(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const time = args.time as number | undefined;
  const mode = (args.mode as 'gpu' | 'dom' | undefined) ?? 'gpu';

  // If time specified, move playhead there first
  if (time !== undefined) {
    timelineStore.setPlayheadPosition(time);
    // Wait a frame for render to update
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const renderDiagnostics = await ensureRenderForDiagnostics();

  // Visual feedback: shutter flash on preview
  flashPreviewCanvas('shutter');

  let width: number;
  let height: number;
  let dataUrl: string;
  let canvasSource: string | undefined;

  if (mode === 'dom') {
    const captureCanvas = getCaptureCanvas();
    if (!captureCanvas) {
      return { success: false, error: 'Failed to capture frame - preview canvas not available' };
    }
    const previewCanvas = captureCanvas.canvas;
    width = previewCanvas.width;
    height = previewCanvas.height;
    dataUrl = previewCanvas.toDataURL('image/png');
    canvasSource = captureCanvas.source;
  } else {
    const pixels = await engine.readPixels();
    if (!pixels) {
      return { success: false, error: 'Failed to capture frame - engine not ready' };
    }

    ({ width, height } = engine.getOutputDimensions());

    // Convert to PNG using canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { success: false, error: 'Failed to create canvas context' };
    }

    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(imageData, 0, 0);
    dataUrl = canvas.toDataURL('image/png');
  }

  return {
    success: true,
    data: {
      capturedAt: time ?? timelineStore.playheadPosition,
      width,
      height,
      mode,
      ...(canvasSource ? { canvasSource } : {}),
      renderDiagnostics,
      dataUrl,
    },
  };
}

export async function handleGetCutPreviewQuad(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const cutTime = args.cutTime as number;
  const frameSpacing = (args.frameSpacing as number) || 0.1;

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
  const gridResult = await captureFrameGrid(times, 4, timelineStore);
  if (!gridResult.success) {
    return gridResult;
  }

  return {
    success: true,
    data: {
      cutTime,
      frameSpacing,
      frameTimes: times,
      description: 'Top row: 4 frames BEFORE cut. Bottom row: 4 frames AFTER cut (starting at cut point).',
      ...(gridResult.data ?? {}),
    },
  };
}

export async function handleGetFramesAtTimes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const times = (args.times as number[]).slice(0, 8); // Max 8 frames
  const columns = (args.columns as number) || 4;

  const gridResult = await captureFrameGrid(times, columns, timelineStore);
  if (!gridResult.success) {
    return gridResult;
  }

  return {
    success: true,
    data: {
      frameTimes: times,
      columns,
      ...(gridResult.data ?? {}),
    },
  };
}
