// Pure window math for the Memory Leak effect: which slice of the heap is
// interpreted as pixels, how large it is, and how it moves per frame.

type Primitive = number | boolean | string;

export type MemoryDepth = '8' | '16' | '32';
export type MemoryMotion = 'static' | 'advance' | 'shuffle';

export const MEMORY_BLOCK_MIN_WIDTH = 8;
export const MEMORY_BLOCK_MAX_WIDTH = 1024;
export const MEMORY_MAX_ROWS = 8192;
/** Upper bound for one uploaded window (bytes). */
export const MEMORY_MAX_WINDOW_BYTES = 48 * 1024 * 1024;

const DEPTH_BYTES_PER_PIXEL: Record<MemoryDepth, number> = { '8': 4, '16': 8, '32': 16 };

export interface MemoryWindowPlan {
  depth: MemoryDepth;
  bytesPerPixel: number;
  /** Interpreted pixel columns. */
  memWidth: number;
  /** Interpreted pixel rows (square pixels, covering the output aspect). */
  memRows: number;
  /** Texture width in u32 words. */
  wordsPerRow: number;
  /** Total window bytes. */
  bytes: number;
}

export function numberParam(params: Record<string, Primitive>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function depthParam(params: Record<string, Primitive>): MemoryDepth {
  const value = String(params.depth ?? '8');
  return value === '16' || value === '32' ? value : '8';
}

export function motionParam(params: Record<string, Primitive>): MemoryMotion {
  const value = String(params.motion ?? 'static');
  return value === 'advance' || value === 'shuffle' ? value : 'static';
}

export function planMemoryWindow(
  params: Record<string, Primitive>,
  outputWidth: number,
  outputHeight: number,
): MemoryWindowPlan {
  const depth = depthParam(params);
  const bytesPerPixel = DEPTH_BYTES_PER_PIXEL[depth];
  const memWidth = Math.max(
    MEMORY_BLOCK_MIN_WIDTH,
    Math.min(MEMORY_BLOCK_MAX_WIDTH, Math.round(numberParam(params, 'size', 320))),
  );
  const aspect = outputHeight > 0 && outputWidth > 0 ? outputHeight / outputWidth : 9 / 16;
  const rowBytes = memWidth * bytesPerPixel;
  const rowCap = Math.max(1, Math.floor(MEMORY_MAX_WINDOW_BYTES / rowBytes));
  const memRows = Math.max(1, Math.min(MEMORY_MAX_ROWS, rowCap, Math.ceil(memWidth * aspect)));
  return {
    depth,
    bytesPerPixel,
    memWidth,
    memRows,
    wordsPerRow: (memWidth * bytesPerPixel) / 4,
    bytes: rowBytes * memRows,
  };
}

/** Deterministic hash → [0, 1). Same frame + seed always yields the same block. */
export function hashFrame(frameIndex: number, seed: number): number {
  let h = (Math.imul(frameIndex | 0, 0x9e3779b1) ^ Math.imul((seed | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h / 4294967296;
}

export function frameIndexAt(timelineTimeSeconds: number, frameRate: number): number {
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return Math.max(0, Math.floor(timelineTimeSeconds * fps + 1e-6));
}

/**
 * Byte offset of the window inside a source of `sourceLength` bytes. Always
 * wraps into range so the window is never empty as long as the source exists.
 */
export function resolveWindowOffset(
  params: Record<string, Primitive>,
  frameIndex: number,
  sourceLength: number,
): number {
  if (sourceLength <= 0) return 0;
  const base = Math.max(0, numberParam(params, 'offset', 0)) * 1024 * 1024;
  const stride = Math.max(0, numberParam(params, 'stride', 64)) * 1024;
  const seed = Math.round(numberParam(params, 'seed', 1));
  let offset = base;
  switch (motionParam(params)) {
    case 'advance':
      offset = base + frameIndex * stride;
      break;
    case 'shuffle':
      offset = base + Math.floor(hashFrame(frameIndex, seed) * sourceLength);
      break;
    default:
      break;
  }
  // Keep word alignment so u32 texels never straddle a pixel boundary.
  offset = Math.floor(offset / 4) * 4;
  return ((offset % sourceLength) + sourceLength) % sourceLength;
}

/**
 * Extract `length` bytes starting at `offset`, wrapping around the end of the
 * source. Returns a zero-copy subarray when no wrap is needed.
 */
export function sliceWindow(source: Uint8Array, offset: number, length: number): Uint8Array {
  if (source.length === 0 || length <= 0) return new Uint8Array(0);
  const start = ((offset % source.length) + source.length) % source.length;
  if (start + length <= source.length) {
    return source.subarray(start, start + length);
  }
  const out = new Uint8Array(length);
  let written = 0;
  let cursor = start;
  while (written < length) {
    const chunk = Math.min(length - written, source.length - cursor);
    out.set(source.subarray(cursor, cursor + chunk), written);
    written += chunk;
    cursor = (cursor + chunk) % source.length;
  }
  return out;
}

export const HEAP_PAGE_BYTES = 64 * 1024;
/** Fraction of non-zero words a 64 KB page needs to count as populated. */
export const HEAP_PAGE_MIN_DENSITY = 0.02;

/**
 * Populated pages of a heap, in address order. The effect walks a virtual
 * address space made only of these pages, so moving blocks never scroll into
 * untouched (all-zero) wasm memory, wherever the populated pages sit.
 */
export interface HeapPageMap {
  pageBytes: number;
  /** Indices of populated pages in the underlying heap. */
  pages: Uint32Array;
  /** `pages.length * pageBytes` */
  virtualLength: number;
}

export function buildHeapPageMap(
  bytes: Uint8Array,
  pageBytes = HEAP_PAGE_BYTES,
  minDensity = HEAP_PAGE_MIN_DENSITY,
): HeapPageMap {
  const wordsPerPage = pageBytes >> 2;
  const wordCount = Math.floor(bytes.byteLength / 4);
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, wordCount);
  const fullPages = Math.floor(wordCount / wordsPerPage);
  const populated: number[] = [];
  for (let page = 0; page < fullPages; page += 1) {
    const base = page * wordsPerPage;
    let nonZero = 0;
    for (let index = 0; index < wordsPerPage; index += 1) {
      if (words[base + index] !== 0) nonZero += 1;
    }
    if (nonZero / wordsPerPage >= minDensity) populated.push(page);
  }
  // An all-zero heap still yields its first page so the effect renders
  // deterministically (black) instead of failing.
  if (populated.length === 0 && fullPages > 0) populated.push(0);
  const pages = Uint32Array.from(populated);
  return { pageBytes, pages, virtualLength: pages.length * pageBytes };
}

/**
 * Copy `length` bytes starting at `virtualOffset` of the page map's virtual
 * address space into a fresh buffer, wrapping at the end.
 */
export function gatherHeapWindow(
  bytes: Uint8Array,
  map: HeapPageMap,
  virtualOffset: number,
  length: number,
): Uint8Array {
  const out = new Uint8Array(Math.max(0, length));
  if (map.virtualLength === 0 || length <= 0) return out;
  let cursor = ((virtualOffset % map.virtualLength) + map.virtualLength) % map.virtualLength;
  let written = 0;
  while (written < length) {
    const pageSlot = Math.floor(cursor / map.pageBytes);
    const inPage = cursor - pageSlot * map.pageBytes;
    const chunk = Math.min(length - written, map.pageBytes - inPage);
    const start = map.pages[pageSlot] * map.pageBytes + inPage;
    out.set(bytes.subarray(start, start + chunk), written);
    written += chunk;
    cursor = (cursor + chunk) % map.virtualLength;
  }
  return out;
}
