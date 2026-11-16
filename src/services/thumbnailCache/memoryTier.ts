import {
  closeByThumbnailUrls,
  registerThumbnailBitmapSource,
} from '../timeline/thumbnailBitmapCache';
import type { SourceThumbnailFrame } from './types';

export interface ThumbnailMemoryLoadResult {
  secondIndices: number[];
  count: number;
}

export interface ThumbnailMemoryEviction {
  secondIndices: number[];
  count: number;
}

export class ThumbnailMemoryTier {
  private cache = new Map<string, Map<number, string>>();
  private sortedByFrames = new WeakMap<Map<number, string>, { size: number; seconds: number[] }>();

  getThumbnail(mediaFileId: string, secondIndex: number): string | null {
    return this.cache.get(mediaFileId)?.get(secondIndex) ?? null;
  }

  /**
   * Thumbnails for `count` evenly spaced points of [inPoint, outPoint), each the frame of that second,
   * a neighbouring second, or else the nearest stored second. Only the needed seconds are looked up:
   * copying and sorting every stored frame per call (one per source second, 10,000 for a long camera
   * file) for each of hundreds of clips made every timeline zoom step take a sixth of a second.
   */
  getThumbnailsForRange(
    mediaFileId: string,
    inPoint: number,
    outPoint: number,
    count: number,
    reversed?: boolean,
    isAvailable?: (url: string) => boolean,
  ): (string | null)[] {
    const frames = this.cache.get(mediaFileId);
    if (!frames || frames.size === 0 || count <= 0) {
      return new Array(Math.max(0, count)).fill(null);
    }
    // Pending decodes must not displace an already drawable nearest frame.
    const usable = (second: number): string | null => {
      const url = frames.get(second);
      return url !== undefined && (!isAvailable || isAvailable(url)) ? url : null;
    };
    const seconds = this.sortedSeconds(frames);
    const duration = outPoint - inPoint;
    // A frame farther away than a few slots shows other content; past that a placeholder is honest.
    const reach = Math.max(NEAREST_MIN_REACH_SECONDS, Math.abs(duration) / Math.max(1, count) * 4);
    const result: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      const secondIndex = Math.floor(inPoint + (i / count) * duration);
      let thumb = usable(secondIndex);
      if (!thumb && secondIndex > 0) thumb = usable(secondIndex - 1) ?? usable(secondIndex + 1);
      result.push(thumb ?? nearestUsable(seconds, secondIndex, usable, reach));
    }
    if (reversed) {
      result.reverse();
    }
    return result;
  }

  /** Stored seconds in order, rebuilt only when frames were added (frames are never removed from a map). */
  private sortedSeconds(frames: Map<number, string>): number[] {
    const known = this.sortedByFrames.get(frames);
    if (known && known.size === frames.size) return known.seconds;
    const seconds = [...frames.keys()].toSorted((a, b) => a - b);
    this.sortedByFrames.set(frames, { size: frames.size, seconds });
    return seconds;
  }

  hasSource(mediaFileId: string): boolean {
    const cache = this.cache.get(mediaFileId);
    return !!cache && cache.size > 0;
  }

  getCount(mediaFileId: string): number {
    return this.cache.get(mediaFileId)?.size ?? 0;
  }

  sourceIds(): string[] {
    return [...this.cache.keys()];
  }

  createSourceCache(mediaFileId: string): Map<number, string> {
    const sourceCache = new Map<number, string>();
    this.cache.set(mediaFileId, sourceCache);
    return sourceCache;
  }

  setGeneratedFrame(
    mediaFileId: string,
    sourceCache: Map<number, string>,
    secondIndex: number,
    blob: Blob,
  ): string {
    const url = URL.createObjectURL(blob);
    registerThumbnailBitmapSource(url, mediaFileId);
    sourceCache.set(secondIndex, url);
    return url;
  }

  loadFrames(mediaFileId: string, frames: SourceThumbnailFrame[]): ThumbnailMemoryLoadResult {
    const sourceCache = new Map<number, string>();
    const secondIndices: number[] = [];
    for (const frame of frames) {
      const url = URL.createObjectURL(frame.blob);
      registerThumbnailBitmapSource(url, mediaFileId);
      sourceCache.set(frame.secondIndex, url);
      secondIndices.push(frame.secondIndex);
    }
    this.cache.set(mediaFileId, sourceCache);
    return { secondIndices, count: secondIndices.length };
  }

  evictSource(mediaFileId: string): ThumbnailMemoryEviction | null {
    const sourceCache = this.cache.get(mediaFileId);
    if (!sourceCache) {
      return null;
    }

    const urls = [...sourceCache.values()];
    closeByThumbnailUrls(urls);
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
    this.cache.delete(mediaFileId);
    return {
      secondIndices: [...sourceCache.keys()],
      count: sourceCache.size,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}

const NEAREST_MIN_REACH_SECONDS = 30;

/** The usable frame closest to `second` within `reach` seconds (the earlier one on a tie), searching outward. */
function nearestUsable(seconds: number[], second: number, usable: (second: number) => string | null, reach: number): string | null {
  // Binary search for the first stored second at or after `second`.
  let high = 0, end = seconds.length;
  while (high < end) {
    const middle = (high + end) >> 1;
    if (seconds[middle]! < second) high = middle + 1; else end = middle;
  }
  let low = high - 1;
  while (low >= 0 || high < seconds.length) {
    const below = low >= 0 ? second - seconds[low]! : Infinity;
    const above = high < seconds.length ? seconds[high]! - second : Infinity;
    if (Math.min(below, above) > reach) return null;
    if (below <= above) {
      const url = usable(seconds[low]!);
      if (url) return url;
      low -= 1;
    } else {
      const url = usable(seconds[high]!);
      if (url) return url;
      high += 1;
    }
  }
  return null;
}
