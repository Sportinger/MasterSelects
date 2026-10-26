import { getEffect } from '..';
import type { LookDefinition } from './types';
import type { ThumbnailRect } from './lookThumbnailGeometry';

/**
 * The CPU half of a Look / effect tile (lookThumbnailRuntime.ts renders, this decides what the tile shows).
 *
 * Effects are built for the output resolution: their lines, masks, grain and glyph cells are sized
 * relative to the frame and fade out below a few pixels instead of aliasing. Rendered straight into a
 * 256x144 tile, Scanlines, CRT Screen or the tube of Analog Signal Lab therefore drew (correctly) almost
 * nothing. The runtime renders the stack at a working resolution close to the output instead and builds
 * two views of the result: the whole frame, area-averaged to the tile, and the centre of the frame at
 * full working resolution (`detail`). The tile shows the frame unless only the detail shows the effect's
 * structure, and it says so when neither view differs from the source (`unchanged`).
 */
export const LOOK_THUMBNAIL_WIDTH = 256;
export const LOOK_THUMBNAIL_HEIGHT = 144;
/** Longest edge of the working resolution; smaller sources render at their own size. */
export const LOOK_THUMBNAIL_WORK_MAX_EDGE = 1280;
/** The detail view needs this much more working resolution than the tile, or it would repeat the frame view. */
const DETAIL_MIN_ZOOM = 2;
/** A pixel counts as changed when a channel moves by at least this many 8-bit levels. */
const CHANGED_LEVEL = 6;
/** A view shows the effect when this share of its pixels changed ... */
const VISIBLE_CHANGED_SHARE = 0.005;
/** ... or its local contrast (mean luma gradient, 8-bit levels) changed by this much. */
const VISIBLE_STRUCTURE_CHANGE = 0.5;
/** The detail view wins when it shows this many times the structural change of the same region in the frame view. */
const DETAIL_STRUCTURE_RATIO = 2.5;
/** Later still times tried for an animated look whose first still shows no change (a glitch between bursts). */
export const LOOK_THUMBNAIL_RETRY_TIMES = [0.5, 1, 2, 3] as const;

export type LookThumbnailView = 'frame' | 'detail';

export interface LookThumbnailInfo {
  /** `frame`: the whole frame; `detail`: the centre of the frame at full working resolution. */
  view: LookThumbnailView;
  /** Timeline time of the still (hover animation continues from it). */
  timeSeconds: number;
  /** No view at any tried time differed visibly from the source frame: the tile shows the source and says so. */
  unchanged: boolean;
}

/** Straight-alpha RGBA8 pixels. */
export interface LookRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface LookViewComparison {
  /** Share of pixels where a channel changed by at least CHANGED_LEVEL. */
  changedShare: number;
  /** Mean absolute change of the luma gradient magnitude, in 8-bit levels. */
  structureChange: number;
}

/** Looks that move with a clock (wall clock or the timeline) play on hover and get later still times. */
export function isAnimatedLook(look: Pick<LookDefinition, 'stack'>): boolean {
  return look.stack.some((entry) => {
    const definition = getEffect(entry.effectId);
    return definition?.requiresContinuousRender === true
      || (!!definition && 'timelineAnimated' in definition && definition.timelineAnimated === true);
  });
}

/** Times the still is rendered at, in order, until one shows the effect. */
export function lookThumbnailStillTimes(startSeconds: number, animated: boolean): number[] {
  return animated ? [startSeconds, ...LOOK_THUMBNAIL_RETRY_TIMES.map(offset => startSeconds + offset)] : [startSeconds];
}

