import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { FISHEYE_PARAMS } from '../../src/effects/distort/fisheye/parameters';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import {
  effectOperatorCompileContext,
  effectOperatorGraph,
  effectOperatorParams,
  isImageGraphEffectType,
  isLocalImageEffectType,
} from '../../src/services/operators/effectGraphOwner';

const defaults = Object.fromEntries(Object.entries(FISHEYE_PARAMS).map(([id, schema]) => [id, schema.default]));

describe('Fisheye image operator graph ownership', () => {
  it('uses the canonical graph for legacy effects without a persisted graph', () => {
    expect(isImageGraphEffectType('fisheye')).toBe(true);
    expect(isLocalImageEffectType('fisheye')).toBe(false);
    expect(effectOperatorGraph({ type: 'fisheye', params: {} })).toEqual(createDefaultFisheyeGraph());
  });

  it('keeps the registered degree-based schema and binds every owner parameter', () => {
    expect(getEffect('fisheye')?.params).toEqual(FISHEYE_PARAMS);
    const graph = createDefaultFisheyeGraph();
    const bindings = new Set(graph.nodes.flatMap(node => Object.values(node.bindings)).filter((value): value is string => typeof value === 'string'));
    expect([...bindings].toSorted()).toEqual(Object.keys(FISHEYE_PARAMS).toSorted());
    expect(FISHEYE_PARAMS.fieldOfView).toMatchObject({ default: 140, min: 20, max: 175 });
    expect(FISHEYE_PARAMS.rotation).toMatchObject({ default: 0, min: -180, max: 180 });
  });

  it('normalizes known owner params after defaults while preserving additional graph bindings', () => {
    const params = effectOperatorParams({ type: 'fisheye', params: {
      fieldOfView: 999, rotation: -999, samples: 6, projection: 'invalid', customBinding: 17,
    } });
    expect(params).toMatchObject({ ...defaults, fieldOfView: 175, rotation: -180, samples: 4, projection: 'equidistant', customBinding: 17 });
  });

  it('retains persisted edits instead of replacing them with the default graph', () => {
    const edited = createDefaultFisheyeGraph();
    edited.nodes.find(node => node.id === 'curve-scale')!.constants = { value: .42 };
    const restored = effectOperatorGraph({ type: 'fisheye', params: {}, operatorGraph: edited });
    expect(restored.nodes.find(node => node.id === 'curve-scale')?.constants?.value).toBe(.42);
  });

  it('compiles one structural program whose dynamic angle values do not change its key', () => {
    const graph = createDefaultFisheyeGraph(), effect = { type: 'fisheye', params: {} };
    const compile = (rotation: number) => {
      const params = effectOperatorParams({ ...effect, params: { rotation } });
      const started = performance.now();
      const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext(effect));
      return { plan, elapsedMs: performance.now() - started };
    };
    const initial = compile(0), animated = compile(37.5);
    console.info('fisheye image graph budget', {
      nodes: graph.nodes.length, edges: graph.edges.length, instructions: initial.plan.instructions.length,
      sampleScopes: initial.plan.sampleScopes.length, defaultCompileMs: initial.elapsedMs, fullParamCompileMs: animated.elapsedMs,
    });
    expect(initial.plan.passes).toBeUndefined();
    expect(initial.plan.key).toBe(animated.plan.key);
    expect(initial.plan.values).not.toEqual(animated.plan.values);
  });

  it('preserves legacy scalar vector division without scalar splat nodes', () => {
    const graph = createDefaultFisheyeGraph();
    for (const id of ['lens-position', 'lens-direction']) {
      expect(graph.nodes.find(node => node.id === id)?.operator).toBe('math.divide-ieee.vec2-scalar');
    }
    expect(graph.nodes.some(node => node.id === 'radius-half-vector' || node.id === 'safe-radius-vector')).toBe(false);
    const plan = compileImageOperatorGraph(graph, defaults, { parameterSchema: FISHEYE_PARAMS });
    expect(plan.instructions.filter(instruction => instruction.nodeId === 'lens-position' || instruction.nodeId === 'lens-direction'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ nodeId: 'lens-position', operation: 'divide-vector-scalar', type: 'vec2' }),
        expect.objectContaining({ nodeId: 'lens-direction', operation: 'divide-vector-scalar', type: 'vec2' }),
      ]));
    expect(plan.wgsl).toContain(' / ');
  });

  it('keeps projection direction in a lazy scalar scope captured by the AA reducer', () => {
    const plan = compileImageOperatorGraph(createDefaultFisheyeGraph(), defaults, { parameterSchema: FISHEYE_PARAMS });
    const selection = plan.instructions.find(item => item.nodeId === 'projection-direction')!;
    expect(selection.operation).toBe('select-lazy-scalar');
    expect(selection.inputs.slice(1).map(scope => plan.sampleScopes.find(item => item.id === scope)?.reducerContext))
      .toEqual([{ kind: 'sequence', id: expect.any(Number) }, { kind: 'sequence', id: expect.any(Number) }]);
    expect(plan.wgsl).toMatch(/var v\d+: f32;\n\s*if \(/);
  });

  it('fails closed for an invalid persisted graph', () => {
    const invalid = createDefaultFisheyeGraph();
    invalid.nodes.push({ ...invalid.nodes[0] });
    expect(() => effectOperatorGraph({ type: 'fisheye', params: {}, operatorGraph: invalid })).toThrow();
  });
});
