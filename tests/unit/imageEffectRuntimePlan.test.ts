import { describe, expect, it } from 'vitest';
import { prepareImageEffect, prepareImageEffectPreview } from '../../src/services/operators/imageEffectRuntimePlan';
import { compileImageOperatorGraph, compileImageOperatorPreview, createDefaultInvertImageGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { fisheye } from '../../src/effects/distort/fisheye';
import type { FullscreenEffectDefinition } from '../../src/effects/types';

const freshPlan = (effect: Parameters<typeof prepareImageEffect>[0]) => compileImageOperatorGraph(
  effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));

describe('image effect runtime plan reuse', () => {
  it('reuses the compiled Fisheye plan across frames and cloned effect instances', () => {
    const effect = { type: 'fisheye', params: {}, operatorGraph: createDefaultFisheyeGraph() };
    const initial = prepareImageEffect(effect);
    for (let frame = 0; frame < 24; frame++) expect(prepareImageEffect(structuredClone(effect))).toBe(initial);
    expect(initial.plan).toEqual(freshPlan(effect));
  });

  it('keeps the compiled plan when only editor card positions change', () => {
    const effect = { type: 'fisheye', params: {}, operatorGraph: createDefaultFisheyeGraph() };
    const initial = prepareImageEffect(effect);
    const layout = Object.fromEntries(Object.entries(effect.operatorGraph.layout).map(([id, point]) => [id, { x: point.x + 900, y: point.y - 40 }]));
    expect(prepareImageEffect({ ...effect, operatorGraph: { ...effect.operatorGraph, layout } })).toBe(initial);
  });

  it('matches fresh Fisheye plans across branch changes and rebinds uniforms without mutating old frames', () => {
    const effect = { type: 'fisheye', params: {} };
    const initial = prepareImageEffect(effect).plan!;
    const saved = [...initial.values];
    for (const [index, projection] of ['equidistant', 'equisolid', 'stereographic', 'orthographic'].entries()) {
      const changed = { ...effect, params: { projection, strength: -.7, fieldOfView: 80 + index * 10,
        curveBias: .3, radius: 1.6, zoom: 1.5, centerX: .4, centerY: .6, squeeze: 1.3,
        rotation: 37, preserveAspect: false, outside: 'transparent', feather: .15, edgeMode: 'mirror',
        edgeFeather: .04, chromaticAberration: .03, vignette: .4, vignetteSoftness: .3, samples: 8 } };
      const animated = prepareImageEffect(changed).plan!;
      expect(animated).toEqual(freshPlan(changed));
      // Optimized branches may change above (e.g. zero aberration to nonzero).
      // A numeric change within the same branches must only rebind uniforms.
      const rotated = { ...changed, params: { ...changed.params, rotation: 38 } };
      const rebound = prepareImageEffect(rotated).plan!;
      expect(rebound.instructions).toBe(animated.instructions);
      expect(rebound.sampleScopes).toBe(animated.sampleScopes);
      expect(rebound).toEqual(freshPlan(rotated));
      const definition = imageGraphDefinition(changed, fisheye as FullscreenEffectDefinition, 3, animated);
      expect(definition.packUniforms({}, 1280, 720)?.slice(0, animated.values.length))
        .toEqual(new Float32Array(animated.values));
    }
    expect(initial.values).toEqual(saved);
  });

  it('invalidates in-place graph edits, observes undo, and keeps cached snapshots independent', () => {
    const graph = createDefaultInvertImageGraph();
    const effect = { type: 'invert', params: {}, operatorGraph: graph };
    const original = prepareImageEffect(effect);
    graph.nodes.find(node => node.id === 'one')!.constants = { value: .4 };
    const edited = prepareImageEffect(effect);
    expect(edited.plan!.key).not.toBe(original.plan!.key);
    expect(original.graph.nodes.find(node => node.id === 'one')!.constants!.value).toBe(1);
    graph.nodes.find(node => node.id === 'one')!.constants = { value: 1 };
    expect(prepareImageEffect(effect)).toBe(original);
    graph.edges = [{ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' }];
    // Remove disconnected arithmetic whose required inputs were also removed.
    graph.nodes = graph.nodes.filter(node => node.id === 'frame' || node.id === 'output');
    expect(evaluateImageOperatorPlan(prepareImageEffect(effect).plan!, [.2, .4, .6, 1])).toEqual([.2, .4, .6, 1]);
  });

  it('fails closed on invalid animated values, even in disconnected nodes', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.push({ id: 'unused-number', operator: 'values.number', operatorVersion: 1, bindings: { value: 'unused' } });
    const effect = { type: 'invert', operatorGraph: graph, params: { unused: 1 } };
    const valid = prepareImageEffect(effect);
    for (const unused of [NaN, Infinity, null, 'bad']) {
      expect(() => prepareImageEffect({ ...effect, params: { unused } })).toThrow(/finite/);
    }
    expect(prepareImageEffect(effect)).toBe(valid);
    graph.incomplete = 'Missing connection';
    expect(prepareImageEffect(effect).plan).toBeUndefined();
    delete graph.incomplete;
    expect(prepareImageEffect(effect)).toBe(valid);
  });

  it('rebinds every materialized pass and keeps its instructions and resources', () => {
    const graph = createDefaultFisheyeGraph();
    const edge = graph.edges.find(item => item.to === 'output')!;
    graph.nodes.push({ id: 'materialize', operator: 'image.materialize', operatorVersion: 1, bindings: {} });
    graph.edges.push({ id: 'to-materialize', from: edge.from, output: edge.output, to: 'materialize', input: 'image' });
    edge.from = 'materialize'; edge.output = 'image';
    const effect = { type: 'fisheye', operatorGraph: graph, params: { rotation: 0 } };
    const initial = prepareImageEffect(effect).plan!;
    const changed = { ...effect, params: { rotation: -42 } };
    const rebound = prepareImageEffect(changed).plan!;
    expect(rebound.passes!.length).toBeGreaterThan(1);
    expect(rebound.passes![0].program.instructions).toBe(initial.passes![0].program.instructions);
    expect(rebound).toEqual(freshPlan(changed));
  });

  it('recompiles parameter-dependent resource descriptors instead of reusing stale metadata', () => {
    const effect = { type: 'ascii', params: { customRamp: 'abc' } };
    const initial = prepareImageEffect(effect).plan!;
    const changed = { ...effect, params: { customRamp: 'xyz!' } };
    const next = prepareImageEffect(changed).plan!;
    expect(next.instructions).not.toBe(initial.instructions);
    expect(next).toEqual(freshPlan(changed));
  });

  it('shares the legacy JSON and default graph path without losing animated values', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.find(node => node.id === 'one')!.bindings.value = 'ceiling';
    const effect = { type: 'invert', params: { operatorGraph: JSON.stringify(graph), ceiling: 1 } };
    const first = prepareImageEffect(effect).plan!;
    const changed = { ...effect, params: { ...effect.params, ceiling: .5 } };
    const next = prepareImageEffect(changed).plan!;
    expect(next.instructions).toBe(first.instructions);
    expect(next).toEqual(freshPlan(changed));
    expect(evaluateImageOperatorPlan(next, [.2, .4, .8, 1])).toEqual([.3, .09999999999999998, -.30000000000000004, 1]);
  });

  it('reuses preview targets and rebinds angles when their values change', () => {
    const effect = { type: 'fisheye', params: { rotation: 0 } };
    const target = { nodeId: 'rotation-radians', direction: 'output' as const, portId: 'value' };
    const initial = prepareImageEffectPreview(effect, target);
    expect(prepareImageEffectPreview(structuredClone(effect), target)).toBe(initial);
    const changed = { ...effect, params: { rotation: 28 } };
    const rebound = prepareImageEffectPreview(changed, target);
    expect(rebound.instructions).toBe(initial.instructions);
    expect(rebound).toEqual(compileImageOperatorPreview(effectOperatorGraph(changed), effectOperatorParams(changed), target, effectOperatorCompileContext(changed)));
  });

  it('remembers unsupported preview scopes instead of recompiling the same failure', () => {
    const effect = { type: 'fisheye', params: {} };
    const target = { nodeId: 'aa-sequence', direction: 'output' as const, portId: 'index' };
    const error = () => { try { prepareImageEffectPreview(effect, target); } catch (value) { return value; } };
    const first = error();
    expect(first).toBeInstanceOf(Error);
    expect(error()).toBe(first);
  });
});
