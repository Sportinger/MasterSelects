import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { SEGMENT_SORT_CHUNK, segmentSortShift, segmentSortSlope, segmentSortSourceMap } from '../../src/services/operators/imageSegmentSortAxis';
import { SEGMENT_SORT_WGSL, segmentSortEntries } from '../../src/effects/ImageGraphSegmentSortPass';
import { AnalogRecipeBuilder } from '../../src/services/operators/analogRecipeBuilder';
import { createImagePassEvaluator, type Pixel } from '../helpers/imageGraphPasses';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { operatorVisibility } from '../../src/services/operators/operatorTaxonomy';

const control = (keys: number[], starts: number[] = [], angle = 0) => (index: number) => [keys[index], starts[index] ?? 0, index === 0 ? angle : 0] as const;

describe('Segment Sort reference (image.segment-sort-axis)', () => {
  it('sorts each column by key, stably, with runs split at Run Start', () => {
    // One column of six pixels; a run starts at index 3.
    const keys = [.9, .1, .5, .8, .2, .2];
    const map = segmentSortSourceMap(1, 6, control(keys, [0, 0, 0, 1, 0, 0]), { axis: 'columns', order: 'ascending' });
    expect([...map]).toEqual([1, 2, 0, 4, 5, 3]);
    const descending = segmentSortSourceMap(1, 6, control(keys, [0, 0, 0, 1, 0, 0]), { axis: 'columns', order: 'descending' });
    expect([...descending]).toEqual([0, 2, 1, 3, 4, 5]);
  });

  it('sorts rows independently along the x axis', () => {
    const keys = [.5, .1, .3, /* row 1 */ .2, .9, .1];
    const map = segmentSortSourceMap(3, 2, control(keys), { axis: 'rows', order: 'ascending' });
    expect([...map]).toEqual([1, 2, 0, 5, 3, 4]);
  });

  it('keeps every pixel exactly once for a slanted sort (a permutation) and clamps the angle to 45°', () => {
    const width = 17, height = 11, keys = Array.from({ length: width * height }, (_, index) => ((index * 37) % 23) / 23);
    for (const angle of [-80, -30, 0, 12, 45]) {
      const map = segmentSortSourceMap(width, height, control(keys, [], angle), { axis: 'columns', order: 'ascending' });
      expect(new Set(map).size).toBe(width * height);
    }
    expect(segmentSortSlope(80)).toBeCloseTo(1, 6);
    expect(segmentSortSlope(Number.NaN)).toBe(0);
    expect(segmentSortShift(3, .5)).toBe(2); // 1.5 rounds half up
  });

  it('moves a pixel only along its slanted line', () => {
    const width = 9, height = 9, slope = segmentSortSlope(30);
    const keys = Array.from({ length: width * height }, (_, index) => 1 - (index % 7) / 7);
    const map = segmentSortSourceMap(width, height, control(keys, [], 30), { axis: 'columns', order: 'ascending' });
    map.forEach((source, target) => {
      const line = (index: number) => index % width - segmentSortShift(Math.floor(index / width), slope);
      expect(line(source)).toBe(line(target));
    });
  });

  it('breaks runs every SEGMENT_SORT_CHUNK pixels, like the GPU workgroup', () => {
    // Only the last pixel of each chunk is dark: each chunk sorts it to the chunk's first place.
    const along = SEGMENT_SORT_CHUNK + 4, keys = Array.from({ length: along }, (_, index) => index === SEGMENT_SORT_CHUNK - 1 || index === along - 1 ? 0 : 1);
    const map = segmentSortSourceMap(1, along, control(keys), { axis: 'columns', order: 'ascending' });
    expect(map[0]).toBe(SEGMENT_SORT_CHUNK - 1);
    expect(map[SEGMENT_SORT_CHUNK]).toBe(along - 1);
    expect(segmentSortEntries(1080)).toBe(2048);
    expect(segmentSortEntries(9000)).toBe(SEGMENT_SORT_CHUNK);
  });

  it('fits the packed entries in 16 KiB of workgroup memory and is a public node', () => {
    expect(SEGMENT_SORT_WGSL).toContain(`array<u32, ${SEGMENT_SORT_CHUNK}>`);
    expect(SEGMENT_SORT_CHUNK * 4).toBeLessThanOrEqual(16384);
    const operator = getEffectOperator('image.segment-sort-axis')!;
    expect(operator.fusion).toBe('pass-boundary');
    expect(operatorVisibility(operator)).toBe('public');
  });
});

describe('Segment Sort in an image graph', () => {
  const size: [number, number] = [6, 5];
  /** Columns of distinct brightness, darker towards the bottom in column 0 only. */
  const pixel = (x: number, y: number): Pixel => x === 0 ? [1 - y / 5, 0, 0, 1] : [x / 6, y / 5, .5, 1];
  const image = ([u, v]: [number, number]): Pixel => pixel(Math.min(size[0] - 1, Math.floor(u * size[0])), Math.min(size[1] - 1, Math.floor(v * size[1])));

  function sortGraph(axis: 'columns' | 'rows', withStart: boolean) {
    const g = new AnalogRecipeBuilder();
    g.add('frame', 'image.frame');
    g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
    g.add('key', 'color.luminance-rec709.rgb', { rgb: ['split', 'rgb'] });
    const inputs: Record<string, readonly [string, string] | string> = { image: ['frame', 'image'], key: 'key' };
    if (withStart) inputs.start = g.number('no-start', 0);
    g.add('sort', 'image.segment-sort-axis', inputs, { bindings: {}, constants: { axis } });
    g.add('output', 'image.output', { image: ['sort', 'image'] });
    return g.graph();
  }

  it('compiles into a colour pass and a sort pass and sorts each column by luminance', () => {
    const plan = compileImageOperatorGraph(sortGraph('columns', true));
    const sortPass = plan.passes!.find(pass => pass.segmentSort);
    expect(sortPass?.segmentSort?.settings).toEqual({ axis: 'columns', order: 'ascending' });
    expect(plan.passes!.some(pass => pass.outputResource === sortPass!.segmentSort!.colorResource)).toBe(true);
    const evaluate = createImagePassEvaluator(plan, size, image);
    // Column 0 got brighter towards the bottom after an ascending sort.
    const column = [0, 1, 2, 3, 4].map(y => evaluate([.5 / size[0], (y + .5) / size[1]])[0]);
    expect(column).toEqual([...column].sort((a, b) => a - b));
    expect(column[0]).toBeCloseTo(pixel(0, 4)[0], 5);
  });

  it('sorts rows with Direction Rows and connects without a Run Start', () => {
    const plan = compileImageOperatorGraph(sortGraph('rows', false));
    const evaluate = createImagePassEvaluator(plan, size, image);
    const row = [0, 1, 2, 3, 4, 5].map(x => evaluate([(x + .5) / size[0], 4.5 / size[1]]));
    const luma = row.map(([r, g, b]) => .2126 * r + .7152 * g + .0722 * b);
    expect(luma).toEqual([...luma].sort((a, b) => a - b));
  });

  it('reports a missing Key input', () => {
    const g = new AnalogRecipeBuilder();
    g.add('frame', 'image.frame');
    g.add('sort', 'image.segment-sort-axis', { image: ['frame', 'image'] });
    g.add('output', 'image.output', { image: ['sort', 'image'] });
    expect(() => compileImageOperatorGraph(g.graph())).toThrow(/Key/);
  });
});
