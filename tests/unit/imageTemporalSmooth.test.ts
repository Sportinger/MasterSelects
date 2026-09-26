import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { expandTemporalSmoothing } from '../../src/services/operators/temporalSmoothPasses';

const node = (id: string, operator: string, constants?: Record<string, number>, bindings: Record<string, string> = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const graph = (nodes: BoundOperatorNode[], edges: EffectOperatorGraph['edges']): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {},
});
const smoothed = (amount?: BoundOperatorNode) => graph([node('frame', 'image.frame'), node('smooth', 'image.temporal-smooth', { amount: 0.75 }),
  ...(amount ? [amount] : []), node('output', 'image.output')], [edge('frame', 'image', 'smooth', 'image'),
  ...(amount ? [edge(amount.id, 'value', 'smooth', 'amount')] : []), edge('smooth', 'image', 'output', 'image')]);

describe('temporal smooth image node', () => {
  it('is an addable stateful pass boundary with a bounded amount', () => {
    const operator = getEffectOperator('image.temporal-smooth');
    expect(operator?.addable).toBe(true);
    expect(operator?.state).toBe('frame-history');
    expect(operator?.parameters.find(p => p.id === 'amount')).toMatchObject({ default: 0.6, min: 0, max: 0.98 });
    expect(getEffectOperator('image.temporal-history')?.addable).toBe(false);
  });

  it('materializes the smoothed result under its own id and reads its own history resource', () => {
    const plan = compileImageOperatorGraph(smoothed());
    expect(plan.resources).toEqual([{ id: 'image-resource:smooth:image', producerPassId: 'image-pass:smooth', format: 'rgba16float' }]);
    expect(plan.externalResources).toEqual([{ id: 'temporal-history:smooth', kind: 'temporal-history', owner: 'smooth' }]);
    expect(plan.passes?.[0].inputResources).toEqual(['temporal-history:smooth']);
    expect(compileImageOperatorPreview(smoothed(), {}, { nodeId: 'smooth', direction: 'output', portId: 'image' }).previewResourceId)
      .toBe('image-resource:smooth:image');
  });

  it('mixes the current frame toward the previous result by amount times history alpha', () => {
    const producer = compileImageOperatorGraph(smoothed()).passes![0].program;
    const sample = (history: number[]) => evaluateImageOperatorPlan(producer, [1, 0, 0, 1], { uv: [.5, .5], sampleResource: () => history });
    expect(sample([0, 1, 0, 1]).map(v => +v.toFixed(3))).toEqual([.25, .75, 0, 1]);
    // Cleared history after a seek or reset passes the current frame through.
    expect(sample([0, 0, 0, 0])).toEqual([1, 0, 0, 1]);
  });

  it('uses a connected amount instead of the parameter and removes the original edges', () => {
    const expanded = expandTemporalSmoothing(smoothed(node('amount', 'values.number', { value: 0.5 })));
    expect(expanded.nodes.find(item => item.id === 'smooth')?.operator).toBe('image.materialize');
    expect(expanded.edges.filter(item => item.to === 'smooth').map(item => item.input)).toEqual(['image']);
    expect(expanded.edges.some(item => item.from === 'amount' && item.to === '__temporal:smooth:weight')).toBe(true);
    const producer = compileImageOperatorGraph(smoothed(node('amount', 'values.number', { value: 0.5 }))).passes![0].program;
    expect(evaluateImageOperatorPlan(producer, [1, 0, 0, 1], { uv: [.5, .5], sampleResource: () => [0, 1, 0, 1] })).toEqual([.5, .5, 0, 1]);
  });

  it('smooths a per-pixel value such as a key mask and feeds value consumers', () => {
    const source = graph([node('frame', 'image.frame'), node('pixel', 'convert.image-to-vec4'), node('channels', 'vector.split.vec4'),
      node('mask', 'image.temporal-smooth.scalar', { amount: 0.5 }), node('rgba', 'vector.combine.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')], [
      edge('frame', 'image', 'pixel', 'image'), edge('pixel', 'value', 'channels', 'value'), edge('channels', 'x', 'mask', 'value'),
      ...['x', 'y', 'z', 'w'].map(component => edge('mask', 'value', 'rgba', component)), edge('rgba', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image')]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resources?.map(resource => resource.id)).toEqual(['image-resource:mask:image']);
    // Current mask 1, previous opaque mask 0 -> 0.5 in every consumer channel.
    const smoothedMask = evaluateImageOperatorPlan(plan.passes![0].program, [1, 0, 0, 1], { uv: [.5, .5], sampleResource: () => [0, 0, 0, 1] });
    expect(smoothedMask).toEqual([.5, .5, .5, 1]);
    expect(evaluateImageOperatorPlan(plan, [1, 0, 0, 1], { uv: [.5, .5], sampleResource: () => smoothedMask })).toEqual([.5, .5, .5, .5]);
  });

  it('keeps the amount keyframeable through an effect parameter binding', () => {
    const source = graph([node('frame', 'image.frame'), node('smooth', 'image.temporal-smooth', { amount: 0.6 }, { amount: 'smoothing' }),
      node('output', 'image.output')], [edge('frame', 'image', 'smooth', 'image'), edge('smooth', 'image', 'output', 'image')]);
    const producer = compileImageOperatorGraph(source, { smoothing: 0.9 }).passes![0].program;
    const [red] = evaluateImageOperatorPlan(producer, [1, 0, 0, 1], { uv: [.5, .5], sampleResource: () => [0, 0, 0, 1] });
    expect(red).toBeCloseTo(0.1);
  });
});
