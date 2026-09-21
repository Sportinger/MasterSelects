import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: EditableColorEffectType): Effect => ({ id: `${type}-fx`, name: type, type, enabled: true, params: getDefaultParams(type) });

describe('editable color effect graphs', () => {
  it.each([
    ['brightness', 0.2, [0.4, 0.6, 1, 0.35]],
    ['contrast', 2, [0, 0.3, 1, 0.35]],
    ['saturation', 0, [0.3858, 0.3858, 0.3858, 0.35]],
  ] as const)('expresses %s as reusable RGB math while preserving alpha', (type, amount, expected) => {
    const graph = createDefaultColorEffectGraph(type);
    const amountNode = graph.nodes.find(node => node.id === 'amount');
    expect(amountNode).toMatchObject({ operator: 'values.number', bindings: { value: 'amount' } });
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'split', output: 'alpha', to: 'combine', input: 'alpha' }));
    const pixel = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { amount }), [0.2, 0.4, 0.8, 0.35]);
    expected.forEach((value, index) => expect(pixel[index]).toBeCloseTo(value, 4));
  });

  it.each(['brightness', 'contrast', 'saturation'] as const)('migrates legacy %s ownership and round-trips the canonical project graph', type => {
    const legacy = effect(type), graph = effectOperatorGraph(legacy);
    expect(graph).toEqual({ ...createDefaultColorEffectGraph(type), compositionRules: 2 });
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    expect(canonical.operatorGraph).toEqual(graph);
    expect(canonical.params.amount).toBe(getDefaultParams(type).amount);
    expect(effectOperatorGraph(JSON.parse(JSON.stringify(canonical)) as Effect)).toEqual(graph);
  });

  it('derives a missing legacy brightness amount from the effect schema rather than the generic value node', () => {
    const legacy = { ...effect('brightness'), params: {} };
    const graph = effectOperatorGraph(legacy);
    expect(effectOperatorParams(legacy).amount).toBe(0);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph, effectOperatorParams(legacy)), [0.2, 0.4, 0.8, 0.35]))
      .toEqual([0.2, 0.4, 0.8, 0.35]);
  });

  it('edits the stable amount binding without copying it into node constants', () => {
    const canonical = migratePersistedEffectOperatorGraph(effect('brightness'));
    const clip = createMockClip({ id: 'color-graph-clip', effects: [canonical] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const projected = buildEffectOperatorGraph(clip, canonical).nodes.find(node => node.id === 'amount')!;
    const frame = imageOperatorValuePreview({ key: 'brightness-amount', revision: '1', time: 0, clipId: clip.id, node: projected,
      width: 160, height: 90, interval: 16, priority: 1, port: projected.outputs[0] }, clip, canonical)!;
    expect(frame.controls?.[0]).toMatchObject({ defaultValue: 0, min: -1, max: 1, step: 0.01,
      persistenceKey: `operator.${canonical.id}.amount` });
    setOperatorParameter(clip.id, canonical.id, 'amount', 'value', 0.75);
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.amount).toBe(0.75);
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'amount')).toMatchObject({ bindings: { value: 'amount' } });
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'amount')?.constants?.value).toBeUndefined();
    expect(() => setOperatorParameter(clip.id, canonical.id, 'amount', 'value', 1.25)).toThrow('outside its supported range');
  });
});
