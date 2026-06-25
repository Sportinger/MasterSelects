import type { MathSceneDefinition, TextClipProperties, TimelineClip, TransitionOverlayClipDefinition } from '../../types';
import { markDynamicCanvasUpdated } from '../canvasVersion';
import { getTransitionOverlayCanvas } from '../layerBuilder/transitionOverlayCanvases';
import { mathSceneRenderer } from '../mathScene/MathSceneRenderer';
import { textRenderer } from '../textRenderer';

export interface TimelineGeneratedCanvasDimensions {
  width?: number;
  height?: number;
}

export interface TimelineTextCanvasRuntime {
  canvas: HTMLCanvasElement;
  textProperties: TextClipProperties;
}

const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;

function resolveCanvasDimensions(dimensions?: TimelineGeneratedCanvasDimensions): Required<TimelineGeneratedCanvasDimensions> {
  return {
    width: dimensions?.width || DEFAULT_CANVAS_WIDTH,
    height: dimensions?.height || DEFAULT_CANVAS_HEIGHT,
  };
}

export function getTimelineGeneratedCanvasRuntime(
  clip: Pick<TimelineClip, 'source'> | null | undefined,
): HTMLCanvasElement | null {
  return clip?.source?.textCanvas ?? null;
}

export function getTimelineGeneratedCanvasRuntimeDimensions(
  clip: Pick<TimelineClip, 'source'> | null | undefined,
  fallback?: TimelineGeneratedCanvasDimensions,
): Required<TimelineGeneratedCanvasDimensions> {
  const canvas = getTimelineGeneratedCanvasRuntime(clip);
  return resolveCanvasDimensions({
    width: canvas?.width ?? fallback?.width,
    height: canvas?.height ?? fallback?.height,
  });
}

function getReusableCanvas(
  currentCanvas: HTMLCanvasElement | null | undefined,
  dimensions?: TimelineGeneratedCanvasDimensions,
): HTMLCanvasElement {
  const { width, height } = resolveCanvasDimensions(dimensions);
  if (currentCanvas && currentCanvas.width === width && currentCanvas.height === height) {
    return currentCanvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createTimelineMathSceneCanvasRuntime(params: {
  mathScene: MathSceneDefinition;
  duration: number;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const { width, height } = resolveCanvasDimensions(params.dimensions);
  const canvas = mathSceneRenderer.createCanvas(width, height);
  mathSceneRenderer.render(params.mathScene, canvas, 0, params.duration);
  return canvas;
}

export async function createTimelineTextCanvasRuntime(params: {
  textProperties: TextClipProperties;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): Promise<TimelineTextCanvasRuntime> {
  const { width, height } = resolveCanvasDimensions(params.dimensions);
  const [
    { textRenderer },
    { googleFontsService },
    { createTextBoundsFromRect, resolveTextBoxRect },
  ] = await Promise.all([
    import('../textRenderer'),
    import('../googleFontsService'),
    import('../textLayout'),
  ]);

  const textProperties = structuredClone(params.textProperties);
  if (textProperties.textBounds?.vertices?.length) {
    textProperties.boxEnabled = true;
  } else if (textProperties.boxEnabled) {
    const box = resolveTextBoxRect(textProperties, width, height);
    textProperties.textBounds = createTextBoundsFromRect(
      box,
      width,
      height,
      undefined,
      { clampToCanvas: false },
    );
  }

  await googleFontsService.loadFont(textProperties.fontFamily, textProperties.fontWeight);
  const canvas = textRenderer.createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  textRenderer.render(textProperties, canvas);

  return { canvas, textProperties };
}

export function renderTimelineTextCanvasRuntime(params: {
  textProperties: TextClipProperties;
  currentCanvas?: HTMLCanvasElement | null;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const { width, height } = resolveCanvasDimensions(params.dimensions);
  const canvas = params.currentCanvas &&
    params.currentCanvas.width === width &&
    params.currentCanvas.height === height
    ? params.currentCanvas
    : textRenderer.createCanvas(width, height);

  textRenderer.render(params.textProperties, canvas);
  return canvas;
}

export function createTimelineSolidCanvasRuntime(params: {
  color: string;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const canvas = getReusableCanvas(null, params.dimensions);

  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = params.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  markDynamicCanvasUpdated(canvas, 'solid');

  return canvas;
}

export function createTimelineTransitionOverlayCanvasRuntime(params: {
  overlay: TransitionOverlayClipDefinition;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const canvas = getTransitionOverlayCanvas({
    pattern: params.overlay.pattern,
    color: params.overlay.color,
    centerX: 0.5,
    widthRatio: params.overlay.widthRatio,
    softness: params.overlay.softness,
    angle: params.overlay.angle,
    outputSize: resolveCanvasDimensions(params.dimensions),
  });

  if (canvas) return canvas;
  const fallback = getReusableCanvas(null, params.dimensions);
  markDynamicCanvasUpdated(fallback, 'transition-overlay');
  return fallback;
}

export function renderTimelineSolidCanvasRuntime(params: {
  color: string;
  currentCanvas?: HTMLCanvasElement | null;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const canvas = getReusableCanvas(params.currentCanvas, params.dimensions);
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = params.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  markDynamicCanvasUpdated(canvas, 'solid');
  return canvas;
}

export function renderTimelineMathSceneCanvasRuntime(params: {
  mathScene: MathSceneDefinition;
  currentCanvas?: HTMLCanvasElement | null;
  localTime: number;
  duration: number;
  dimensions?: TimelineGeneratedCanvasDimensions;
}): HTMLCanvasElement {
  const { width, height } = resolveCanvasDimensions(params.dimensions);
  const canvas = params.currentCanvas &&
    params.currentCanvas.width === width &&
    params.currentCanvas.height === height
    ? params.currentCanvas
    : mathSceneRenderer.createCanvas(width, height);

  mathSceneRenderer.render(params.mathScene, canvas, params.localTime, params.duration);
  return canvas;
}
