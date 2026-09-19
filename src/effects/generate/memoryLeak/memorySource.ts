// Resolves which bytes the Memory Leak effect reads (frozen block or live
// FFmpeg heap) and cuts the window for a given output size and frame.

import { Logger } from '../../../services/logger';
import { memoryLeakHeapSource } from './heapSource';

const log = Logger.create('MemoryLeak');
import {
  frameIndexAt,
  gatherHeapWindow,
  planMemoryWindow,
  resolveWindowOffset,
  sliceWindow,
  type MemoryWindowPlan,
} from './memoryWindow';

type Primitive = number | boolean | string;

export interface MemorySource {
  key: string;
  /** Addressable length; offsets wrap inside it. */
  length: number;
  /** Copy or view of `length` bytes starting at `offset` (wrapping). */
  read: (offset: number, length: number) => Uint8Array;
}

export interface MemoryWindow {
  plan: MemoryWindowPlan;
  offset: number;
  data: Uint8Array;
  source: MemorySource;
}

/** Frozen block when set, otherwise the live FFmpeg heap. */
export function resolveMemorySource(params: Record<string, Primitive>): MemorySource | null {
  const snapshot = typeof params.snapshot === 'string' ? params.snapshot : '';
  if (snapshot) {
    const bytes = memoryLeakHeapSource.getSnapshot(snapshot);
    if (!bytes || bytes.byteLength < 4) return null;
    return {
      key: `snapshot:${snapshot}`,
      length: bytes.byteLength,
      read: (offset, length) => sliceWindow(bytes, offset, length),
    };
  }
  const heap = memoryLeakHeapSource.getLiveHeap();
  if (!heap || heap.map.virtualLength < 4) return null;
  // Walk only populated pages so moving blocks never scroll into untouched
  // (all-zero) wasm memory, wherever those pages sit in the heap.
  return {
    key: `heap:${heap.epoch}`,
    length: heap.map.virtualLength,
    read: (offset, length) => gatherHeapWindow(heap.bytes, heap.map, offset, length),
  };
}

// The media store imports the effect registry, so it is resolved lazily to
// keep this effect module free of import cycles. Until it resolves (first
// render only) the frame clock runs at 30 fps.
let readFrameRate: () => number = () => 30;
void import('../../../stores/mediaStore').then(({ useMediaStore }) => {
  readFrameRate = () => useMediaStore.getState().getActiveComposition()?.frameRate ?? 30;
}).catch(() => undefined);

export function activeCompositionFrameRate(): number {
  return readFrameRate();
}

export function buildMemoryWindow(
  params: Record<string, Primitive>,
  outputWidth: number,
  outputHeight: number,
  timelineTimeSeconds: number,
): MemoryWindow | null {
  const source = resolveMemorySource(params);
  if (!source) return null;
  const plan = planMemoryWindow(params, outputWidth, outputHeight);
  const frameIndex = frameIndexAt(timelineTimeSeconds, activeCompositionFrameRate());
  const offset = resolveWindowOffset(params, frameIndex, source.length);
  log.debug('window', { time: timelineTimeSeconds, frameIndex, offset, bytes: plan.bytes, source: source.key });
  return { plan, offset, data: source.read(offset, plan.bytes), source };
}
