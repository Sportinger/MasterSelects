import { describe, expect, it } from 'vitest';
import { parameterSourceTargets, type ParameterSourceClip } from '../../src/services/parameterSources/parameterSourceTargets';
import { applyParameterSourcesToEffects } from '../../src/services/parameterSources/parameterSourceRendering';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';

function fixture(value = .75): ParameterSourceClip {
  const node = createControlNode('values.number', 'level');
  node.constants = { value };
  return { startTime: 10, effects: [{ id: 'scan', type: 'slit-scan', name: 'Slit Scan', enabled: true,
    params: { delay: 2, mapAmount: .1, mapNoiseAmount: .2 } }],
    nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes: [node], edges: [], layout: {} },
      targets: Object.fromEntries(['delay', 'mapAmount', 'mapNoiseAmount'].map(name => [`effect.scan.${name}`,
        { source: { nodeId: 'level', portId: 'value' } }])) } } };
}

describe('Slit Scan parameter sources', () => {
  it('exposes the three supported controls with their actual runtime ranges', () => {
    expect(parameterSourceTargets(fixture()).map(({ path, hardMin, hardMax, unit }) => ({ path, hardMin, hardMax, unit }))).toEqual([
      { path: 'effect.scan.delay', hardMin: 0, hardMax: 60, unit: 'seconds' },
      { path: 'effect.scan.mapAmount', hardMin: 0, hardMax: 1, unit: 'number' },
      { path: 'effect.scan.mapNoiseAmount', hardMin: 0, hardMax: 1, unit: 'number' },
    ]);
  });
  it('uses the shared render path and preserves authored values through bypass and persistence', () => {
    const clip = fixture(), saved = JSON.parse(JSON.stringify(clip));
    expect(applyParameterSourcesToEffects(saved, [], 0, saved.effects)[0].params).toEqual({ delay: .75, mapAmount: .75, mapNoiseAmount: .75 });
    saved.nodeGraph.parameterSources.targets['effect.scan.delay'].enabled = false;
    expect(applyParameterSourcesToEffects(saved, [], 0, saved.effects)[0].params.delay).toBe(2);
    expect(clip.effects[0].params).toEqual({ delay: 2, mapAmount: .1, mapNoiseAmount: .2 });
  });
  it('rejects values outside the runtime range before rendering', () => {
    const clip = fixture(2);
    expect(() => applyParameterSourcesToEffects(clip, [], 0, clip.effects)).toThrow('outside the runtime range');
  });
});
