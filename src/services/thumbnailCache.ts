// On-demand thumbnail cache service
// Generates thumbnails lazily based on visible time range + zoom level
// Uses LRU eviction, priority queue, and pooled video elements

import { create } from 'zustand';
import { WebCodecsPlayer } from '../engine/WebCodecsPlayer';
import { Logger } from './logger';

const log = Logger.create('ThumbnailCache');

// --- Zustand mini-store (only for triggering re-renders) ---

interface ThumbnailCacheState {
  versions: Record<string, number>; // mediaFileId → version counter
}

export const useThumbnailCacheStore = create<ThumbnailCacheState>(() => ({
  versions: {},
}));

function bumpVersion(mediaFileId: string) {
  useThumbnailCacheStore.setState(s => ({
    versions: { ...s.versions, [mediaFileId]: (s.versions[mediaFileId] || 0) + 1 },
  }));
}

// --- Cache storage (external Map, not in Zustand) ---

const MAX_CACHE_ENTRIES = 2000;

// mediaFileId → (quantizedTime → dataURL)
const cache = new Map<string, Map<number, string>>();
// LRU tracking: [mediaFileId, quantizedTime] in access order (oldest first)
const lruOrder: Array<{ mediaFileId: string; time: number }> = [];
let totalEntries = 0;

function addToCache(mediaFileId: string, time: number, dataURL: string) {
  let mediaCache = cache.get(mediaFileId);
  if (!mediaCache) {
    mediaCache = new Map();
    cache.set(mediaFileId, mediaCache);
  }

  if (!mediaCache.has(time)) {
    // Evict if over limit
    while (totalEntries >= MAX_CACHE_ENTRIES && lruOrder.length > 0) {
      const oldest = lruOrder.shift()!;
      const oldMediaCache = cache.get(oldest.mediaFileId);
      if (oldMediaCache) {
        oldMediaCache.delete(oldest.time);
        if (oldMediaCache.size === 0) cache.delete(oldest.mediaFileId);
      }
      totalEntries--;
    }
    totalEntries++;
  }

  mediaCache.set(time, dataURL);
  lruOrder.push({ mediaFileId, time });
}

// --- Adaptive time quantization ---

export function quantizeTime(time: number, zoom: number): number {
  // Higher zoom = finer interval
  const interval = Math.max(0.1, 20 / zoom);
  return Math.round(time / interval) * interval;
}

// --- Generation queue ---

type Priority = 'high' | 'normal';

interface QueueItem {
  mediaFileId: string;
  time: number; // quantized
  file: File;
  priority: Priority;
}

const pendingQueue: QueueItem[] = [];
const inFlightTimes = new Set<string>(); // "mediaFileId:time" keys currently being generated

// WebCodecsPlayer pool for thumbnail generation
interface GeneratorSlot {
  player: WebCodecsPlayer;
  mediaFileId: string;
  busy: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const MAX_GENERATORS = 2;
const generatorSlots: GeneratorSlot[] = [];
const IDLE_RELEASE_MS = 5000;

// Canvas for drawing (shared)
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = 160;
thumbCanvas.height = 90;
const thumbCtx = thumbCanvas.getContext('2d')!;

async function getOrCreateGenerator(mediaFileId: string, file: File): Promise<GeneratorSlot | null> {
  // Reuse existing slot for same media
  const existing = generatorSlots.find(s => s.mediaFileId === mediaFileId && !s.busy);
  if (existing) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    return existing;
  }

  // Try to find a free slot
  const freeSlot = generatorSlots.find(s => !s.busy);
  if (freeSlot) {
    if (freeSlot.idleTimer) {
      clearTimeout(freeSlot.idleTimer);
      freeSlot.idleTimer = null;
    }
    // Destroy old player and create new one
    freeSlot.player.destroy();
    const player = new WebCodecsPlayer({ loop: false });
    const buffer = await file.arrayBuffer();
    await player.loadArrayBuffer(buffer);
    freeSlot.player = player;
    freeSlot.mediaFileId = mediaFileId;
    return freeSlot;
  }

  // Create new slot if under limit
  if (generatorSlots.length < MAX_GENERATORS) {
    const player = new WebCodecsPlayer({ loop: false });
    const buffer = await file.arrayBuffer();
    await player.loadArrayBuffer(buffer);
    const slot: GeneratorSlot = { player, mediaFileId, busy: false, idleTimer: null };
    generatorSlots.push(slot);
    return slot;
  }

  return null; // All slots busy
}

function releaseGenerator(slot: GeneratorSlot) {
  slot.busy = false;
  // Set idle timer to release resources
  slot.idleTimer = setTimeout(() => {
    const idx = generatorSlots.indexOf(slot);
    if (idx !== -1) {
      slot.player.destroy();
      generatorSlots.splice(idx, 1);
    }
  }, IDLE_RELEASE_MS);
}

// Debounce for batch processing during trim
let processTimer: ReturnType<typeof setTimeout> | null = null;
const PROCESS_DEBOUNCE_MS = 50;

function scheduleProcessQueue() {
  if (processTimer) return; // already scheduled
  processTimer = setTimeout(() => {
    processTimer = null;
    processQueue();
  }, PROCESS_DEBOUNCE_MS);
}

