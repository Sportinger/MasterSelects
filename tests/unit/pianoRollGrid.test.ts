import { describe, expect, it } from 'vitest';
import { buildPianoRollGrid } from '../../src/components/pianoRoll/pianoRollGrid';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';
import type { RulerTick } from '../../src/components/timeline/utils/timelineGrid';

// Default map is constant 4/4 @ 60 BPM, so bar N starts at (N-1)*4s and beats sit
// on integer seconds. These expectations are PINNED to the clip→absolute mapping,
// not re-derived from the generators, so an offset/sign regression fails loudly.

const findTick = (ticks: RulerTick[], time: number): RulerTick | undefined =>
  ticks.find((t) => Math.abs(t.time - time) < 1e-6);

describe('buildPianoRollGrid', () => {
  // Clip window [10s, 20s] absolute, 100px/s, full window visible.
  const base = {
    tempoMap: createDefaultTempoMap(),
    clipStartTime: 10,
    clipDuration: 10,
    pxPerSec: 100,
    visibleStartPx: 0,
    visibleWidthPx: 1000,
  };

  it('maps an absolute bar to a clip-local pixel by clipStartTime offset', () => {
    const grid = buildPianoRollGrid(base);

    // Bar 4 starts at absolute 12s; pixel 0 is the clip's left edge (= 10s), so
    // bar 4 lands at (12 - 10) * 100 = 200px = 2 * pxPerSec.
    const bar4 = grid.barLines.find((l) => Math.abs(l.time - 12) < 1e-6);
    expect(bar4).toBeDefined();
    expect(bar4!.pixelX).toBeCloseTo(200);

    // All bar starts in [10,20]: bars 4,5,6 at 12,16,20 → 200,600,1000px.
    expect(grid.barLines.map((l) => l.time)).toEqual([12, 16, 20]);
    expect(grid.barLines.map((l) => l.pixelX)).toEqual([200, 600, 1000]);
  });

  it('emits the bar label and Time label identical to the timeline', () => {
    const grid = buildPianoRollGrid(base);

    const barTick = findTick(grid.rulerTicks.bars, 12);
    expect(barTick?.label).toBe('4'); // bar number

    const timeTick = findTick(grid.rulerTicks.time, 12);
    expect(timeTick?.label).toBe('00:12.00'); // MM:SS.cc, shared formatter
  });

  it('does NOT drop ticks past the clip-local duration (absolute-window gotcha)', () => {
    // Every absolute time here (12,16,20) exceeds the clip-local duration (10s).
    // If the adapter passed clipDuration instead of the absolute end, these would
    // be silently clamped away.
    const grid = buildPianoRollGrid(base);
    expect(findTick(grid.rulerTicks.bars, 20)).toBeDefined();
    expect(grid.barLines.some((l) => Math.abs(l.time - 20) < 1e-6)).toBe(true);
  });

  it('separates bar starts (strong) from beats (medium)', () => {
    const grid = buildPianoRollGrid(base);
    // 11 integer-second lines in [10,20]; 3 are bar starts, 8 are beats.
    expect(grid.barLines).toHaveLength(3);
    expect(grid.beatLines).toHaveLength(8);
    expect(grid.subLines).toHaveLength(0); // gridResolution defaults to 1
    expect(grid.beatLines.map((l) => l.time)).toEqual([10, 11, 13, 14, 15, 17, 18, 19]);
  });

  it('windows to the visible pixel range only', () => {
    // visible px [300,500] → absolute [13s,15s]; no bar start in that span.
    const grid = buildPianoRollGrid({ ...base, visibleStartPx: 300, visibleWidthPx: 200 });
    expect(grid.barLines).toHaveLength(0);
    expect(grid.beatLines.map((l) => l.time)).toEqual([13, 14, 15]);
    expect(grid.beatLines.map((l) => l.pixelX)).toEqual([300, 400, 500]);
  });

  it('interpolates sub-lines when gridResolution > 1', () => {
    const grid = buildPianoRollGrid({ ...base, gridResolution: 2 });
    // One sub-line halfway between each adjacent beat pair (10 gaps).
    expect(grid.subLines).toHaveLength(10);
    const first = grid.subLines[0];
    expect(first.time).toBeCloseTo(10.5);
    expect(first.pixelX).toBeCloseTo(50);
  });

  it('returns empty grids when the window is past the clip end', () => {
    const grid = buildPianoRollGrid({ ...base, visibleStartPx: 2000, visibleWidthPx: 200 });
    expect(grid.barLines).toHaveLength(0);
    expect(grid.beatLines).toHaveLength(0);
    expect(grid.rulerTicks.bars).toHaveLength(0);
    expect(grid.rulerTicks.time).toHaveLength(0);
  });
});
