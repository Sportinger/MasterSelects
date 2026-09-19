import type { Keyframe } from '../../types/keyframes';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import { closeByThumbnailUrls } from '../timeline/thumbnailBitmapCache';
import {
  getFlockThumbnailKey,
  renderFlockThumbnailFrames,
  type FlockThumbnailClip,
  type FlockThumbnailOptions,
} from './flockThumbnail';

/**
 * Off-hot-path scheduler for flock clip thumbnails. Frames are encoded to blob
 * URLs so the existing timeline thumbnail bitmap cache and strip painters draw
 * them unchanged. Work is debounced per invalidation key, cancelled when a
 * newer request supersedes it, paused while the timeline plays or exports,
 * and bounded by an LRU of clip entries.
 */

export const FLOCK_THUMBNAIL_SOURCE_PREFIX = 'flock-thumbnail:';
const OPTIONS: FlockThumbnailOptions = { frameCount: 8, width: 160, height: 90 };
const DEBOUNCE_MS = 350;
const MAX_ENTRIES = 48;
const SLICE_BUDGET_MS = 8;

export function getFlockThumbnailSourceId(clipId: string): string {
  return `${FLOCK_THUMBNAIL_SOURCE_PREFIX}${clipId}`;
}

/** Synthetic thumbnail source id for visual flock clips; null for everything else. */
export function getFlockThumbnailSourceIdForClip(clip: {
  id: string;
  trackType?: string;
  source?: { type?: string | null } | null;
}): string | null {
  return clip.source?.type === 'flock' && clip.trackType !== 'audio' ? getFlockThumbnailSourceId(clip.id) : null;
}

export function isFlockThumbnailSourceId(sourceId: string | null | undefined): boolean {
  return typeof sourceId === 'string' && sourceId.startsWith(FLOCK_THUMBNAIL_SOURCE_PREFIX);
}

interface ReadyFrame {
  sourceTime: number;
  url: string;
}

interface Entry {
  key: string;
  frames: ReadyFrame[];
  limited: boolean;
  status: 'ready' | 'failed';
  lastUsed: number;
}

interface PendingJob {
  clip: FlockThumbnailClip;
  keyframes: readonly Keyframe[] | undefined;
  key: string;
  requestedAt: number;
}

async function encodeRgba(rgba: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof ImageData === 'undefined') {
    return null;
  }
  const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
  // Linux/Mesa policy: never trust OffscreenCanvas there; use a main-thread 2D canvas.
  if (!prefersSoftwareTimelineCanvas() && typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context) {
        context.putImageData(image, 0, 0);
        return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
      }
    } catch {
      // Fall back to a DOM canvas below.
    }
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', prefersSoftwareTimelineCanvas() ? { willReadFrequently: true } : undefined);
  if (!context) return null;
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

function releaseUrls(urls: readonly string[]): void {
  if (urls.length === 0) return;
  closeByThumbnailUrls(urls);
  for (const url of urls) URL.revokeObjectURL?.(url);
}

class FlockThumbnailService {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, PendingJob>();
  private readonly listeners = new Set<() => void>();
  private busy = false;
  private running: { clipId: string; key: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Pauses (and cancels) thumbnail work while the timeline plays or exports. */
  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    if (!busy && this.pending.size > 0) this.schedule(DEBOUNCE_MS);
  }

  request(clip: FlockThumbnailClip, keyframes: readonly Keyframe[] | undefined): void {
    const key = getFlockThumbnailKey(clip, keyframes, OPTIONS);
    const entry = this.entries.get(clip.id);
    if (!key) {
      this.pending.delete(clip.id);
      if (entry) this.drop(clip.id);
      return;
    }
    if (entry) entry.lastUsed = Date.now();
    if (entry?.key === key) return;
    if (this.pending.get(clip.id)?.key === key) return;
    if (this.running?.clipId === clip.id && this.running.key === key) return;
    this.pending.set(clip.id, { clip, keyframes, key, requestedAt: Date.now() });
    this.schedule(DEBOUNCE_MS);
  }

  /** Nearest computed frame per slot for a visible source window; null while computing. */
  getUrlsForRange(clipId: string, inPoint: number, outPoint: number, count: number, reversed?: boolean): Array<string | null> {
    const frames = this.entries.get(clipId)?.frames ?? [];
    if (frames.length === 0) return Array.from({ length: count }, () => null);
    const entry = this.entries.get(clipId)!;
    entry.lastUsed = Date.now();
    const span = outPoint - inPoint;
    return Array.from({ length: count }, (_, index) => {
      const ratio = (index + 0.5) / count;
      const time = reversed ? outPoint - span * ratio : inPoint + span * ratio;
      let best = frames[0];
      for (const frame of frames) {
        if (Math.abs(frame.sourceTime - time) < Math.abs(best.sourceTime - time)) best = frame;
      }
      return best.url;
    });
  }

  /** True when the thumbnail comes from the capped CPU preview population. */
  isLimited(clipId: string): boolean {
    return this.entries.get(clipId)?.limited ?? false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  drop(clipId: string): void {
    const entry = this.entries.get(clipId);
    this.pending.delete(clipId);
    if (!entry) return;
    this.entries.delete(clipId);
    releaseUrls(entry.frames.map((frame) => frame.url));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
  }

  private async pump(): Promise<void> {
    if (this.running || this.busy) return;
    let next: PendingJob | undefined;
    for (const job of this.pending.values()) {
      if (!next || job.requestedAt < next.requestedAt) next = job;
    }
    if (!next) return;
    const job = next;
    this.pending.delete(job.clip.id);
    this.running = { clipId: job.clip.id, key: job.key };
    const superseded = () => this.pending.has(job.clip.id);
    try {
      const result = await renderFlockThumbnailFrames(job.clip, job.keyframes, OPTIONS, {
        shouldCancel: () => this.busy || superseded(),
        yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
        sliceBudgetMs: SLICE_BUDGET_MS,
      });
      if (!result) {
        if (this.busy && !superseded()) this.pending.set(job.clip.id, job);
        return;
      }
      const frames: ReadyFrame[] = [];
      for (const frame of result.frames) {
        const url = await encodeRgba(frame.rgba, result.width, result.height);
        if (!url || superseded()) {
          releaseUrls(frames.map((ready) => ready.url));
          if (url) releaseUrls([url]);
          if (!url && !superseded()) this.markFailed(job.clip.id, job.key);
          return;
        }
        frames.push({ sourceTime: frame.sourceTime, url });
      }
      const previous = this.entries.get(job.clip.id);
      this.entries.set(job.clip.id, { key: job.key, frames, limited: result.limited, status: 'ready', lastUsed: Date.now() });
      if (previous) releaseUrls(previous.frames.map((frame) => frame.url));
      this.evict();
      this.emit();
    } catch {
      this.markFailed(job.clip.id, job.key);
    } finally {
      this.running = null;
      if (this.pending.size > 0) this.schedule(0);
    }
  }

  private markFailed(clipId: string, key: string): void {
    const previous = this.entries.get(clipId);
    if (previous) releaseUrls(previous.frames.map((frame) => frame.url));
    this.entries.set(clipId, { key, frames: [], limited: false, status: 'failed', lastUsed: Date.now() });
  }

  private evict(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const ordered = [...this.entries.entries()].toSorted((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [clipId] of ordered.slice(0, this.entries.size - MAX_ENTRIES)) this.drop(clipId);
  }
}

export const flockThumbnailService = new FlockThumbnailService();
