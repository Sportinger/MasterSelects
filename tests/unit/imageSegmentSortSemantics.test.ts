import { describe, expect, it } from 'vitest';
import { imageSegmentSize, roundImageSegmentScale, sortImageSegment, type ImageSegmentRgba } from '../../src/services/operators/imageSegmentSortSemantics';

const rgba = (tone: number, alpha = tone + .1): ImageSegmentRgba => [tone, tone, tone, alpha];

describe('bounded image segment sort semantics', () => {
  it('uses WGSL nearest-even rounding before the 4..16 clamp', () => {
    expect(roundImageSegmentScale(4.5)).toBe(4);
    expect(roundImageSegmentScale(5.5)).toBe(6);
    expect(imageSegmentSize(2.9)).toBe(4);
    expect(imageSegmentSize(18.1)).toBe(16);
  });

  it('sorts whole RGBA records by source-encoded Rec709 and keeps equal-luma order stable', () => {
    const equalA: ImageSegmentRgba = [.3, .2, .1, .25];
    const equalB: ImageSegmentRgba = [.3, .2, .1, .75];
    const source = [rgba(.1), equalA, equalB, rgba(.8)];
    const result = sortImageSegment({ pixel: [0, 0], resolution: [4, 1], scale: 4,
      loadPixel: ([x]) => source[x] });
    expect(result.records.slice(0, 4)).toEqual([rgba(.1), equalA, equalB, rgba(.8)]);
    expect(result.records[1][3]).toBe(.25); expect(result.records[2][3]).toBe(.75);
  });

  it('rejects invalid raster context instead of returning an undefined record', () => {
    const loadPixel = () => rgba(0);
    expect(() => sortImageSegment({ pixel: [-1, 0], resolution: [4, 1], scale: 4, loadPixel })).toThrow(/in-bounds integer/);
    expect(() => sortImageSegment({ pixel: [0, 0], resolution: [0, 1], scale: 4, loadPixel })).toThrow(/positive integers/);
    expect(() => sortImageSegment({ pixel: [.5, 0], resolution: [4, 1], scale: 4, loadPixel })).toThrow(/in-bounds integer/);
  });

  it('duplicates the final real sample to fill sixteen records for short segments', () => {
    const result = sortImageSegment({ pixel: [1, 0], resolution: [8, 1], scale: 4,
      loadPixel: ([x]) => rgba(x / 10) });
    expect(result.records).toHaveLength(16);
    expect(result.records.filter(color => color[0] === .3)).toHaveLength(13);
  });

  it('clamps right-edge loads before invoking the caller and exposes the selected output index', () => {
    const calls: number[] = [];
    const result = sortImageSegment({ pixel: [9, 2], resolution: [10, 3], scale: 8,
      loadPixel: ([x, y]) => { calls.push(x); expect(y).toBe(2); return rgba(x / 10); } });
    expect(result).toMatchObject({ segmentSize: 8, segmentStart: 8, outputIndex: 1 });
    expect(Math.max(...calls)).toBe(9);
    expect(result.color).toEqual(rgba(.9));
  });
});
