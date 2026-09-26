import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { handleCreateImageNodeGraph, handleGetOperatorGraph, handleEditOperatorGraph } from '../../src/services/aiTools/handlers/operatorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { getToolPolicy, checkToolAccess } from '../../src/services/aiTools/policy';

const initial = useTimelineStore.getState();
const clipId = 'graph-test';
async function create() {
  const result = await handleCreateImageNodeGraph({ clipId, name: 'Test graph' });
  expect(result.success, result.error).toBe(true);
  return (result.data as { effectId: string }).effectId;
}
async function edit(effectId: string, args: Record<string, unknown>) {
  const result = await handleEditOperatorGraph({ clipId, effectId, ...args });
  expect(result.success, result.error).toBe(true); return result;
}
function pixel(effectId: string) {
  const effect = useTimelineStore.getState().clips[0].effects.find(e => e.id === effectId)!;
  return evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(effect), effect.params), [0.2, 0.4, 0.8, 0.75]);
}
describe('atomic operator graph tools', () => {
  beforeEach(() => {
    const clip = createMockClip({ id: clipId, effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  });
  afterEach(() => useTimelineStore.setState(initial));

  it('creates neutral pixels, composes real operators and reports partial state', async () => {
    const effectId = await create();
    expect(pixel(effectId)).toEqual([0.2, 0.4, 0.8, 0.75]);
    for (const [nodeId, operatorId] of [['rgba', 'convert.image-to-vec4'], ['color', 'values.color'], ['mix', 'math.mix.vec4'], ['amount', 'values.number'], ['image', 'convert.vec4-to-image']]) {
      await edit(effectId, { action: 'add', nodeId, operatorId });
    }
    await edit(effectId, { action: 'set', nodeId: 'color', parameter: 'value', value: '#0000ff' });
    await edit(effectId, { action: 'set', nodeId: 'amount', parameter: 'value', value: 0.5 });
    for (const [fromNodeId, fromPortId, toNodeId, toPortId] of [
      ['frame', 'image', 'rgba', 'image'], ['rgba', 'value', 'mix', 'a'], ['color', 'value', 'mix', 'b'],
      ['amount', 'value', 'mix', 't'], ['mix', 'value', 'image', 'value'], ['image', 'image', 'output', 'image'],
    ]) await edit(effectId, { action: 'connect', fromNodeId, fromPortId, toNodeId, toPortId });
    expect(pixel(effectId)).toEqual([0.1, 0.2, 0.9, 0.875]);
    const result = await handleGetOperatorGraph({ clipId, effectId, nodeIds: ['mix'], hops: 1, direction: 'upstream' });
    expect(result.success).toBe(true);
    const data = result.data as { nodes: { id: string }[]; boundaryEdges: unknown[]; omittedNodeCount: number; incomplete: unknown };
    expect(data.nodes.map(n => n.id).toSorted()).toEqual(['amount', 'color', 'mix', 'rgba']);
    expect(data.omittedNodeCount).toBe(3);
    expect(data.boundaryEdges).toHaveLength(2);
    expect(data.incomplete).toBeNull();
    await edit(effectId, { action: 'set', nodeId: 'amount', parameter: 'value', value: 0 });
    expect(pixel(effectId)).toEqual([0.2, 0.4, 0.8, 0.75]);
  });

  it('adds a compound node under a caller-chosen ID and wires its public ports', async () => {
    const effectId = await create();
    for (const [nodeId, operatorId] of [['uv', 'image.normalized-uv'], ['bend', 'coordinates.radial-curvature.vec2'],
      ['curve', 'values.number'], ['amount', 'values.number'], ['sample', 'image.sample']]) {
      await edit(effectId, { action: 'add', nodeId, operatorId });
    }
    for (const [fromNodeId, fromPortId, toNodeId, toPortId] of [
      ['uv', 'uv', 'bend', 'uv-uv'], ['curve', 'value', 'bend', 'curve-value'], ['amount', 'value', 'bend', 'amount-value'],
      ['bend', 'curved-value', 'sample', 'uv'], ['frame', 'image', 'sample', 'image'], ['sample', 'image', 'output', 'image'],
    ]) await edit(effectId, { action: 'connect', fromNodeId, fromPortId, toNodeId, toPortId });
    const graph = await handleGetOperatorGraph({ clipId, effectId });
    expect((graph.data as { incomplete: unknown }).incomplete).toBeNull();
    const duplicate = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'bend', operatorId: 'coordinates.radial-curvature.vec2' });
    expect(duplicate.success).toBe(false);
    const auto = await edit(effectId, { action: 'add', operatorId: 'coordinates.radial-curvature.vec2' });
    const handle = (auto.data as { nodeId: string }).nodeId;
    expect(handle.startsWith('@compound-')).toBe(true);
    await edit(effectId, { action: 'connect', fromNodeId: 'uv', fromPortId: 'uv', toNodeId: handle, toPortId: 'uv-uv' });
    const wrongPort = await handleEditOperatorGraph({ clipId, effectId, action: 'connect', fromNodeId: 'uv', fromPortId: 'uv', toNodeId: 'bend', toPortId: 'uv' });
    expect(wrongPort.error).toContain('Available: uv-uv');
  });

  it('saves an authored slider and enforces its range, locks and ownership', async () => {
    const effectId = await create();
    await edit(effectId, { action: 'add', nodeId: 'percent', operatorId: 'values.number' });
    await edit(effectId, { action: 'slider', nodeId: 'percent', label: 'Blue Mix %', min: 0, max: 100, step: 1 });
    await edit(effectId, { action: 'set', nodeId: 'percent', parameter: 'value', value: 50 });
    expect((await handleEditOperatorGraph({ clipId, effectId, action: 'set', nodeId: 'percent', parameter: 'value', value: 101 })).success).toBe(false);
    const state = useTimelineStore.getState(), before = state.clips;
    expect((await handleEditOperatorGraph({ clipId: 'wrong', effectId, action: 'remove', nodeId: 'percent' })).success).toBe(false);
    useTimelineStore.setState({ tracks: state.tracks.map(t => ({ ...t, locked: true })) });
    expect((await handleEditOperatorGraph({ clipId, effectId, action: 'remove', nodeId: 'percent' })).success).toBe(false);
    expect(useTimelineStore.getState().clips).toBe(before);
    expect((await handleGetOperatorGraph({ clipId, effectId, nodeIds: ['missing'] })).success).toBe(false);
    expect((await handleGetOperatorGraph({ clipId })).success).toBe(true);
  });

  it('keeps inspection available in plan mode and editing behind mutation policy', () => {
    expect(getToolPolicy('getOperatorGraph')?.readOnly).toBe(true);
    for (const name of ['createImageNodeGraph', 'editOperatorGraph']) {
      expect(checkToolAccess(name, 'chat', { executionMode: 'plan' }).allowed).toBe(false);
      expect(checkToolAccess(name, 'chat', { executionMode: 'normal' }).allowed).toBe(true);
    }
  });
});