async function processQueue() {
  // Find next item to process (high priority first)
  const highIdx = pendingQueue.findIndex(q => q.priority === 'high');
  const idx = highIdx !== -1 ? highIdx : 0;
  if (pendingQueue.length === 0) return;

  const item = pendingQueue[idx];
  const key = `${item.mediaFileId}:${item.time}`;

  // Skip if already cached or in flight
  const mediaCache = cache.get(item.mediaFileId);
  if ((mediaCache && mediaCache.has(item.time)) || inFlightTimes.has(key)) {
    pendingQueue.splice(idx, 1);
    scheduleProcessQueue();
    return;
  }

  let slot: GeneratorSlot | null = null;
  try {
    slot = await getOrCreateGenerator(item.mediaFileId, item.file);
  } catch (e) {
    log.warn('Failed to create thumbnail generator', { mediaFileId: item.mediaFileId, error: e });
    pendingQueue.splice(idx, 1);
    scheduleProcessQueue();
    return;
  }
  if (!slot) {
    // All generators busy, retry later
    scheduleProcessQueue();
    return;
  }

  // Remove from queue and mark in flight
  pendingQueue.splice(idx, 1);
  inFlightTimes.add(key);
  slot.busy = true;

  // Batch: gather all pending items for the same mediaFileId (sort by time for sequential seeks)
  const batchItems: QueueItem[] = [item];
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
    const q = pendingQueue[i];
    if (q.mediaFileId === item.mediaFileId) {
      const batchKey = `${q.mediaFileId}:${q.time}`;
      const mc = cache.get(q.mediaFileId);
      if (!(mc && mc.has(q.time)) && !inFlightTimes.has(batchKey)) {
        batchItems.push(q);
        inFlightTimes.add(batchKey);
        pendingQueue.splice(i, 1);
      } else {
        pendingQueue.splice(i, 1); // already cached, drop
      }
    }
  }

  // Sort by time for sequential seeking
  batchItems.sort((a, b) => a.time - b.time);

  // Generate all thumbnails in batch
  let generated = 0;
  for (const bi of batchItems) {
    try {
      const clampedTime = Math.min(Math.max(0, bi.time), (slot.player.duration || 1) - 0.01);
      await slot.player.seekAsync(clampedTime);
      const frame = slot.player.getCurrentFrame();
      if (frame) {
        // Draw VideoFrame to canvas for thumbnail
        const bitmap = await createImageBitmap(frame);
        thumbCtx.drawImage(bitmap, 0, 0, 160, 90);
        bitmap.close();
        const dataURL = thumbCanvas.toDataURL('image/jpeg', 0.6);
        addToCache(bi.mediaFileId, bi.time, dataURL);
        generated++;
      }
    } catch (e) {
      log.warn('Thumb gen failed', { mediaFileId: bi.mediaFileId, time: bi.time, error: e });
    }
    inFlightTimes.delete(`${bi.mediaFileId}:${bi.time}`);
  }

  releaseGenerator(slot);

  if (generated > 0) {
    bumpVersion(item.mediaFileId);
  }

  // Continue processing if queue has more
  if (pendingQueue.length > 0) {
    scheduleProcessQueue();
  }
}

// --- Public API ---

export const thumbnailCache = {
  /**
   * Synchronous lookup — returns dataURL or null (cache miss).
   */
  getThumbnail(mediaFileId: string, time: number, zoom: number): string | null {
    const qt = quantizeTime(time, zoom);
    const mediaCache = cache.get(mediaFileId);
    return mediaCache?.get(qt) ?? null;
  },

  /**
   * Queue generation for missing times (visible thumbnails).
   */
  requestThumbnails(mediaFileId: string, times: number[], file: File, priority: Priority = 'high') {
    let queued = 0;
    for (const t of times) {
      const key = `${mediaFileId}:${t}`;
      const mediaCache = cache.get(mediaFileId);
      if ((mediaCache && mediaCache.has(t)) || inFlightTimes.has(key)) continue;
      // Check if already in queue
      const alreadyQueued = pendingQueue.some(q => q.mediaFileId === mediaFileId && q.time === t);
      if (alreadyQueued) {
        // Upgrade priority if needed
        if (priority === 'high') {
          const existing = pendingQueue.find(q => q.mediaFileId === mediaFileId && q.time === t);
          if (existing) existing.priority = 'high';
        }
        continue;
      }
      pendingQueue.push({ mediaFileId, time: t, file, priority });
      queued++;
    }
    if (queued > 0) {
      scheduleProcessQueue();
    }
  },

  /**
   * Initial preload on clip add — generates thumbnails every ~2s across full duration.
   */
  preloadClip(mediaFileId: string, duration: number, file: File) {
    const interval = 2; // every 2 seconds
    const count = Math.max(1, Math.ceil(duration / interval));
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? (i / (count - 1)) * duration : 0;
      // Quantize at a moderate zoom level so preloaded thumbs are reusable
      const qt = quantizeTime(t, 20);
      if (!times.includes(qt)) times.push(qt);
    }
    this.requestThumbnails(mediaFileId, times, file, 'normal');
  },

  /**
   * Invalidate all cached thumbnails for a media file.
   */
  invalidate(mediaFileId: string) {
    const mediaCache = cache.get(mediaFileId);
    if (mediaCache) {
      totalEntries -= mediaCache.size;
      cache.delete(mediaFileId);
      // Clean LRU
      for (let i = lruOrder.length - 1; i >= 0; i--) {
        if (lruOrder[i].mediaFileId === mediaFileId) lruOrder.splice(i, 1);
      }
      bumpVersion(mediaFileId);
    }
  },

  /**
   * Clear all caches.
   */
  clear() {
    cache.clear();
    lruOrder.length = 0;
    totalEntries = 0;
    pendingQueue.length = 0;
    inFlightTimes.clear();
    // Release all generators
    for (const slot of generatorSlots) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.player.destroy();
    }
    generatorSlots.length = 0;
    useThumbnailCacheStore.setState({ versions: {} });
  },

  /** Expose cache size for debugging */
  get size() { return totalEntries; },
};
