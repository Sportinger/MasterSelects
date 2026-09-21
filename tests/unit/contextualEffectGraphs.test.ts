import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { VIGNETTE_PARAMS } from '../../src/effects/stylize/vignette/parameters';
import { createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';
import {
  effectOperatorGraph,
  effectOperatorParams,
  isImageGraphEffectType,
  isLocalImageEffectType,
  migratePersistedEffectOperatorGraph,
} from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { createMockClip } from '../helpers/mockData';

const pixel: [number, number, number, number] = [0.2, 0.4, 0.8, 0.35];
const effect = (params: Record<string, unknown> = getDefaultParams('vignette')): Effect =>
  ({ id: 'vignette-fx', name: 'Vignette', type: 'vignette', enabled: true, params });
const evaluate = (params: Record<string, unknown>, uv: [number, number]) =>
  evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultVignetteGraph(), params), pixel, { uv });

describe('contextual image effect graph ownership', () => {
  it('shares the exact legacy vignette schema while remaining outside the pixel-only inline set', () => {
    expect(getEffect('vignette')?.params).toBe(VIGNETTE_PARAMS);
    expect(VIGNETTE_PARAMS).toMatchObject({
      amount: { default: 0.5, min: 0, max: 1 }, size: { default: 0.5, min: 0, max: 1.5 },
      softness: { default: 0.5, min: 0, max: 1 }, roundness: { default: 1, min: 0.5, max: 2 },
    });
    expect(isImageGraphEffectType('vignette')).toBe(true);
    expect(isLocalImageEffectType('vignette')).toBe(false);
  });

  it('matches the legacy center/aspect/smoothstep factor and preserves alpha', () => {
    expect(evaluate(getDefaultParams('vignette'), [0.5, 0.5])).toEqual(pixel);
    expect(evaluate(getDefaultParams('vignette'), [1, 0.5])).toEqual([0.1, 0.2, 0.4, 0.35]);
    expect(createDefaultVignetteGraph().nodes.map(node => node.operator)).toContain('image.normalized-uv');
  });

  it('derives params{} defaults and round-trips the canonical contextual graph', () => {
    const legacy = effect({});
    expect(effectOperatorParams(legacy)).toEqual(getDefaultParams('vignette'));
    const graph = effectOperatorGraph(legacy);
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    expect(effectOperatorGraph(JSON.parse(JSON.stringify(canonical)) as Effect)).toEqual(graph);
    expect(canonical.operatorGraph?.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
  });

  it('keeps UV vec2 component labels distinct from RGBA color channels', () => {
    const vignetteEffect = effect();
    const projected = buildEffectOperatorGraph(createMockClip({ effects: [vignetteEffect] }), vignetteEffect);
    const aspect = projected.nodes.find(node => node.id === 'aspect');
    expect(aspect?.inputs.map(port => port.label)).toEqual(['X', 'Y']);
  });
});
