import { describe, expect, it } from 'vitest';
import { temporalDeformation } from '../../src/services/operators/motionDeformationMath';
import { evaluateOpticalFlow, evaluateDirectionalSmooth, evaluateMotionConsistency, type MotionSampler } from '../../src/services/operators/motionImageEvaluation';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getDefaultParams } from '../../src/effects';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { withSlitScanMotion } from '../../src/services/operators/slitScanMotionGraph';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';

describe('motion and local temporal deformation', () => {
  it('keeps coherent signed motion and rejects contradictory neighborhoods', () => {
    const coherent: MotionSampler = () => [-.2, .1, .8, 1];
    const result = evaluateMotionConsistency(coherent, [.5, .5], .02, [320, 180]);
    expect(result[0]).toBeCloseTo(-.2); expect(result[1]).toBeCloseTo(.1);
    expect(result[2]).toBeCloseTo(.8);
    const conflicting: MotionSampler = ([x]) => [x < .5 ? -.2 : .2, 0, .8, 1];
    expect(evaluateMotionConsistency(conflicting, [.5, .5], .02, [320, 180])[2]).toBeLessThan(.1);
    expect(evaluateMotionConsistency(conflicting, [.5, .5], 0, [320, 180])).toEqual(conflicting([.5, .5]));
    expect(evaluateMotionConsistency(() => [1, 1, 0, 0], [.5, .5], .02, [320, 180])).toEqual([0, 0, 0, 0]);
  });
  it('leaves static/invalid motion at identity even with a large delay gradient', () => {
    expect(temporalDeformation([0, 0, 1, 1], [20, 30], [1920, 1080])).toEqual([1, 1, 1, 1]);
    expect(temporalDeformation([1, 1, 0, 0], [20, 30], [1920, 1080])).toEqual([1, 1, 0, 1]);
  });
  it('distinguishes stretching, compression and a fold with signed motion', () => {
    expect(temporalDeformation([-.005, 0, 1, 1], [1, 0], [100, 100])).toEqual([2, 1, 1, .5]);
    expect(temporalDeformation([.01, 0, 1, 1], [1, 0], [100, 100])).toEqual([1, .5, 1, 2]);
    const fold = temporalDeformation([-.02, 0, 1, 1], [1, 0], [100, 100]);
    expect(fold[3]).toBe(-1);
    expect(temporalDeformation([-.01, 0, 1, 1], [1, 0], [100, 100])[0]).toBe(64);
  });
  it('estimates a translated textured patch with the signed frame interval', () => {
    const texture: MotionSampler = ([x, y]) => {
      const value = .5 + .2 * Math.sin(x * 24) * Math.cos(y * 31) + .15 * Math.cos(x * 45 + y * 17);
      return [value, value, value, 1];
    };
    const shift = 1 / 128;
    const target: MotionSampler = ([x, y]) => texture([x - shift, y]);
    const flow = evaluateOpticalFlow(texture, target, [.5, .5], .1, [128, 128]);
    expect(flow[0]).toBeCloseTo(shift / .1, 2);
    expect(Math.abs(flow[1])).toBeLessThan(.02);
    expect(flow[2]).toBeGreaterThan(0);
    expect(evaluateOpticalFlow(texture, target, [.5, .5], -.1, [128, 128])[0]).toBeCloseTo(-flow[0], 6);
    expect(evaluateOpticalFlow(texture, target, [.5, .5], 0, [128, 128])).toEqual([0, 0, 0, 0]);
    expect(evaluateOpticalFlow(() => [.5, .5, .5, 1], () => [.5, .5, .5, 1], [.5, .5], .1, [128, 128])[2]).toBe(0);
  });
  it('preserves masked pixels and alpha while filtering an isolated stripe', () => {
    const stripe: MotionSampler = ([x]) => [Math.abs(x - .5) < .002 ? 1 : 0, 0, 0, .4];
    expect(evaluateDirectionalSmooth(stripe, [.5, .5], [1, 0], 4, 0, [100, 100])).toEqual([1, 0, 0, .4]);
    expect(evaluateDirectionalSmooth(stripe, [.5, .5], [1, 0], 0, 1, [100, 100])).toEqual([1, 0, 0, .4]);
    const filtered = evaluateDirectionalSmooth(stripe, [.5, .5], [1, 0], 4, 1, [100, 100]);
    expect(filtered[0]).toBeLessThan(1); expect(filtered[0]).toBeGreaterThan(0); expect(filtered[3]).toBeCloseTo(.4);
  });
});

