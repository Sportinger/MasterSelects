import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_FRAME_HISTORY_RESOURCE_ID } from '../../src/services/operators/imageOperatorResources';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, bindings: Record<string, string> = {}) => ({ id, operator, operatorVersion: 1 as const, bindings });
const graph = (nodes: EffectOperatorGraph['nodes'], edges: EffectOperatorGraph['edges']): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 300, y: 0 }])),
});

describe('image frame-history source', () => {
  it('has canonical state/barrier metadata and lowers through the existing resource input', () => {
    expect(getEffectOperator('image.frame-history')).toMatchObject({ state: 'frame-history', fusion: 'pass-boundary', addable: false });
    const source = graph([node('history', 'image.frame-history'), node('output', 'image.output')], [
      { id: 'history-output', from: 'history', output: 'image', to: 'output', input: 'image' },
    ]);
    expect(() => compileImageOperatorGraph(source)).toThrow(/explicit compile-context opt-in/);
    const plan = compileImageOperatorGraph(source, {}, { allowFrameHistory: true });
    expect(plan.resourceInputs).toEqual([IMAGE_FRAME_HISTORY_RESOURCE_ID]);
    expect(plan.resourceSampling).toEqual(['hardware-linear-clamp']);
    expect(plan.frameHistoryResource).toBe(IMAGE_FRAME_HISTORY_RESOURCE_ID);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.25, .75],
      sampleResource: (id, uv) => { expect([id, uv]).toEqual([IMAGE_FRAME_HISTORY_RESOURCE_ID, [.25, .75]]); return [.1, .2, .3, .4]; } }))
      .toEqual([.1, .2, .3, .4]);
  });

  it('reports history only when reachable and unions producer-only history into a multipass plan', () => {
    const unreachable = graph([node('frame', 'image.frame'), node('history', 'image.frame-history'), node('output', 'image.output')], [
      { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' },
    ]);
    expect(compileImageOperatorGraph(unreachable, {}, { allowFrameHistory: true }).frameHistoryResource).toBeUndefined();

    const staged = graph([node('history', 'image.frame-history'), node('store', 'image.materialize'), node('output', 'image.output')], [
      { id: 'history-store', from: 'history', output: 'image', to: 'store', input: 'image' },
      { id: 'store-output', from: 'store', output: 'image', to: 'output', input: 'image' },
    ]);
    const plan = compileImageOperatorGraph(staged, {}, { allowFrameHistory: true });
    expect(plan.frameHistoryResource).toBe(IMAGE_FRAME_HISTORY_RESOURCE_ID);
    expect(plan.passes?.some(pass => pass.program.resourceInputs?.includes(IMAGE_FRAME_HISTORY_RESOURCE_ID))).toBe(true);
  });

  it('reserves effect-history against public named inputs', () => {
    const forged = graph([node('named', 'image.named-input', { resource: IMAGE_FRAME_HISTORY_RESOURCE_ID }), node('output', 'image.output')], [
      { id: 'named-output', from: 'named', output: 'image', to: 'output', input: 'image' },
    ]);
    expect(() => compileImageOperatorGraph(forged, {}, { namedImages: [
      { id: IMAGE_FRAME_HISTORY_RESOURCE_ID, sampling: 'hardware-linear-clamp' },
    ] })).toThrow(/reserved compiler resource namespace/);
  });
});
