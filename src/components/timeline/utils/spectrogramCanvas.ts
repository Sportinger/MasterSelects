import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import { timelineRuntimeCoordinator } from '../../../services/timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from '../../../services/timeline/runtimeCoordinatorTypes';
import { resolveSpectrogramCanvasPlan, type SpectrogramCanvasPlan } from './spectrogramRenderPlan';
import { writeTimelineSpectralColor } from './spectralColor';

type SpectrogramRasterCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface TimelineSpectrogramDrawInput {
  tileSet: TimelineSpectrogramTileSet | null;
  x: number;
  y: number;
  clipWidth: number;
  height: number;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  renderStartPx?: number;
  renderWidth?: number;
  dpr?: number;
  cacheKey?: string;
}

export type TimelineSpectrogramSourceVariant = 'source' | 'processed';

export interface TimelineSpectrogramSourceRangeInput {
  variant: TimelineSpectrogramSourceVariant;
  visibleSourceInPoint: number;
  visibleSourceOutPoint: number;
  tileDuration: number;
  visibleStartRatio: number;
  visibleEndRatio: number;
}

export interface TimelineSpectrogramSourceRange {
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
}

export interface TimelineSpectrogramDrawResult {
  drawn: boolean;
  cacheHit: boolean;
  plan?: SpectrogramCanvasPlan;
}

interface SpectrogramRasterCacheEntry {
  canvas: SpectrogramRasterCanvas;
  byteSize: number;
  resourceId: string;
}

const SPECTROGRAM_RASTER_CACHE_ENTRY_LIMIT = 32;
const SPECTROGRAM_RASTER_CACHE_BYTE_LIMIT = 32 * 1024 * 1024;
const spectrogramRasterCache = new Map<string, SpectrogramRasterCacheEntry>();
let spectrogramRasterCacheBytes = 0;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveTimelineSpectrogramSourceRange(
  input: TimelineSpectrogramSourceRangeInput,
): TimelineSpectrogramSourceRange {
  const naturalDuration = Math.max(0.001, positiveFinite(input.tileDuration, 0.001));
  if (input.variant === 'processed') {
    const inPoint = naturalDuration * clamp01(input.visibleStartRatio);
    const outPoint = naturalDuration * clamp01(Math.max(input.visibleStartRatio, input.visibleEndRatio));
    return {
      inPoint,
      outPoint: Math.max(inPoint + 0.001, outPoint),
      naturalDuration,
    };
  }

  const inPoint = Math.max(0, Math.min(naturalDuration, input.visibleSourceInPoint));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, input.visibleSourceOutPoint));
  return {
    inPoint,
    outPoint,
    naturalDuration,
  };
}

function getFrameIndexForTime(tileSet: TimelineSpectrogramTileSet, sourceTime: number): number {
  if (tileSet.frameCount <= 1) return 0;
  const secondsPerFrame = tileSet.hopSize / Math.max(1, tileSet.sampleRate);
  const frameIndex = Math.round(sourceTime / Math.max(0.000001, secondsPerFrame));
  return Math.max(0, Math.min(tileSet.frameCount - 1, frameIndex));
}

function getFrequencyBinForY(tileSet: TimelineSpectrogramTileSet, y: number, height: number): number {
  if (tileSet.frequencyBinCount <= 1) return 0;
  const highToLow = 1 - (y / Math.max(1, height - 1));
  const perceptual = Math.pow(clamp01(highToLow), 2.15);
  return Math.max(0, Math.min(tileSet.frequencyBinCount - 1, Math.round(perceptual * (tileSet.frequencyBinCount - 1))));
}

function createRasterCanvas(width: number, height: number): SpectrogramRasterCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getRasterContext(canvas: SpectrogramRasterCanvas): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { alpha: true }) as unknown as CanvasRenderingContext2D | null;
}

function getDefaultDpr(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

function keyNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(3);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createSpectrogramRasterKey(
  input: TimelineSpectrogramDrawInput,
  plan: SpectrogramCanvasPlan,
): string {
  const tileSet = input.tileSet;
  const base = input.cacheKey ?? [
    'anonymous',
    tileSet?.sampleRate ?? 0,
    tileSet?.duration ?? 0,
    tileSet?.frameCount ?? 0,
    tileSet?.frequencyBinCount ?? 0,
  ].join(':');

  return [
    base,
    keyNumber(input.inPoint),
    keyNumber(input.outPoint),
    keyNumber(input.naturalDuration),
    keyNumber(plan.startPx),
    keyNumber(plan.cssCanvasWidth),
    plan.drawWidth,
    plan.drawHeight,
  ].join('|');
}

function getRasterByteSize(canvas: SpectrogramRasterCanvas): number {
  return Math.max(0, canvas.width * canvas.height * 4);
}

function getRasterImageKind(canvas: SpectrogramRasterCanvas): 'html-canvas' | 'offscreen-canvas' {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    return 'html-canvas';
  }
  return 'offscreen-canvas';
}

