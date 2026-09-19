// Memory Leak heap source: exposes the live FFmpeg wasm heap (freed but never
// zeroed allocations from previous commands) plus frozen snapshots stored as
// project artifacts. Browser sandboxes zero every fresh allocation, so the wasm
// linear memory is the one place where genuine leftover memory is readable.

import { getFFmpegBridge, type FFmpegHeapState } from '../../../engine/ffmpeg';
import { Logger } from '../../../services/logger';
import { buildHeapPageMap, type HeapPageMap } from './memoryWindow';

const log = Logger.create('MemoryLeak');

// Effect modules are imported by the store layer; app services are loaded
// lazily here so the effect registry never forms an import cycle with them.
function requestRender(): void {
  void import('../../../services/render/renderHostPort')
    .then(({ renderHostPort }) => renderHostPort.requestRender())
    .catch((error: unknown) => log.warn('Render wake failed', error));
}

async function loadStorage() {
  const [{ artifactService }, { projectFileService }] = await Promise.all([
    import('../../../services/project/domains/ArtifactService'),
    import('../../../services/project/ProjectFileService'),
  ]);
  return { artifactService, projectHandle: projectFileService.getProjectHandle() };
}

export type MemoryLeakStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MemoryLeakFeedInfo {
  label: string;
  seconds: number;
  at: number;
}

export interface MemoryLeakSourceState {
  status: MemoryLeakStatus;
  error: string | null;
  heapBytes: number;
  /** Bytes up to the last non-zero word: the region FFmpeg has ever written. */
  usedBytes: number;
  epoch: number;
  feeding: boolean;
  lastFeed: MemoryLeakFeedInfo | null;
}

/** Largest media file we copy into the FFmpeg virtual filesystem for a feed. */
export const MEMORY_FEED_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MEMORY_FEED_SECONDS = 2;
export const MEMORY_SNAPSHOT_MIME = 'application/x-masterselects-memory-window';

type SnapshotEntry = { kind: 'loading' } | { kind: 'ready'; bytes: Uint8Array } | { kind: 'missing' };

export interface MemoryLeakLiveHeap extends FFmpegHeapState {
  /** Populated 64 KB pages; offsets walk this virtual space only. */
  map: HeapPageMap;
}

class MemoryLeakHeapSource {
  private status: MemoryLeakStatus = 'idle';
  private error: string | null = null;
  private feeding = false;
  private lastFeed: MemoryLeakFeedInfo | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private unsubscribeHeap: (() => void) | null = null;
  private pageMap: { epoch: number; byteLength: number; map: HeapPageMap } | null = null;

