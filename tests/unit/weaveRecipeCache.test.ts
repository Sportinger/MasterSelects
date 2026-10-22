// A Weave added in this session has no graph yet; keyframe evaluation hands the render a new Effect
// object every frame, so the recipe must be resolved once per Form, not once per frame.
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/services/operators/geometry/weaveGraph', async original => {
  const actual = await original<typeof import('../../src/services/operators/geometry/weaveGraph')>();
  return { ...actual, weaveOperatorGraph: (...args: Parameters<typeof actual.weaveOperatorGraph>) => { calls.count++; return actual.weaveOperatorGraph(...args); } };
});

import { getDefaultParams } from '../../src/effects';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import type { Keyframe } from '../../src/types/keyframes';

describe('Weave recipe resolution without a stored graph', () => {
  it('resolves a graphless Qualle once while a keyed Pulse Rate hands over a fresh effect every frame', () => {
    const params = { ...getDefaultParams('weave'), form: 'qualle' } as Record<string, unknown>;
    const keys = [0, 4].map((time, i) => ({ id: `k${i}`, clipId: 'c', time, property: 'effect.fx.pulse-rate_value', value: i ? 1 : 0.4, easing: 'linear' }) as Keyframe);
    const clip = (time: number) => ({ id: 'c', startTime: 0, inPoint: 0, outPoint: 10, duration: 10,
      effects: [{ id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: { ...params, 'pulse-rate_value': 0.4 + time * 0.15 } }] });
    calls.count = 0;
    let layers = 0;
    for (let frame = 0; frame < 12; frame++) layers += buildStrandsLayerSources(clip(frame / 30) as never, frame / 30, keys).length;
    expect(layers).toBe(12);
    expect(calls.count).toBe(1);
  });

  it('switches recipe with Form', () => {
    const effect = (form: string) => ({ id: 'c', startTime: 0, effects: [{ id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: { ...getDefaultParams('weave'), form } }] });
    const cloth = buildStrandsLayerSources(effect('cloth') as never, 1, [])[0].source.strands.program;
    const qualle = buildStrandsLayerSources(effect('qualle') as never, 1, [])[0].source.strands.program;
    expect(cloth).not.toEqual(qualle);
  });
});
