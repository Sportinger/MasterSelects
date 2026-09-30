import { prefersSoftwareTimelineCanvas } from './timelineCanvasPlatform';

const MAX_RASTER_BYTES = 32 * 1024 * 1024;
const MAX_RASTER_ENTRIES = 512;
const MAX_BACKING_SIZE = 4096;
const sourceEntries = new WeakMap<object, RasterEntry>();
const objectIds = new WeakMap<object, number>();
const rasters = new Map<RasterEntry, HTMLCanvasElement>();
let nextObjectId = 1;
let rasterBytes = 0;

interface RasterEntry {
  signature: readonly unknown[];
  bytes: number;
}

/** Dependencies use numeric IDs so the LRU never keeps source analysis alive. */
export function getWaveformRasterObjectId(value: object | null | undefined): number {
  if (!value) return 0;
  let id = objectIds.get(value);
  if (id === undefined) { id = nextObjectId++; objectIds.set(value, id); }
  return id;
}

export function drawCachedTimelineWaveformRaster(input: {
  ctx: CanvasRenderingContext2D;
  source: object;
  dependencies: readonly unknown[];
  x: number; top: number; width: number; height: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
}): boolean {
  const { ctx, source, x, top, width, height } = input;
  if (!ctx.canvas || typeof document === 'undefined' || ctx.globalAlpha !== 1
    || ctx.globalCompositeOperation !== 'source-over' || ctx.filter !== 'none'
    || ctx.shadowBlur > 0) return false;
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.ceil(width * dpr);
  const backingHeight = Math.ceil(height * dpr);
  if (!Number.isFinite(backingWidth) || !Number.isFinite(backingHeight)
    || backingWidth <= 0 || backingHeight <= 0 || backingWidth > MAX_BACKING_SIZE || backingHeight > MAX_BACKING_SIZE) return false;
  const bytes = backingWidth * backingHeight * 4;
  if (bytes > MAX_RASTER_BYTES) return false;
  const signature = [width, height, dpr, ...input.dependencies];
  let entry = sourceEntries.get(source);
  let canvas = entry && signature.length === entry.signature.length
    && signature.every((value, index) => Object.is(value, entry!.signature[index]))
    ? rasters.get(entry)
    : undefined;
  if (!canvas) {
    try {
      canvas = document.createElement('canvas');
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      const rasterCtx = canvas.getContext('2d', prefersSoftwareTimelineCanvas() ? { willReadFrequently: true } : undefined);
      if (!rasterCtx) return false;
      rasterCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      input.paint(rasterCtx);
    } catch { return false; }
    if (entry && rasters.has(entry)) {
      const previous = rasters.get(entry)!;
      rasters.delete(entry);
      rasterBytes -= entry.bytes;
      previous.width = 0;
      previous.height = 0;
    }
    entry = { signature, bytes };
    sourceEntries.set(source, entry);
    rasterBytes += bytes;
  } else {
    rasters.delete(entry!);
  }
  rasters.set(entry!, canvas);
  while (rasterBytes > MAX_RASTER_BYTES || rasters.size > MAX_RASTER_ENTRIES) {
    const oldest = rasters.keys().next().value as RasterEntry;
    const discarded = rasters.get(oldest)!;
    rasters.delete(oldest);
    rasterBytes -= oldest.bytes;
    // Release backing pixels immediately instead of waiting for browser GC.
    discarded.width = 0;
    discarded.height = 0;
  }
  ctx.drawImage(canvas, 0, 0, width * dpr, height * dpr, x, top, width, height);
  return true;
}
