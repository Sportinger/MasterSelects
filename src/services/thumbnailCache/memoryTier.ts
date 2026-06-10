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

  getThumbnail(mediaFileId: string, secondIndex: number): string | null {
    return this.cache.get(mediaFileId)?.get(secondIndex) ?? null;
  }

  getThumbnailsForRange(
    mediaFileId: string,
    inPoint: number,
    outPoint: number,
    count: number,
    reversed?: boolean,
  ): (string | null)[] {
    const sourceCache = this.cache.get(mediaFileId);
    if (!sourceCache || sourceCache.size === 0 || count <= 0) {
      return new Array(count).fill(null);
    }

    const duration = outPoint - inPoint;
    const result: (string | null)[] = [];

    for (let i = 0; i < count; i++) {
      const t = inPoint + (i / count) * duration;
      const secondIndex = Math.floor(t);
      let thumb = sourceCache.get(secondIndex) ?? null;
      if (!thumb && secondIndex > 0) {
        thumb = sourceCache.get(secondIndex - 1) ?? sourceCache.get(secondIndex + 1) ?? null;
      }
      result.push(thumb);
    }

    if (reversed) {
      result.reverse();
    }

    return result;
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

