import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import {
  applyWorkerSoftwarePixelEffects,
  hasWorkerSoftwarePixelEffects,
} from './workerSoftwarePixelEffects';
import { applyWorkerSoftwareTransitionMask } from './workerSoftwareTransitionMasks';
import type { WorkerSoftwareFeedbackStore } from './workerSoftwareFeedbackEffects';
import { calculateSourcePixelScale } from '../../utils/sourcePixelScale';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  const finite = finiteNumber(value, fallback);
  return finite > 0 ? finite : fallback;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getLayerFootprint(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly scale: { readonly x: number; readonly y: number };
}): {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
} {
  const sourceWidth = positiveNumber(input.sourceWidth, input.targetWidth);
  const sourceHeight = positiveNumber(input.sourceHeight, input.targetHeight);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = input.targetWidth / input.targetHeight;
  const aspectRatio = sourceAspect / targetAspect;
  const sourcePixelScale = calculateSourcePixelScale(
    sourceWidth,
    sourceHeight,
    input.targetWidth,
    input.targetHeight,
  );
  const scaleX = finiteNumber(input.scale.x, 1) * sourcePixelScale;
  const scaleY = finiteNumber(input.scale.y, 1) * sourcePixelScale;
  let localPositionX = finiteNumber(input.position.x, 0);
  let localPositionY = finiteNumber(input.position.y, 0);
  let width = input.targetWidth;
  let height = input.targetHeight;

  if (aspectRatio > 1) {
    height = input.targetWidth / sourceAspect;
    localPositionY /= aspectRatio;
  } else {
    width = input.targetHeight * sourceAspect;
    localPositionX *= aspectRatio;
  }

  return {
    centerX: (0.5 + localPositionX * scaleX) * input.targetWidth,
    centerY: (0.5 + localPositionY * scaleY) * input.targetHeight,
    width,
    height,
    scaleX,
    scaleY,
  };
}

function needsScratchSurface(layer: WorkerRenderSoftwareFrame['layers'][number]): boolean {
  return layer.source.kind === 'adjustment'
    || hasWorkerSoftwarePixelEffects(layer)
    || Boolean(layer.transition);
}

function createScratchSurface(width: number, height: number): {
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
} | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context ? { canvas, context } : null;
}

function drawLayerSource(
  context: OffscreenCanvasRenderingContext2D,
  layer: WorkerRenderSoftwareFrame['layers'][number],
  width: number,
  height: number,
): void {
  if (layer.source.kind === 'solid') {
    context.fillStyle = layer.source.color;
    context.fillRect(0, 0, width, height);
    return;
  }
  if (layer.source.kind !== 'bitmap') return;

  const rect = layer.geometry.sourceRect;
  const sx = clampUnit(rect.x) * layer.source.width;
  const sy = clampUnit(rect.y) * layer.source.height;
  const sw = Math.max(1, clampUnit(rect.width) * layer.source.width);
  const sh = Math.max(1, clampUnit(rect.height) * layer.source.height);
  context.drawImage(layer.source.bitmap, sx, sy, sw, sh, 0, 0, width, height);
}

export function drawWorkerSoftwareLayer(
  context: OffscreenCanvasRenderingContext2D,
  layer: WorkerRenderSoftwareFrame['layers'][number],
  targetWidth: number,
  targetHeight: number,
  timelineTime = 0,
  feedbackStore?: WorkerSoftwareFeedbackStore,
  feedbackScopeId = 'default',
): void {
  if (layer.source.kind === 'adjustment') {
    const scratch = createScratchSurface(targetWidth, targetHeight);
    if (!scratch) return;
    scratch.context.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    scratch.context.drawImage(
      context.canvas,
      0,
      0,
      targetWidth,
      targetHeight,
    );
    applyWorkerSoftwarePixelEffects(
      scratch.context,
      scratch.canvas.width,
      scratch.canvas.height,
      layer,
      timelineTime,
      feedbackStore,
      feedbackScopeId,
    );
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    context.globalCompositeOperation = layer.compositeOperation;
    context.filter = layer.filter;
    context.drawImage(scratch.canvas, 0, 0, targetWidth, targetHeight);
    context.restore();
    return;
  }

  const isFullFrameSource = layer.source.kind === 'solid';
  const sourceWidth = isFullFrameSource ? targetWidth : layer.source.width;
  const sourceHeight = isFullFrameSource ? targetHeight : layer.source.height;
  const footprint = getLayerFootprint({
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    position: layer.geometry.position,
    scale: layer.geometry.scale,
  });
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
  context.globalCompositeOperation = layer.compositeOperation;
  context.filter = layer.filter;
  context.translate(footprint.centerX, footprint.centerY);
  context.rotate(-finiteNumber(layer.geometry.rotation, 0));
  context.scale(footprint.scaleX, footprint.scaleY);

  if (needsScratchSurface(layer)) {
    const scratch = createScratchSurface(footprint.width, footprint.height);
    if (scratch) {
      scratch.context.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
      drawLayerSource(scratch.context, layer, scratch.canvas.width, scratch.canvas.height);
      applyWorkerSoftwarePixelEffects(
        scratch.context,
        scratch.canvas.width,
        scratch.canvas.height,
        layer,
        timelineTime,
        feedbackStore,
        feedbackScopeId,
      );
      applyWorkerSoftwareTransitionMask(
        scratch.context,
        scratch.canvas.width,
        scratch.canvas.height,
        layer.transition,
      );
      context.drawImage(
        scratch.canvas,
        -footprint.width / 2,
        -footprint.height / 2,
        footprint.width,
        footprint.height,
      );
      context.restore();
      return;
    }
  }

  if (layer.source.kind === 'solid') {
    context.fillStyle = layer.source.color;
    context.fillRect(-footprint.width / 2, -footprint.height / 2, footprint.width, footprint.height);
  } else {
    if (layer.source.kind !== 'bitmap') {
      context.restore();
      return;
    }
    const rect = layer.geometry.sourceRect;
    const sx = clampUnit(rect.x) * layer.source.width;
    const sy = clampUnit(rect.y) * layer.source.height;
    const sw = Math.max(1, clampUnit(rect.width) * layer.source.width);
    const sh = Math.max(1, clampUnit(rect.height) * layer.source.height);
    context.drawImage(
      layer.source.bitmap,
      sx,
      sy,
      sw,
      sh,
      -footprint.width / 2,
      -footprint.height / 2,
      footprint.width,
      footprint.height,
    );
  }
  context.restore();
}

export function forEachWorkerSoftwareLayerInPaintOrder(
  frame: WorkerRenderSoftwareFrame,
  paint: (layer: WorkerRenderSoftwareFrame['layers'][number]) => void,
): void {
  for (let index = frame.layers.length - 1; index >= 0; index -= 1) {
    const layer = frame.layers[index];
    if (!layer || !layer.visible || layer.opacity <= 0) continue;
    paint(layer);
  }
}

export function closeWorkerSoftwareFrameBitmaps(frame: WorkerRenderSoftwareFrame): void {
  for (const layer of frame.layers) {
    if (layer.source.kind !== 'bitmap') continue;
    if (layer.source.retained) continue;
    try {
      layer.source.bitmap.close();
    } catch {
      // Ignore cleanup errors for already-detached frame payloads.
    }
  }
}