/** The source size scaled down (never up) so its longest edge fits `maxEdge`. */
export function lookThumbnailWorkSize(sourceWidth: number, sourceHeight: number, maxEdge = LOOK_THUMBNAIL_WORK_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/** The region of the working raster a view shows: all of it, or a tile-sized centre at one working pixel per tile pixel. */
export function lookThumbnailViewRect(view: LookThumbnailView, work: { width: number; height: number },
  tile: { width: number; height: number }): ThumbnailRect | null {
  if (view === 'frame') return { x: 0, y: 0, width: work.width, height: work.height };
  if (work.width < tile.width * DETAIL_MIN_ZOOM || work.height < tile.height * DETAIL_MIN_ZOOM) return null;
  return { x: Math.floor((work.width - tile.width) / 2), y: Math.floor((work.height - tile.height) / 2), width: tile.width, height: tile.height };
}

/** Box average of `rect` into `width` x `height` pixels, as premultiplied RGBA (0-255). */
function boxPremultiplied(source: LookRaster, rect: ThumbnailRect, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height * 4);
  const spans = (start: number, length: number, count: number, limit: number) => Array.from({ length: count }, (_, index) => {
    const from = Math.min(limit - 1, start + Math.floor(index * length / count));
    return [from, Math.min(limit, Math.max(from + 1, start + Math.floor((index + 1) * length / count)))] as const;
  });
  const columns = spans(rect.x, rect.width, width, source.width), rows = spans(rect.y, rect.height, height, source.height);
  const { data } = source;
  for (let y = 0; y < height; y++) {
    const [y0, y1] = rows[y];
    for (let x = 0; x < width; x++) {
      const [x0, x1] = columns[x];
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0, offset = (sy * source.width + x0) * 4; sx < x1; sx++, offset += 4) {
          const coverage = data[offset + 3];
          red += data[offset] * coverage; green += data[offset + 1] * coverage; blue += data[offset + 2] * coverage; alpha += coverage;
        }
      }
      const offset = (y * width + x) * 4, count = (y1 - y0) * (x1 - x0);
      out[offset] = red / (255 * count); out[offset + 1] = green / (255 * count); out[offset + 2] = blue / (255 * count); out[offset + 3] = alpha / count;
    }
  }
  return out;
}

/** Binomial weights over the six pixels around each pair: a low-pass that keeps lines finer than two output pixels from aliasing. */
const HALVE_WEIGHTS = [1, 5, 10, 10, 5, 1].map(weight => weight / 32);

/** Halves premultiplied RGBA of `width` x `height` (both even) with the binomial filter, edges clamped. */
function halveBinomial(source: Float32Array, width: number, height: number): Float32Array {
  const halfWidth = width / 2, halfHeight = height / 2;
  const across = new Float32Array(halfWidth * height * 4), out = new Float32Array(halfWidth * halfHeight * 4);
  const clamp = (value: number, limit: number) => Math.min(limit - 1, Math.max(0, value));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < halfWidth; x++) {
      const target = (y * halfWidth + x) * 4;
      for (let tap = 0; tap < HALVE_WEIGHTS.length; tap++) {
        const weight = HALVE_WEIGHTS[tap], from = (y * width + clamp(2 * x - 2 + tap, width)) * 4;
        across[target] += source[from] * weight; across[target + 1] += source[from + 1] * weight;
        across[target + 2] += source[from + 2] * weight; across[target + 3] += source[from + 3] * weight;
      }
    }
  }
  for (let y = 0; y < halfHeight; y++) {
    for (let x = 0; x < halfWidth; x++) {
      const target = (y * halfWidth + x) * 4;
      for (let tap = 0; tap < HALVE_WEIGHTS.length; tap++) {
        const weight = HALVE_WEIGHTS[tap], from = (clamp(2 * y - 2 + tap, height) * halfWidth + x) * 4;
        out[target] += across[from] * weight; out[target + 1] += across[from + 1] * weight;
        out[target + 2] += across[from + 2] * weight; out[target + 3] += across[from + 3] * weight;
      }
    }
  }
  return out;
}

/**
 * `rect` of a straight-alpha raster resampled to `width` x `height` pixels. A real reduction (the frame
 * view) averages boxes to twice the size and halves that through a binomial low-pass, so detail finer
 * than the tile (dense lines, masks) averages out instead of turning into moiré; a 1:1 crop (the detail
 * view) is copied. With `overBlack` the result is composited over black and opaque, as the compositor
 * shows a layer on an empty frame: a cut-out (the CRT tube's corners, a keyed background) turns black
 * instead of showing its hidden colour. Otherwise the result keeps straight alpha.
 */
