import { afterEach, describe, expect, it } from 'vitest';
import { changeScalarMathMode, mathModeOptions, setMathNodeMode } from '../../src/services/nodeGraph/mathNodeEditing';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { compileVoxelGraph, voxelOperatorGraph } from '../../src/services/operators/voxelGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import type { NodeGraphNode } from '../../src/types/nodeGraph';
import { effectOperatorCompileParams, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
describe('math operation changes', () => {
  it('preserves wiring, parameter ownership and keyframes while changing the calculation', () => {
    const clip = createMockClip({ id: 'math-clip', effects: [{ id: 'relief', type: 'voxel-relief', name: 'Relief', enabled: true, params: {} }] });
    const keys = [{ id: 'height-key', property: 'effect.relief.height', time: 0, value: 2, interpolation: 'linear' }];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys as never]]) });
    const node = buildEffectOperatorGraph(clip, clip.effects[0]).nodes.find(node => node.id === 'height')!;
    const before = voxelOperatorGraph(clip.effects[0].params);
    setMathNodeMode(clip.id, node, 'math.divide');
    const effect = useTimelineStore.getState().clips[0].effects[0], graph = effectOperatorGraph(effect);
    expect(effect.operatorGraph).toBeDefined();
    expect(effect.params.operatorGraph).toBeUndefined();
    expect(graph.edges).toEqual(before.edges);
    expect(graph.nodes.find(node => node.id === 'height')?.bindings.b).toBe('height');
    expect(effect.params.height).toBe(1.2);
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)).toBe(keys);
    expect(compileVoxelGraph(effectOperatorCompileParams(effect)).maxHeight).toBeCloseTo(1 / 1.2 + 0.015);
  });
  it('adapts unary, clamp and constant ports without losing output links or dormant numeric bindings', () => {
    const graph = voxelOperatorGraph({}), params = { height: 1.2 };
    graph.edges.push({ id: 'b-input', from: 'contrast', output: 'value', to: 'height', input: 'b' });
    const outputs = graph.edges.filter(edge => edge.from === 'height');
    changeScalarMathMode(graph, params, 'height', 'math.abs');
    expect(graph.edges.some(edge => edge.id === 'b-input')).toBe(false);
    expect(graph.edges.filter(edge => edge.from === 'height')).toEqual(outputs);
    expect(validateEffectGraph(graph)).toEqual([]);
    changeScalarMathMode(graph, params, 'height', 'math.clamp');
    expect(graph.nodes.find(node => node.id === 'height')?.bindings.b).toBe('height');
    expect(params.height).toBe(1.2);
    expect(validateEffectGraph(graph)).toEqual([]);
    changeScalarMathMode(graph, params, 'height', 'math.constant');
    expect(graph.edges.some(edge => edge.to === 'height')).toBe(false);
    expect(graph.edges.filter(edge => edge.from === 'height')).toEqual(outputs);
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(() => changeScalarMathMode(graph, params, 'height', 'geometry.box')).toThrow();
  });
  it('offers every supported math mode from each runtime registry', () => {
    expect(mathModeOptions({ operatorId: 'math.add' } as NodeGraphNode).map(option => option.value)).toContain('math.clamp');
    expect(mathModeOptions({ operatorId: 'flock.math' } as NodeGraphNode).map(option => option.value))
      .toEqual(['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'power', 'abs', 'sin']);
  });
  it('does not present scalar-field Constant for typed image subtract operators', () => {
    expect(mathModeOptions({ operatorId: 'math.subtract.scalar' } as NodeGraphNode)).toEqual([]);
    expect(mathModeOptions({ operatorId: 'math.subtract.rgb' } as NodeGraphNode)).toEqual([]);
  });
});
