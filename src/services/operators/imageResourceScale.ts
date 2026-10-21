/**
 * Cache Image (image.materialize) resolution. A cached pass can render at a fraction of the
 * frame (Full, 1/2, 1/4 … 1/1024): later passes sample it with normalized UV, so it reads like
 * a smooth, cheaper copy; at least one pixel is always kept. Glow builds its bloom pyramid from
 * such levels. The value is a structural constant: it decides texture sizes before rendering and
 * cannot be animated.
 */
export const CACHE_IMAGE_MIN_SCALE = 1 / 1024;
export const CACHE_IMAGE_SCALE_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
  .map(divisor => ({ value: String(1 / divisor), label: divisor === 1 ? 'Full' : `1/${divisor}` }));

/** The Resolution constant of a Cache Image node; undefined means full size. */
export function cacheImageScale(constants: Record<string, unknown> | undefined): number | undefined {
  const raw = constants?.scale;
  if (raw === undefined) return undefined;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Cache Image resolution ${String(raw)} is not a positive number.`);
  if (value >= 1) return undefined;
  return Math.max(CACHE_IMAGE_MIN_SCALE, value);
}

/** Pixel size of a materialized pass resource for a frame: Resolution and the motion-analysis edge cap both shrink it. */
export function imageResourceSize(resource: { maxEdge?: number; scale?: number } | undefined, width: number, height: number) {
  const capped = resource?.maxEdge ? Math.min(1, resource.maxEdge / Math.max(width, height)) : 1;
  const scale = Math.min(capped, resource?.scale ?? 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
