import { describe, expect, it } from 'vitest';
import { parameterSourceTargets, type ParameterSourceClip } from '../../src/services/parameterSources/parameterSourceTargets';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import type { Effect } from '../../src/types/effects';

function weaveClip(driven?: number) {
  const effect: Effect = { id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
  const node = createControlNode('values.number', 'level');
  node.constants = { value: driven ?? 0 };
  return { id: 'clip', startTime: 0, inPoint: 0, outPoint: 10, duration: 10, effects: [effect],
    ...(driven === undefined ? {} : { nodeGraph: { version: 1 as const, nodes: [], parameterSources: { version: 1 as const, clipTimeOffset: 0,
      graph: { version: 1 as const, nodes: [node], edges: [], layout: {} },
      targets: { 'effect.fx.reveal_value': { source: { nodeId: 'level', portId: 'value' } } } } } }) };
}
const visibleShare = (clip: ReturnType<typeof weaveClip>) => {
  const program = buildStrandsLayerSources(clip as never, 8, [])[0].source.strands.program;
  const radius = evaluateGeometryProgram(program).radius!;
  return radius.filter(value => value > 0).length / radius.length;
};

describe('Weave parameter sources', () => {
  it('offers the exposed graph values of any graph effect as drivable targets', () => {
    const targets = parameterSourceTargets(weaveClip() as unknown as ParameterSourceClip);
    expect(targets.map(({ path, label, min, max }) => ({ path, label, min, max }))).toEqual([
      { path: 'effect.fx.reveal_value', label: 'Reveal', min: 0, max: 1 },
      { path: 'effect.fx.weave_value', label: 'Weave Speed', min: 0, max: 10 },
      { path: 'effect.fx.irregularity_value', label: 'Irregularity', min: 0, max: 3 },
    ]);
    expect(targets.every(target => target.group === 'Weave' && target.value === 1)).toBe(true);
  });

  it('drives the weave through a control source on the shared effect override', () => {
    expect(visibleShare(weaveClip())).toBe(1);
    expect(visibleShare(weaveClip(0))).toBeLessThan(0.02);
    expect(visibleShare(weaveClip(1))).toBe(1);
  });
});
