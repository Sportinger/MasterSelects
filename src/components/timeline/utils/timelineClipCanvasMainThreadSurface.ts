import { prefersSoftwareTimelineCanvas } from './timelineCanvasPlatform';

export interface TimelineClipCanvasMainThreadSurface {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  resizedBackingStore: boolean;
}

export function prepareTimelineClipCanvasMainThreadSurface(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  height: number,
  canvasOffsetX: number,
): TimelineClipCanvasMainThreadSurface | null {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    // Keep the Linux/Mesa software-raster fallback at the canvas boundary.
    ctx = canvas.getContext('2d', prefersSoftwareTimelineCanvas() ? { willReadFrequently: true } : undefined);
  } catch {
    return null;
  }
  if (!ctx) return null;

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(height * dpr);
  const resizedBackingStore = canvas.width !== targetWidth || canvas.height !== targetHeight;
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const cssWidthStyle = `${cssWidth}px`;
  const cssHeightStyle = `${height}px`;
  const cssLeftStyle = `${canvasOffsetX}px`;
  if (canvas.style.left !== cssLeftStyle) canvas.style.left = cssLeftStyle;
  if (canvas.style.width !== cssWidthStyle) canvas.style.width = cssWidthStyle;
  if (canvas.style.height !== cssHeightStyle) canvas.style.height = cssHeightStyle;
  return { ctx, dpr, resizedBackingStore };
}