function getSpectrogramRasterResourceId(key: string): string {
  return `timeline:spectrogram-raster-cache:${hashString(key)}`;
}

function createSpectrogramRasterResource(
  key: string,
  canvas: SpectrogramRasterCanvas,
  byteSize: number,
  input: TimelineSpectrogramDrawInput,
  plan: SpectrogramCanvasPlan,
): RenderResourceDescriptor {
  const resourceId = getSpectrogramRasterResourceId(key);
  return {
    id: resourceId,
    kind: 'image-canvas',
    policyId: 'interactive',
    owner: {
      ownerId: 'timeline:spectrogram-raster-cache',
      ownerType: 'timeline',
    },
    source: {
      sourceId: input.cacheKey,
    },
    imageKind: getRasterImageKind(canvas),
    imageId: resourceId,
    dimensions: {
      width: plan.drawWidth,
      height: plan.drawHeight,
      durationSeconds: Math.max(0, input.outPoint - input.inPoint),
    },
    memoryCost: {
      heapBytes: byteSize,
    },
    diagnostics: {
      status: 'ok',
    },
    label: 'Timeline spectrogram raster cache',
    tags: ['timeline', 'spectrogram', 'raster-cache'],
  };
}

function releaseRasterCanvas(canvas: SpectrogramRasterCanvas): void {
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Some browser implementations may reject resizing a transferred canvas.
  }
}

function releaseRasterCacheEntry(entry: SpectrogramRasterCacheEntry): void {
  spectrogramRasterCacheBytes -= entry.byteSize;
  timelineRuntimeCoordinator.releaseResource(entry.resourceId);
  releaseRasterCanvas(entry.canvas);
}

function getCachedRaster(key: string): SpectrogramRasterCanvas | null {
  const entry = spectrogramRasterCache.get(key);
  if (!entry) return null;
  spectrogramRasterCache.delete(key);
  spectrogramRasterCache.set(key, entry);
  return entry.canvas;
}

function cacheRaster(
  key: string,
  canvas: SpectrogramRasterCanvas,
  input: TimelineSpectrogramDrawInput,
  plan: SpectrogramCanvasPlan,
): boolean {
  const existing = spectrogramRasterCache.get(key);
  if (existing) {
    releaseRasterCacheEntry(existing);
    spectrogramRasterCache.delete(key);
  }

  const byteSize = getRasterByteSize(canvas);
  const resource = createSpectrogramRasterResource(key, canvas, byteSize, input, plan);
  const admission = timelineRuntimeCoordinator.canRetainResource(resource);
  if (!admission.admitted) {
    return false;
  }

  const entry: SpectrogramRasterCacheEntry = {
    canvas,
    byteSize,
    resourceId: resource.id,
  };
  spectrogramRasterCache.set(key, entry);
  spectrogramRasterCacheBytes += entry.byteSize;
  timelineRuntimeCoordinator.retainResource(resource);

  while (
    spectrogramRasterCache.size > SPECTROGRAM_RASTER_CACHE_ENTRY_LIMIT ||
    spectrogramRasterCacheBytes > SPECTROGRAM_RASTER_CACHE_BYTE_LIMIT
  ) {
    const oldestKey = spectrogramRasterCache.keys().next().value;
    if (!oldestKey || (oldestKey === key && spectrogramRasterCache.size === 1)) break;
    const oldest = spectrogramRasterCache.get(oldestKey);
    if (oldest) {
      releaseRasterCacheEntry(oldest);
    }
    spectrogramRasterCache.delete(oldestKey);
  }

  return true;
}

