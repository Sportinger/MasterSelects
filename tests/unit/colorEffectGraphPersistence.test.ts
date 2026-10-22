import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { foldOperatorGroups } from '../../src/services/nodeGraph/nestedOperatorGroups';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: EditableColorEffectType): Effect => ({ id: `${type}-fx`, name: type, type, enabled: true, params: getDefaultParams(type) });

describe('editable color effect graphs', () => {
  // Brightness: odds curve with gain 2^(2.5 * amount); Contrast: S-curve x^a / (x^a + (1 - x)^a); Saturation 0: Rec.709 luma.
  const odds = (x: number) => x * 2 ** 0.5 / (x * 2 ** 0.5 + 1 - x), curve = (x: number) => x * x / (x * x + (1 - x) ** 2);
  const luma = 0.2126 * 0.2 + 0.7152 * 0.4 + 0.0722 * 0.8;
  it.each([
    ['brightness', 0.2, [odds(0.2), odds(0.4), odds(0.8), 0.35]],
    ['contrast', 2, [curve(0.2), curve(0.4), curve(0.8), 0.35]],
    ['saturation', 0, [luma, luma, luma, 0.35]],
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
    // The canonical graph is the default recipe with reusable blocks and the one-time readable grouping applied.
    const recipe = createDefaultColorEffectGraph(type), expanded = expandOperatorCompositions(graph);
    const nodes = (value: EffectOperatorGraph) => value.nodes.map(node => [node.id, node.operator, node.bindings, node.constants]).toSorted();
    const edges = (value: EffectOperatorGraph) => value.edges.map(edge => [edge.from, edge.output, edge.to, edge.input].join(':')).toSorted();
    expect(graph).toMatchObject({ domain: recipe.domain, compositionRules: 2, effectPresentationRules: 1 });
    expect(nodes(expanded)).toEqual(nodes(recipe));
    expect(edges(expanded)).toEqual(edges(recipe));
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    // Persistence stores reusable blocks packed; loading expands them back to the same canonical graph.
    expect(canonical.operatorGraph).toEqual(packOperatorCompositions(graph));
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
    expect(() => setOperatorParameter(clip.id, canonical.id, 'amount', 'value', 4.5)).toThrow('outside its supported range'); // typed values pass the slider up to the render range ±4, as in the card
  });

  it('names folder ports after the parameter a render-range clamp carries, not "Clamp: Value"', () => {
    const outputs = (type: EditableColorEffectType, label: string) => {
      const canonical = migratePersistedEffectOperatorGraph(effect(type));
      const clip = createMockClip({ id: `${type}-ports`, effects: [canonical] });
      // In the clip graph every stage folder sits inside the effect's group, which is what folds it.
      const projected = buildEffectOperatorGraph(clip, canonical);
      const folded = foldOperatorGroups({ ...projected, groups: projected.groups?.map(group => ({ ...group, parentId: group.parentId ?? 'effect' })) });
      return folded.nodes.find(node => node.label === label)?.outputs.map(port => port.label);
    };
    expect(outputs('exposure', 'Parameters')).toEqual(['Exposure', 'Offset', 'Gamma']);
    expect(outputs('temperature', 'Parameters')).toEqual(['Temperature', 'Tint']);
    expect(outputs('vibrance', 'Skin Protection')).toEqual(['Skin Weight']);
    expect(outputs('exposure', 'Offset & Gamma')).toEqual(['Toned RGB']);
  });
});
