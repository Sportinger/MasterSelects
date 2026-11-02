import { describe, expect, it } from 'vitest';
// @ts-expect-error The tutorial pipeline is plain ESM JavaScript without type declarations.
import { previewPlacements } from '../../scripts/tutorial-ms-preview.mjs';

const box = { x: 754, y: 220, width: 1282, height: 722 };
const base = { exportStart: 4.5, exportDuration: 6, toOutput: (time: number) => time };

describe('tutorial preview over the recording', () => {
  it('lays the export where the playhead of the take was', () => {
    const { placements, skipped } = previewPlacements([{ from: 3, to: 7, playhead: 5.4, box }], base);
    expect(skipped).toEqual([]);
    expect(placements).toHaveLength(1);
    expect(placements[0].at).toBeCloseTo(3);
    expect(placements[0].inPoint).toBeCloseTo(0.9);
    expect(placements[0].outPoint).toBeCloseTo(4.9);
  });

  it('fills a lead-in before the export with its first pictures, and says when a stretch ends after it', () => {
    const { placements, skipped } = previewPlacements([{ from: 3, to: 5, playhead: 4, box }], base);
    expect(skipped).toEqual([]);
    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ at: 3, inPoint: 0 });
    expect(placements[0].outPoint).toBeCloseTo(0.5);
    expect(placements[1].at).toBeCloseTo(3.5);
    expect(placements[1].inPoint).toBe(0);
    const late = previewPlacements([{ from: 3, to: 10, playhead: 9, box }], base);
    expect(late.placements[0].outPoint).toBe(6);
    expect(late.skipped[0].reason).toMatch(/after the export/);
  });

  it('leaves out a stretch under a zoom and one outside the export, and says so', () => {
    const zoomed = previewPlacements([{ from: 3, to: 7, playhead: 5, box }], { ...base, zoomAt: () => 1.3 });
    expect(zoomed.placements).toEqual([]);
    expect(zoomed.skipped[0].reason).toMatch(/zoom/);
    const outside = previewPlacements([{ from: 3, to: 7, playhead: 20, box }], base);
    expect(outside.placements).toEqual([]);
    expect(outside.skipped[0].reason).toMatch(/outside/);
  });

  it('places a stretch by output time when a wait was sped up', () => {
    const { placements } = previewPlacements([{ from: 10, to: 12, playhead: 5, box }], { ...base, toOutput: (time: number) => time - 4 });
    expect(placements[0].at).toBeCloseTo(6);
  });
});