function rasterizeSpectrogram(
  ctx: CanvasRenderingContext2D,
  tileSet: TimelineSpectrogramTileSet,
  plan: SpectrogramCanvasPlan,
  input: TimelineSpectrogramDrawInput,
): void {
  const channel = tileSet.channels[0];
  if (!channel) return;

  const sourceSpan = Math.max(0.000001, input.outPoint - input.inPoint);
  const visibleInPoint = input.inPoint + sourceSpan * (plan.startPx / Math.max(1, input.clipWidth));
  const visibleOutPoint = input.inPoint + sourceSpan * ((plan.startPx + plan.cssCanvasWidth) / Math.max(1, input.clipWidth));
  const image = ctx.createImageData(plan.drawWidth, plan.drawHeight);
  const pixels = image.data;
  const values = channel.values;
  const binCount = tileSet.frequencyBinCount;
  const tileDuration = positiveFinite(tileSet.duration, input.naturalDuration);
  const binByY = new Int32Array(plan.drawHeight);
  const frameByX = new Int32Array(plan.drawWidth);

  for (let y = 0; y < plan.drawHeight; y += 1) {
    binByY[y] = getFrequencyBinForY(tileSet, y, plan.drawHeight);
  }

  for (let x = 0; x < plan.drawWidth; x += 1) {
    const timeMix = plan.drawWidth <= 1 ? 0 : x / (plan.drawWidth - 1);
    const sourceTime = Math.max(0, Math.min(
      tileDuration,
      visibleInPoint + (visibleOutPoint - visibleInPoint) * timeMix,
    ));
    frameByX[x] = getFrameIndexForTime(tileSet, sourceTime);
  }

  for (let y = 0; y < plan.drawHeight; y += 1) {
    const binIndex = binByY[y] ?? 0;
    const rowOffset = y * plan.drawWidth;
    for (let x = 0; x < plan.drawWidth; x += 1) {
      const frameIndex = frameByX[x] ?? 0;
      const value = values[frameIndex * binCount + binIndex] ?? 0;
      writeTimelineSpectralColor(pixels, (rowOffset + x) * 4, value);
    }
  }

  ctx.putImageData(image, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  const nyquistLineCount = Math.min(8, Math.max(3, Math.floor(input.height / 18)));
  for (let index = 1; index < nyquistLineCount; index += 1) {
    const y = (index / nyquistLineCount) * plan.drawHeight;
    ctx.fillRect(0, Math.round(y), plan.drawWidth, 1);
  }
  ctx.restore();

  if (tileSet.frameCount > 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < plan.drawWidth; x += Math.max(48, Math.floor(plan.drawWidth / 18))) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, plan.drawHeight);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function getOrCreateSpectrogramRaster(
  input: TimelineSpectrogramDrawInput,
  plan: SpectrogramCanvasPlan,
): { canvas: SpectrogramRasterCanvas | null; cacheHit: boolean; transient: boolean } {
  const tileSet = input.tileSet;
  if (!tileSet) return { canvas: null, cacheHit: false, transient: false };

  const cacheKey = createSpectrogramRasterKey(input, plan);
  const cached = getCachedRaster(cacheKey);
  if (cached) return { canvas: cached, cacheHit: true, transient: false };

  const canvas = createRasterCanvas(plan.drawWidth, plan.drawHeight);
  if (!canvas) return { canvas: null, cacheHit: false, transient: false };
  const rasterContext = getRasterContext(canvas);
  if (!rasterContext) {
    releaseRasterCanvas(canvas);
    return { canvas: null, cacheHit: false, transient: false };
  }

  rasterizeSpectrogram(rasterContext, tileSet, plan, input);
  const retained = cacheRaster(cacheKey, canvas, input, plan);
  return { canvas, cacheHit: false, transient: !retained };
}

export function drawTimelineSpectrogram(
  ctx: CanvasRenderingContext2D,
  input: TimelineSpectrogramDrawInput,
): TimelineSpectrogramDrawResult {
  const channel = input.tileSet?.channels[0];
  if (
    !input.tileSet ||
    !channel ||
    input.clipWidth <= 0 ||
    input.height <= 0 ||
    input.naturalDuration <= 0
  ) {
    return { drawn: false, cacheHit: false };
  }

  const plan = resolveSpectrogramCanvasPlan({
    clipWidth: input.clipWidth,
    height: input.height,
    renderStartPx: input.renderStartPx,
    renderWidth: input.renderWidth,
    dpr: input.dpr ?? getDefaultDpr(),
  });
  const { canvas, cacheHit, transient } = getOrCreateSpectrogramRaster(input, plan);
  if (!canvas) return { drawn: false, cacheHit, plan };

  try {
    ctx.drawImage(
      canvas as CanvasImageSource,
      input.x + plan.startPx,
      input.y,
      plan.cssCanvasWidth,
      input.height,
    );
  } finally {
    if (transient) {
      releaseRasterCanvas(canvas);
    }
  }
  return { drawn: true, cacheHit, plan };
}

export function clearTimelineSpectrogramCanvasCache(): void {
  for (const entry of spectrogramRasterCache.values()) {
    releaseRasterCacheEntry(entry);
  }
  spectrogramRasterCache.clear();
  spectrogramRasterCacheBytes = 0;
}