describe('reusable motion graph integration', () => {
  it('uses prepared DIS motion to distinguish stretch from static content and compression', () => {
    const mask = (velocity: number, overrides: Record<string, unknown> = {}, size = 100, confidence = 1) => {
      const params = { ...getDefaultParams('slit-scan'), delay: 4, scanStretchThreshold: 2, ...overrides };
      const plan = compileImageOperatorPreview(createDefaultSlitScanGraph(), params,
        { nodeId: 'motion-scan-mask', direction: 'output', portId: 'value' }, effectOperatorCompileContext({ type: 'slit-scan' }));
      return evaluateImageOperatorPlan(plan, [0, 0, 0, 1], {
        uv: [.5, .5], resolution: [size, size], pixelCoordinate: [size / 2, size / 2], derivativeAutoMode: 'fine', timelineTimeSeconds: 0,
        sampleDisMotion: () => [velocity, 0, confidence, 1],
        sampleImage: () => [0, 0, 0, 1], sampleResource: (id, uv) => id === 'slit-scan:time-map'
          ? [uv[0] ** 2, uv[0] ** 2, uv[0] ** 2, 1] : [0, 0, 0, 0],
      })[0];
    };
    expect(mask(-.1875)).toBeCloseTo(1); // J = .25: fourfold expansion.
    expect(mask(-.1875, {}, 400)).toBeCloseTo(1);
    expect(mask(-.1875, { delay: 0 })).toBe(0);
    expect(mask(-.1875, { scanStretchThreshold: 5 })).toBe(0);
    expect(mask(0)).toBe(0);
    expect(mask(.125)).toBe(0); // Compression must not turn red.
    expect(mask(-.1875, {}, 100, 0)).toBe(0);
  });
  it('omits inactive analysis/filter passes and rebuilds the plan when the eye or radius changes', () => {
    const effect = { type: 'slit-scan', params: getDefaultParams('slit-scan'), operatorGraph: createDefaultSlitScanGraph() };
    const off = prepareImageEffect(effect).plan!;
    expect(off.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
    expect(off.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'directional-smooth'))).toBe(false);
    const eye = prepareImageEffect({ ...effect, params: { ...effect.params, scanSmoothingPreview: true } }).plan!;
    expect(eye.externalResources?.some(resource => resource.kind === 'source-motion' && resource.denseInverseSearch)).toBe(true);
    expect(eye.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'directional-smooth'))).toBe(false);
    const on = prepareImageEffect({ ...effect, params: { ...effect.params, scanSmoothing: 1 } }).plan!;
    expect(on.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'directional-smooth'))).toBe(true);
    const offAgain = prepareImageEffect(effect).plan!;
    expect(offAgain.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
    expect(effect.operatorGraph.nodes.some(node => node.id === 'motion-scan-dis-source')).toBe(true);
  });
  it('samples cached DIS at output resolution and keeps authored delay edits', () => {
    const graph = createDefaultSlitScanGraph();
    graph.nodes.find(node => node.id === 'tau')!.constants = { value: 3 };
    const params = { ...getDefaultParams('slit-scan'), scanSmoothing: 2, scanSmoothingPreview: true };
    const restored = effectOperatorGraph({ type: 'slit-scan', operatorGraph: graph, params });
    expect(validateEffectGraph(restored)).toEqual([]);
    expect(restored.nodes.find(node => node.id === 'tau')!.constants?.value).toBe(3);
    const plan = compileImageOperatorGraph(restored, params, effectOperatorCompileContext({ type: 'slit-scan' }));
    expect(plan.resources?.some(resource => resource.maxEdge === 320)).toBe(false);
    expect(plan.externalResources?.filter(resource => resource.kind === 'source-motion' && resource.denseInverseSearch)).toHaveLength(2);
    expect(plan.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'directional-smooth'))).toBe(true);
  });
  it('repairs the initial RGBA-to-RGB overlay bug without mutating a saved graph', () => {
    const graph = createDefaultSlitScanGraph();
    graph.nodes = graph.nodes.filter(node => node.id !== 'motion-scan-tint');
    graph.edges = graph.edges.filter(edge => edge.to !== 'motion-scan-tint')
      .map(edge => edge.to === 'motion-scan-overlay' && edge.input === 'color' ? { ...edge, from: 'motion-scan-color', output: 'value' } : edge);
    graph.groups = graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => id !== 'motion-scan-tint') }));
    const before = structuredClone(graph), repaired = withSlitScanMotion(graph);
    expect(graph).toEqual(before);
    expect(validateEffectGraph(repaired)).toEqual([]);
    expect(withSlitScanMotion(repaired)).toBe(repaired);
    const wrongPort = structuredClone(repaired);
    wrongPort.edges.find(edge => edge.to === 'motion-scan-overlay' && edge.input === 'color')!.output = 'value';
    expect(validateEffectGraph(withSlitScanMotion(wrongPort))).toEqual([]);
  });
  it('allows Optical Flow in an ordinary image graph with explicit frame-pair inputs', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
      { id: 'a', operator: 'image.frame', operatorVersion: 1, bindings: {} },
      { id: 'dt', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .04 } },
      { id: 'flow', operator: 'image.optical-flow', operatorVersion: 1, bindings: {} },
      { id: 'out', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'ref', from: 'a', output: 'image', to: 'flow', input: 'reference' },
      { id: 'target', from: 'a', output: 'image', to: 'flow', input: 'target' },
      { id: 'interval', from: 'dt', output: 'value', to: 'flow', input: 'delta' },
      { id: 'out', from: 'flow', output: 'image', to: 'out', input: 'image' },
    ] };
    const plan = compileImageOperatorGraph(graph);
    expect(plan.externalResources ?? []).toHaveLength(0);
    expect(plan.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'optical-flow'))).toBe(true);
  });
});