  getState(): MemoryLeakSourceState {
    const heap = this.getLiveHeap();
    return {
      status: heap ? 'ready' : this.status,
      error: this.error,
      heapBytes: heap?.bytes.byteLength ?? 0,
      usedBytes: heap?.map.virtualLength ?? 0,
      epoch: heap?.epoch ?? 0,
      feeding: this.feeding,
      lastFeed: this.lastFeed,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Live heap view, kicking off the FFmpeg core load on first use. */
  getLiveHeap(): MemoryLeakLiveHeap | null {
    const bridge = getFFmpegBridge();
    const heap = bridge.getHeapState();
    if (heap) {
      this.watchHeap();
      return { ...heap, map: this.pageMapFor(heap) };
    }
    this.ensureLoaded();
    return null;
  }

  private pageMapFor(heap: FFmpegHeapState): HeapPageMap {
    const cached = this.pageMap;
    if (cached && cached.epoch === heap.epoch && cached.byteLength === heap.bytes.byteLength) {
      return cached.map;
    }
    const map = buildHeapPageMap(heap.bytes);
    this.pageMap = { epoch: heap.epoch, byteLength: heap.bytes.byteLength, map };
    log.debug('page map', { epoch: heap.epoch, pages: map.pages.length, populatedMB: map.virtualLength / 1048576 });
    return map;
  }

  ensureLoaded(): void {
    if (this.status === 'loading' || this.status === 'ready') return;
    const bridge = getFFmpegBridge();
    if (bridge.isLoaded()) {
      this.status = 'ready';
      this.watchHeap();
      return;
    }
    this.status = 'loading';
    this.error = null;
    this.emit();
    bridge.load().then(() => {
      this.status = 'ready';
      this.watchHeap();
      this.emit();
      requestRender();
    }).catch((error: unknown) => {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      log.warn('FFmpeg core failed to load for Memory Leak', error);
      this.emit();
    });
  }

  /**
   * Decode the first seconds of a media file inside FFmpeg so its demuxed
   * packets and decoded frames land in the wasm heap and stay there as
   * leftovers after the command finishes. Nothing is written back.
   */
  async feedFromMedia(file: Blob, label: string, seconds = MEMORY_FEED_SECONDS): Promise<void> {
    if (this.feeding) return;
    if (file.size > MEMORY_FEED_MAX_FILE_BYTES) {
      throw new Error(`File is larger than ${Math.round(MEMORY_FEED_MAX_FILE_BYTES / 1024 / 1024)} MB; feed a smaller clip.`);
    }
    this.feeding = true;
    this.error = null;
    this.emit();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bridge = getFFmpegBridge();
      await bridge.runVirtualCommand({
        inputFiles: { '/input/feed.bin': bytes },
        args: [
          '-threads', '1',
          '-t', String(Math.max(0.1, seconds)),
          '-i', '/input/feed.bin',
          '-an', '-sn',
          '-frames:v', String(Math.ceil(seconds * 30)),
          '-f', 'null', '-',
        ],
        outputPaths: [],
      });
      this.lastFeed = { label, seconds, at: Date.now() };
      this.status = 'ready';
      this.watchHeap();
      log.info(`Fed ${label} into the FFmpeg heap (${seconds}s)`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      log.warn('Memory feed failed', error);
      throw error;
    } finally {
      this.feeding = false;
      this.emit();
      requestRender();
    }
  }

  /** Bytes of a frozen window, or null while it loads / when it is missing. */
  getSnapshot(artifactId: string): Uint8Array | null {
    const entry = this.snapshots.get(artifactId);
    if (entry?.kind === 'ready') return entry.bytes;
    if (entry) return null;
    this.snapshots.set(artifactId, { kind: 'loading' });
    void this.loadSnapshot(artifactId);
    return null;
  }

  snapshotStatus(artifactId: string): SnapshotEntry['kind'] | 'unknown' {
    return this.snapshots.get(artifactId)?.kind ?? 'unknown';
  }

  /** Persist a window as a project artifact and return its artifact id. */
  async freezeWindow(bytes: Uint8Array, metadata: Record<string, string | number>): Promise<string> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: MEMORY_SNAPSHOT_MIME });
    const options = {
      mimeType: MEMORY_SNAPSHOT_MIME,
      producer: { providerId: 'masterselects.effect.memory-leak' },
      metadata: { kind: 'memory-leak-window', ...metadata },
    };
    const { artifactService, projectHandle } = await loadStorage();
    const result = projectHandle
      ? await artifactService.putArtifact(projectHandle, blob, options)
      : await artifactService.putIndexedDBArtifact(blob, options);
    const artifactId = result.manifest.artifactId;
    this.snapshots.set(artifactId, { kind: 'ready', bytes: copy });
    this.emit();
    return artifactId;
  }

  private async loadSnapshot(artifactId: string): Promise<void> {
    try {
      const { artifactService, projectHandle } = await loadStorage();
      let stored = projectHandle ? await artifactService.getArtifact(projectHandle, artifactId) : null;
      if (!stored?.blob) stored = await artifactService.getIndexedDBArtifact(artifactId);
      if (!stored?.blob) {
        this.snapshots.set(artifactId, { kind: 'missing' });
        log.warn(`Frozen memory window not found: ${artifactId}`);
      } else {
        this.snapshots.set(artifactId, { kind: 'ready', bytes: new Uint8Array(await stored.blob.arrayBuffer()) });
      }
    } catch (error) {
      this.snapshots.set(artifactId, { kind: 'missing' });
      log.warn(`Frozen memory window failed to load: ${artifactId}`, error);
    }
    this.emit();
    requestRender();
  }

  private watchHeap(): void {
    if (this.unsubscribeHeap) return;
    this.unsubscribeHeap = getFFmpegBridge().subscribeHeap(() => {
      this.emit();
      requestRender();
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const memoryLeakHeapSource = new MemoryLeakHeapSource();
