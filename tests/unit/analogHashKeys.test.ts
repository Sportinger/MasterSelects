import { describe, expect, it, vi } from 'vitest';

// Record every key the recipes hash (the CPU evaluator calls imageHashPcg2d for each hash node).
const keys: number[][] = [];
vi.mock('../../src/services/operators/imageHashPcg', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/services/operators/imageHashPcg')>();
  return { imageHashPcg2d: (value: readonly number[]) => { keys.push([value[0], value[1]]); return original.imageHashPcg2d(value); } };
});

const { compileImageOperatorGraph } = await import('../../src/services/operators/imageOperatorGraph');
const { createDefaultGlitchGraph } = await import('../../src/services/operators/glitchRecipe');
const { createDefaultFilmPrismGraph } = await import('../../src/services/operators/filmPrismRecipe');
const { getDefaultParams, getEffect } = await import('../../src/effects');
const { createImagePassEvaluator, discreteImage } = await import('../helpers/imageGraphPasses');

/**
 * The GPU computes hash keys in f32, the worker software path in f64. Both hash the same bits only
 * when every key component is an exact integer below 2^24 (and the neighbouring corners of a
 * grain cell then share bit-identical keys: no seams).
 */
function hashedKeys(type: string, graph: () => import('../../src/types/operatorGraph').EffectOperatorGraph,
  overrides: Record<string, number>, [width, height]: [number, number], time: number) {
  keys.length = 0;
  const plan = compileImageOperatorGraph(graph(), { ...getDefaultParams(type), ...overrides }, { parameterSchema: getEffect(type)!.params });
  const evaluate = createImagePassEvaluator(plan, [width, height], discreteImage(8, 8, () => [.5, .4, .3, 1]), { filterResources: true, float16: true, timelineTimeSeconds: time });
  // Pixels spread over the whole frame, right and bottom edges included.
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [Math.floor(width * .7), Math.floor(height * .4)], [width - 2, height - 3]]) {
    evaluate([(x + .5) / width, (y + .5) / height]);
  }
  return [...keys];
}

describe('analog recipe hash keys are exact small integers', () => {
  const exact = (value: number) => Number.isInteger(value) && Math.abs(value) < 2 ** 24;

  it('Glitch: every seed, state and cycle on long timelines', () => {
    for (const [time, seed, speed] of [[.5, 0, 1], [85.4, 17, 1], [3600.4, 9999, 1], [36000.1, 9999, 5], [36000.1, 3.7, 1]]) {
      const used = hashedKeys('glitch', createDefaultGlitchGraph, { amount: 1, density: 1, seed, speed, bands: 200 }, [7680, 4320], time);
      expect(used.length).toBeGreaterThan(0);
      for (const key of used) expect(key.every(exact), `t ${time} seed ${seed}: ${key}`).toBe(true);
    }
  });

  it('Film Prism: grain cells and frames at 8K with the finest grain, on long timelines', () => {
    for (const [time, grainSize] of [[.5, .5], [41.6, .5], [3600.4, 3], [36000.1, 6]]) {
      const used = hashedKeys('film-prism', createDefaultFilmPrismGraph, { amount: 1, grain: 1, grainSize, speed: 5 }, [7680, 4320], time);
      expect(used.length).toBeGreaterThan(0);
      for (const key of used) expect(key.every(exact), `t ${time} size ${grainSize}: ${key}`).toBe(true);
    }
  });
});
