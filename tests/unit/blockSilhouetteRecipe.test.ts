import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultBlockSilhouetteGraph } from '../../src/services/operators/blockSilhouetteRecipe';
import { isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const size: [number, number] = [96, 64];
const disc = (x: number, y: number): Pixel => Math.hypot(x - 48, y - 32) < 22 ? [.1, .1, .1, 1] : [1, 1, 1, 1];
function render(overrides: Params, image: (x: number, y: number) => Pixel = disc) {
  const params = { ...getDefaultParams('block-silhouette'), ...overrides };
  const plan = compileImageOperatorGraph(createDefaultBlockSilhouetteGraph(), params, { parameterSchema: getEffect('block-silhouette')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { filterResources: true, float16: true });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]]);
}
const close = (a: Pixel, b: number[]) => a.slice(0, 3).every((value, channel) => Math.abs(value - b[channel]) < 2e-2);

describe('Block Silhouette recipe', () => {
  it('is a graph-owned image effect', () => expect(isImageGraphEffectType('block-silhouette')).toBe(true));

  it('paints dark blocks Ink and light blocks Paper, and Invert swaps them', () => {
    const plain = render({ marks: 'none', scale: 120, threshold: .35 });
    expect(close(plain(48, 32), [0, 0, 0])).toBe(true);
    expect(close(plain(2, 2), [0xee / 255, 1, 0x0d / 255])).toBe(true);
    const inverted = render({ marks: 'none', scale: 120, invert: 1, threshold: .35 });
    expect(close(inverted(48, 32), [0xee / 255, 1, 0x0d / 255])).toBe(true);
  });

  it('counts transparency as light', () => {
    const clear = render({ marks: 'none' }, () => [0, 0, 0, 0]);
    expect(close(clear(10, 10), [0xee / 255, 1, 0x0d / 255])).toBe(true);
    expect(clear(10, 10)[3]).toBeCloseTo(1, 3);
  });

  it('draws marks in the colour opposite to the block', () => {
    const output = render({ scale: 120, marks: 'dots', markArea: 'everywhere', markAmount: 1, gridSize: 400, markSize: 24, threshold: .35 });
    // The grid point at the frame centre lies on the dark disc: a Paper-coloured dot.
    expect(close(output(48, 32), [0xee / 255, 1, 0x0d / 255])).toBe(true);
  });

  it('keeps marks to the outline with Mark Area: Edges, and to one colour with Ink or Paper', () => {
    const base = { scale: 60, gridSize: 60, markSize: 6, threshold: .35, markAmount: 1 };
    const plain = render({ ...base, marks: 'none' });
    // A mark is a pixel that differs from the same silhouette without marks.
    const count = (overrides: Params) => {
      const output = render({ ...base, marks: 'dots', ...overrides });
      let marked = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) if (Math.abs(output(x, y)[0] - plain(x, y)[0]) > .5) marked++;
      return marked;
    };
    const everywhere = count({ markArea: 'everywhere' }), edges = count({ markArea: 'edges' });
    expect(everywhere).toBeGreaterThan(edges);
    expect(count({ markArea: 'ink' }) + count({ markArea: 'paper' })).toBe(everywhere);
  });

  it('leaves the picture unchanged at Amount 0', () => {
    const output = render({ amount: 0 });
    expect(close(output(48, 32), [.1, .1, .1])).toBe(true);
    expect(close(output(1, 1), [1, 1, 1])).toBe(true);
  });
});
