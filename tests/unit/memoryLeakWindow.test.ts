import { describe, expect, it } from 'vitest';
import {
  MEMORY_MAX_WINDOW_BYTES,
  hashFrame,
  buildHeapPageMap,
  gatherHeapWindow,
  planMemoryWindow,
  resolveWindowOffset,
  sliceWindow,
} from '../../src/effects/generate/memoryLeak/memoryWindow';

describe('planMemoryWindow', () => {
  it('covers the output aspect with square pixels', () => {
    const plan = planMemoryWindow({ size: 320, depth: '8' }, 1920, 1080);
    expect(plan.memWidth).toBe(320);
    expect(plan.memRows).toBe(180);
    expect(plan.wordsPerRow).toBe(320);
    expect(plan.bytes).toBe(320 * 4 * 180);
  });

  it('uses more words per pixel for deeper interpretations', () => {
    expect(planMemoryWindow({ size: 100, depth: '16' }, 100, 100).wordsPerRow).toBe(200);
    expect(planMemoryWindow({ size: 100, depth: '32' }, 100, 100).wordsPerRow).toBe(400);
  });

  it('clamps width and caps the window size', () => {
    const plan = planMemoryWindow({ size: 99999, depth: '32' }, 1080, 19200);
    expect(plan.memWidth).toBe(1024);
    expect(plan.bytes).toBeLessThanOrEqual(MEMORY_MAX_WINDOW_BYTES);
  });
});

describe('resolveWindowOffset', () => {
  const length = 10 * 1024 * 1024;

  it('holds the base offset in static mode', () => {
    expect(resolveWindowOffset({ offset: 1, motion: 'static' }, 0, length)).toBe(1024 * 1024);
    expect(resolveWindowOffset({ offset: 1, motion: 'static' }, 500, length)).toBe(1024 * 1024);
  });

  it('advances by the stride per frame and wraps', () => {
    const params = { offset: 0, motion: 'advance', stride: 1024 };
    expect(resolveWindowOffset(params, 1, length)).toBe(1024 * 1024);
    expect(resolveWindowOffset(params, 10, length)).toBe(0);
  });

  it('is deterministic and word aligned in shuffle mode', () => {
    const params = { offset: 0, motion: 'shuffle', seed: 7 };
    const first = resolveWindowOffset(params, 12, length);
    expect(resolveWindowOffset(params, 12, length)).toBe(first);
    expect(first % 4).toBe(0);
    expect(resolveWindowOffset(params, 13, length)).not.toBe(first);
  });

  it('hashes frames without collisions on consecutive indices', () => {
    const values = new Set<number>();
    for (let index = 0; index < 64; index += 1) values.add(hashFrame(index, 3));
    expect(values.size).toBe(64);
  });
});

describe('sliceWindow', () => {
  const source = Uint8Array.from({ length: 16 }, (_, index) => index);

  it('returns a zero-copy view when the window fits', () => {
    const view = sliceWindow(source, 4, 8);
    expect(view.buffer).toBe(source.buffer);
    expect(Array.from(view)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('wraps around the end of the source', () => {
    expect(Array.from(sliceWindow(source, 12, 8))).toEqual([12, 13, 14, 15, 0, 1, 2, 3]);
    expect(Array.from(sliceWindow(source, 2, 20))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5]);
  });
});

describe('buildHeapPageMap / gatherHeapWindow', () => {
  const PAGE = 64 * 1024;

  it('keeps only pages with enough non-zero words, wherever they are', () => {
    const heap = new Uint8Array(8 * PAGE);
    heap.fill(0xab, 0, PAGE);              // page 0 dense
    heap[3 * PAGE + 12] = 1;               // page 3 has a single word: too sparse
    heap.fill(0x11, 6 * PAGE, 6 * PAGE + PAGE / 4); // page 6 quarter full
    const map = buildHeapPageMap(heap);
    expect(Array.from(map.pages)).toEqual([0, 6]);
    expect(map.virtualLength).toBe(2 * PAGE);
  });

  it('falls back to the first page for an all-zero heap', () => {
    const map = buildHeapPageMap(new Uint8Array(4 * PAGE));
    expect(Array.from(map.pages)).toEqual([0]);
  });

  it('gathers across populated pages and wraps', () => {
    const heap = new Uint8Array(4 * PAGE);
    heap.fill(1, 0, PAGE);
    heap.fill(3, 3 * PAGE, 4 * PAGE);
    const map = buildHeapPageMap(heap);
    const window = gatherHeapWindow(heap, map, PAGE - 2, 6);
    expect(Array.from(window)).toEqual([1, 1, 3, 3, 3, 3]);
    const wrapped = gatherHeapWindow(heap, map, 2 * PAGE - 2, 4);
    expect(Array.from(wrapped)).toEqual([3, 3, 1, 1]);
  });
});