export function downscaleLookRaster(source: LookRaster, rect: ThumbnailRect, width: number, height: number,
  overBlack: boolean): Uint8ClampedArray {
  const reduce = rect.width >= 2 * width && rect.height >= 2 * height;
  const premultiplied = reduce
    ? halveBinomial(boxPremultiplied(source, rect, 2 * width, 2 * height), 2 * width, 2 * height)
    : boxPremultiplied(source, rect, width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < out.length; offset += 4) {
    const alpha = premultiplied[offset + 3], scale = overBlack ? 1 : alpha > 1e-6 ? 255 / alpha : 0;
    out[offset] = premultiplied[offset] * scale;
    out[offset + 1] = premultiplied[offset + 1] * scale;
    out[offset + 2] = premultiplied[offset + 2] * scale;
    out[offset + 3] = overBlack ? 255 : alpha;
  }
  return out;
}

/** The part of the frame view the detail view enlarges, in frame-view pixels (null without a detail view). */
export function lookDetailRegionInFrame(work: { width: number; height: number }, tile: { width: number; height: number }): ThumbnailRect | null {
  const detail = lookThumbnailViewRect('detail', work, tile);
  if (!detail) return null;
  const scaleX = tile.width / work.width, scaleY = tile.height / work.height;
  const x = Math.floor(detail.x * scaleX), y = Math.floor(detail.y * scaleY);
  return { x, y, width: Math.max(2, Math.ceil((detail.x + detail.width) * scaleX) - x),
    height: Math.max(2, Math.ceil((detail.y + detail.height) * scaleY) - y) };
}

/**
 * How much a rendered view differs from the same view of the source (both opaque RGBA8 of one size),
 * over `region` (default: all of it).
 */
export function compareLookView(effect: Uint8ClampedArray, source: Uint8ClampedArray, width: number, height: number,
  region: ThumbnailRect = { x: 0, y: 0, width, height }): LookViewComparison {
  let changed = 0, structure = 0;
  const luma = (data: Uint8ClampedArray, offset: number) => data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
  const gradient = (data: Uint8ClampedArray, x: number, y: number) => {
    const offset = (y * width + x) * 4, centre = luma(data, offset);
    return (x + 1 < width ? Math.abs(luma(data, offset + 4) - centre) : 0)
      + (y + 1 < height ? Math.abs(luma(data, offset + width * 4) - centre) : 0);
  };
  const right = Math.min(width, region.x + region.width), bottom = Math.min(height, region.y + region.height);
  const left = Math.max(0, region.x), top = Math.max(0, region.y);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4;
      if (Math.max(Math.abs(effect[offset] - source[offset]), Math.abs(effect[offset + 1] - source[offset + 1]),
        Math.abs(effect[offset + 2] - source[offset + 2])) >= CHANGED_LEVEL) changed++;
      structure += Math.abs(gradient(effect, x, y) - gradient(source, x, y));
    }
  }
  const pixels = Math.max(1, (right - left) * (bottom - top));
  return { changedShare: changed / pixels, structureChange: structure / pixels };
}

const isVisible = (comparison: LookViewComparison | null | undefined): comparison is LookViewComparison =>
  !!comparison && (comparison.changedShare >= VISIBLE_CHANGED_SHARE || comparison.structureChange >= VISIBLE_STRUCTURE_CHANGE);

/**
 * Which view shows the effect. The frame, unless the effect lives in detail the frame view averages
 * away (lines, masks, grain, glyphs): then the detail shows far more structural change than the same
 * centre region of the frame view (`frameCentre`). `unchanged` when neither view differs visibly
 * from the source.
 */
export function chooseLookThumbnailView(views: {
  frame: LookViewComparison;
  frameCentre?: LookViewComparison | null;
  detail?: LookViewComparison | null;
}): LookThumbnailView | 'unchanged' {
  const { frame, detail } = views, centre = views.frameCentre ?? frame;
  if (isVisible(detail)
    && detail.structureChange >= Math.max(2 * VISIBLE_STRUCTURE_CHANGE, DETAIL_STRUCTURE_RATIO * centre.structureChange)) return 'detail';
  if (isVisible(frame)) return 'frame';
  return isVisible(detail) ? 'detail' : 'unchanged';
}
