import type { TransitionOverlayPattern } from '../../transitions';

export interface TransitionOverlayCanvasSize {
  width: number;
  height: number;
}

interface OverlayCacheEntry {
  canvas: HTMLCanvasElement;
  pixels: number;
}

interface TransitionOverlayCanvasInput {
  pattern: TransitionOverlayPattern;
  color: string;
  centerX: number;
  widthRatio: number;
  softness: number;
  angle: number;
  outputSize?: TransitionOverlayCanvasSize;
}

const DEFAULT_OVERLAY_SIZE: TransitionOverlayCanvasSize = { width: 512, height: 288 };
const MAX_OVERLAY_RENDER_DIMENSION = 960;
const MAX_OVERLAY_CACHE_PIXELS = 8192 * 8192;
const overlayCanvasCache = new Map<string, OverlayCacheEntry>();
let overlayCanvasCachePixels = 0;

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function normalizeOutputSize(outputSize: TransitionOverlayCanvasSize | undefined): TransitionOverlayCanvasSize {
  const rawWidth = Math.round(outputSize?.width ?? DEFAULT_OVERLAY_SIZE.width);
  const rawHeight = Math.round(outputSize?.height ?? DEFAULT_OVERLAY_SIZE.height);
  const width = Math.max(1, Number.isFinite(rawWidth) ? rawWidth : DEFAULT_OVERLAY_SIZE.width);
  const height = Math.max(1, Number.isFinite(rawHeight) ? rawHeight : DEFAULT_OVERLAY_SIZE.height);
  const scale = Math.min(1, MAX_OVERLAY_RENDER_DIMENSION / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function parseHexColor(color: string): { r: number; g: number; b: number } {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color.slice(1) : 'ffffff';
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toRgba(color: string, alpha: number): string {
  const { r, g, b } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

function makeCanvas(size: TransitionOverlayCanvasSize): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

function readCachedCanvas(cacheKey: string): HTMLCanvasElement | null {
  const cached = overlayCanvasCache.get(cacheKey);
  if (!cached) return null;

  overlayCanvasCache.delete(cacheKey);
  overlayCanvasCache.set(cacheKey, cached);
  return cached.canvas;
}

function rememberCanvas(cacheKey: string, canvas: HTMLCanvasElement): void {
  const pixels = canvas.width * canvas.height;

  while (
    overlayCanvasCache.size > 0 &&
    overlayCanvasCachePixels + pixels > MAX_OVERLAY_CACHE_PIXELS
  ) {
    const oldestKey = overlayCanvasCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = overlayCanvasCache.get(oldestKey);
    overlayCanvasCache.delete(oldestKey);
    overlayCanvasCachePixels -= oldest?.pixels ?? 0;
  }

  overlayCanvasCache.set(cacheKey, { canvas, pixels });
  overlayCanvasCachePixels += pixels;
}

function buildLightSweepCanvas(
  cacheKey: string,
  size: TransitionOverlayCanvasSize,
  color: string,
  centerX: number,
  bandWidthRatio: number,
  softness: number,
  angle: number,
): HTMLCanvasElement | null {
  const canvas = makeCanvas(size);
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;

  const span = Math.max(canvas.width, canvas.height) * 1.8;
  const halfBandWidth = Math.max(10, Math.min(canvas.width, canvas.height) * Math.max(0.02, Math.min(0.8, bandWidthRatio)));
  const shoulder = Math.max(0.04, Math.min(0.48, softness));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width * centerX, canvas.height * 0.5);
  context.rotate(angle);

  const glow = context.createLinearGradient(-halfBandWidth, 0, halfBandWidth, 0);
  glow.addColorStop(0, toRgba(color, 0));
  glow.addColorStop(Math.max(0.02, 0.5 - shoulder), toRgba(color, 0.12));
  glow.addColorStop(0.5, toRgba(color, 0.95));
  glow.addColorStop(Math.min(0.98, 0.5 + shoulder), toRgba(color, 0.12));
  glow.addColorStop(1, toRgba(color, 0));
  context.fillStyle = glow;
  context.fillRect(-halfBandWidth, -span, halfBandWidth * 2, span * 2);

  const coreWidth = Math.max(3, halfBandWidth * 0.14);
  const core = context.createLinearGradient(-coreWidth, 0, coreWidth, 0);
  core.addColorStop(0, toRgba('#ffffff', 0));
  core.addColorStop(0.5, toRgba('#ffffff', 0.78));
  core.addColorStop(1, toRgba('#ffffff', 0));
  context.fillStyle = core;
  context.fillRect(-coreWidth, -span, coreWidth * 2, span * 2);
  context.restore();

  rememberCanvas(cacheKey, canvas);
  return canvas;
}

function buildLightLeakCanvas(
  cacheKey: string,
  size: TransitionOverlayCanvasSize,
  color: string,
  centerX: number,
  bandWidthRatio: number,
  softness: number,
  angle: number,
): HTMLCanvasElement | null {
  const canvas = makeCanvas(size);
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);

  const leakCenterX = canvas.width * centerX;
  const leakWidth = canvas.width * Math.max(0.08, Math.min(0.75, bandWidthRatio));
  const span = Math.max(canvas.width, canvas.height) * 1.8;
  const shoulder = Math.max(0.06, Math.min(0.5, softness));

  context.save();
  context.translate(leakCenterX, canvas.height * 0.5);
  context.rotate(angle);

  const edgeGradient = context.createLinearGradient(-leakWidth, 0, leakWidth, 0);
  edgeGradient.addColorStop(0, toRgba(color, 0));
  edgeGradient.addColorStop(Math.max(0.05, 0.34 - shoulder * 0.25), toRgba(color, 0.1));
  edgeGradient.addColorStop(0.5, toRgba(color, 0.58));
  edgeGradient.addColorStop(Math.min(0.95, 0.66 + shoulder * 0.25), toRgba(color, 0.08));
  edgeGradient.addColorStop(1, toRgba(color, 0));
  context.fillStyle = edgeGradient;
  context.fillRect(-leakWidth, -span, leakWidth * 2, span * 2);

  const streakGradient = context.createLinearGradient(-leakWidth * 0.58, 0, leakWidth * 0.58, 0);
  streakGradient.addColorStop(0, toRgba('#ffffff', 0));
  streakGradient.addColorStop(0.5, toRgba('#fff2c8', 0.13));
  streakGradient.addColorStop(1, toRgba('#ffffff', 0));
  context.fillStyle = streakGradient;
  context.fillRect(-leakWidth * 0.58, -span, leakWidth * 1.16, span * 2);

  for (const [x, y, width, alpha] of [
    [-0.18, -0.34, 0.22, 0.1],
    [0.08, -0.08, 0.14, 0.12],
    [0.2, 0.3, 0.2, 0.08],
  ] as const) {
    context.fillStyle = toRgba('#fff0bd', alpha);
    context.fillRect(leakWidth * x, canvas.height * y, leakWidth * width, Math.max(1, canvas.height * 0.012));
  }
  context.restore();

  for (const [xOffset, yRatio, radius, whiteAlpha, colorAlpha] of [
    [0.02, 0.16, 0.34, 0.2, 0.2],
    [0.22, 0.5, 0.22, 0.12, 0.16],
    [-0.1, 0.78, 0.18, 0.1, 0.12],
  ] as const) {
    const glowX = leakCenterX + leakWidth * xOffset;
    const glowY = canvas.height * yRatio;
    const glowRadius = Math.max(canvas.width, canvas.height) * radius;
    const glow = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
    glow.addColorStop(0, toRgba('#fff8d6', whiteAlpha));
    glow.addColorStop(0.38, toRgba(color, colorAlpha));
    glow.addColorStop(1, toRgba(color, 0));
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  rememberCanvas(cacheKey, canvas);
  return canvas;
}

function buildFilmBurnCanvas(
  cacheKey: string,
  size: TransitionOverlayCanvasSize,
  color: string,
  centerX: number,
  bandWidthRatio: number,
  softness: number,
  angle: number,
): HTMLCanvasElement | null {
  const canvas = makeCanvas(size);
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;

  const burnCenterX = canvas.width * centerX;
  const burnWidth = canvas.width * Math.max(0.08, Math.min(0.72, bandWidthRatio));
  const shoulder = Math.max(0.04, Math.min(0.45, softness));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(burnCenterX, canvas.height * 0.5);
  context.rotate(angle);

  const edge = context.createLinearGradient(-burnWidth, 0, burnWidth, 0);
  edge.addColorStop(0, toRgba(color, 0));
  edge.addColorStop(Math.max(0.03, 0.24 - shoulder * 0.2), toRgba(color, 0.32));
  edge.addColorStop(0.46, toRgba('#ffd38a', 0.88));
  edge.addColorStop(0.52, toRgba('#ffffff', 0.82));
  edge.addColorStop(Math.min(0.96, 0.74 + shoulder * 0.2), toRgba(color, 0.28));
  edge.addColorStop(1, toRgba(color, 0));
  context.fillStyle = edge;
  context.fillRect(-burnWidth, -canvas.height, burnWidth * 2, canvas.height * 2);

  const hotCore = context.createRadialGradient(
    0,
    -canvas.height * 0.08,
    0,
    0,
    -canvas.height * 0.08,
    Math.max(canvas.width, canvas.height) * 0.32,
  );
  hotCore.addColorStop(0, toRgba('#ffffff', 0.42));
  hotCore.addColorStop(0.34, toRgba('#fff0aa', 0.3));
  hotCore.addColorStop(1, toRgba(color, 0));
  context.fillStyle = hotCore;
  context.fillRect(-burnWidth, -canvas.height, burnWidth * 2, canvas.height * 2);

  for (const [offsetY, radius, alpha] of [
    [-0.34, 0.12, 0.28],
    [-0.12, 0.08, 0.2],
    [0.22, 0.14, 0.24],
    [0.38, 0.07, 0.18],
  ] as const) {
    const spot = context.createRadialGradient(
      burnWidth * 0.12,
      canvas.height * offsetY,
      0,
      burnWidth * 0.12,
      canvas.height * offsetY,
      Math.max(canvas.width, canvas.height) * radius,
    );
    spot.addColorStop(0, toRgba('#ffffff', alpha));
    spot.addColorStop(0.5, toRgba(color, alpha * 0.8));
    spot.addColorStop(1, toRgba(color, 0));
    context.fillStyle = spot;
    context.fillRect(-burnWidth, -canvas.height, burnWidth * 2, canvas.height * 2);
  }
  context.restore();

  rememberCanvas(cacheKey, canvas);
  return canvas;
}

function buildLensFlareCanvas(
  cacheKey: string,
  size: TransitionOverlayCanvasSize,
  color: string,
  centerX: number,
  bandWidthRatio: number,
  softness: number,
  angle: number,
): HTMLCanvasElement | null {
  const canvas = makeCanvas(size);
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;

  const flareX = canvas.width * centerX;
  const flareY = canvas.height * (0.42 + Math.sin(centerX * Math.PI) * 0.08);
  const flareRadius = Math.max(canvas.width, canvas.height) * Math.max(0.08, Math.min(0.42, bandWidthRatio));
  const streakHeight = Math.max(3, canvas.height * Math.max(0.015, softness * 0.09));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(flareX, flareY);
  context.rotate(angle);

  const streak = context.createLinearGradient(-canvas.width, 0, canvas.width, 0);
  streak.addColorStop(0, toRgba(color, 0));
  streak.addColorStop(0.42, toRgba(color, 0.18));
  streak.addColorStop(0.5, toRgba('#ffffff', 0.82));
  streak.addColorStop(0.58, toRgba(color, 0.18));
  streak.addColorStop(1, toRgba(color, 0));
  context.fillStyle = streak;
  context.fillRect(-canvas.width, -streakHeight * 0.5, canvas.width * 2, streakHeight);
  context.restore();

  const core = context.createRadialGradient(flareX, flareY, 0, flareX, flareY, flareRadius);
  core.addColorStop(0, toRgba('#ffffff', 0.7));
  core.addColorStop(0.28, toRgba(color, 0.35));
  core.addColorStop(1, toRgba(color, 0));
  context.fillStyle = core;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const [offset, radius, alpha] of [
    [-0.48, 0.12, 0.24],
    [-0.24, 0.06, 0.3],
    [0.28, 0.09, 0.24],
    [0.55, 0.045, 0.22],
  ] as const) {
    const ghostX = flareX + canvas.width * offset;
    const ghostY = flareY + canvas.height * offset * 0.16;
    const ghostRadius = Math.max(canvas.width, canvas.height) * radius;
    const ghost = context.createRadialGradient(ghostX, ghostY, 0, ghostX, ghostY, ghostRadius);
    ghost.addColorStop(0, toRgba('#ffffff', alpha));
    ghost.addColorStop(0.5, toRgba(color, alpha * 0.65));
    ghost.addColorStop(1, toRgba(color, 0));
    context.fillStyle = ghost;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  rememberCanvas(cacheKey, canvas);
  return canvas;
}

function buildChromaLeakCanvas(
  cacheKey: string,
  size: TransitionOverlayCanvasSize,
  color: string,
  centerX: number,
  bandWidthRatio: number,
  softness: number,
  angle: number,
): HTMLCanvasElement | null {
  const canvas = makeCanvas(size);
  const context = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !context) return null;

  const leakCenterX = canvas.width * centerX;
  const leakWidth = canvas.width * Math.max(0.08, Math.min(0.78, bandWidthRatio));
  const shoulder = Math.max(0.05, Math.min(0.5, softness));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(leakCenterX, canvas.height * 0.5);
  context.rotate(angle);

  const magenta = context.createLinearGradient(-leakWidth, 0, leakWidth, 0);
  magenta.addColorStop(0, toRgba(color, 0));
  magenta.addColorStop(Math.max(0.04, 0.34 - shoulder * 0.2), toRgba(color, 0.34));
  magenta.addColorStop(0.5, toRgba(color, 0.82));
  magenta.addColorStop(Math.min(0.96, 0.66 + shoulder * 0.2), toRgba('#34e7ff', 0.3));
  magenta.addColorStop(1, toRgba('#34e7ff', 0));
  context.fillStyle = magenta;
  context.fillRect(-leakWidth, -canvas.height, leakWidth * 2, canvas.height * 2);

  const cyan = context.createLinearGradient(-leakWidth * 0.7, 0, leakWidth * 0.95, 0);
  cyan.addColorStop(0, toRgba('#34e7ff', 0));
  cyan.addColorStop(0.48, toRgba('#34e7ff', 0.48));
  cyan.addColorStop(0.56, toRgba('#ffffff', 0.28));
  cyan.addColorStop(1, toRgba('#34e7ff', 0));
  context.fillStyle = cyan;
  context.fillRect(-leakWidth, -canvas.height * 0.76, leakWidth * 2, canvas.height * 1.52);

  for (const y of [-0.32, -0.12, 0.18, 0.36]) {
    context.fillStyle = y < 0 ? toRgba('#34e7ff', 0.22) : toRgba(color, 0.2);
    context.fillRect(-leakWidth * 0.68, canvas.height * y, leakWidth * 1.36, Math.max(2, canvas.height * 0.018));
  }
  context.restore();

  rememberCanvas(cacheKey, canvas);
  return canvas;
}

export function getTransitionOverlayCanvas({
  pattern,
  color,
  centerX,
  widthRatio,
  softness,
  angle,
  outputSize,
}: TransitionOverlayCanvasInput): HTMLCanvasElement | null {
  const size = normalizeOutputSize(outputSize);
  const centerResolution = pattern === 'light-sweep' ? 240 : 180;
  const roundedCenter = Math.round(centerX * centerResolution) / centerResolution;
  const roundedWidth = Math.round(widthRatio * 1000) / 1000;
  const roundedSoftness = Math.round(softness * 1000) / 1000;
  const roundedAngle = Math.round(angle * 1000) / 1000;
  const cacheKey = [
    pattern,
    color,
    size.width,
    size.height,
    roundedCenter,
    roundedWidth,
    roundedSoftness,
    roundedAngle,
  ].join(':');

  const cached = readCachedCanvas(cacheKey);
  if (cached) return cached;

  if (pattern === 'light-sweep') {
    return buildLightSweepCanvas(
      cacheKey,
      size,
      color,
      roundedCenter,
      roundedWidth,
      roundedSoftness,
      roundedAngle,
    );
  }

  if (pattern === 'film-burn') {
    return buildFilmBurnCanvas(
      cacheKey,
      size,
      color,
      roundedCenter,
      roundedWidth,
      roundedSoftness,
      roundedAngle,
    );
  }

  if (pattern === 'lens-flare') {
    return buildLensFlareCanvas(
      cacheKey,
      size,
      color,
      roundedCenter,
      roundedWidth,
      roundedSoftness,
      roundedAngle,
    );
  }

  if (pattern === 'chroma-leak') {
    return buildChromaLeakCanvas(
      cacheKey,
      size,
      color,
      roundedCenter,
      roundedWidth,
      roundedSoftness,
      roundedAngle,
    );
  }

  return buildLightLeakCanvas(
    cacheKey,
    size,
    color,
    roundedCenter,
    roundedWidth,
    roundedSoftness,
    roundedAngle,
  );
}
