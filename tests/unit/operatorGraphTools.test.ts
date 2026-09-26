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
    const view = graph.data as { incomplete: unknown; nodes: Array<{ id: string; compound?: boolean; in: string[] }>; edges: Array<{ from: string; output: string; to: string; input: string }> };
    expect(view.incomplete).toBeNull();
    expect(view.nodes.some(node => node.id.startsWith('bend--'))).toBe(false);
    expect(view.nodes.find(node => node.id === 'bend')).toMatchObject({ compound: true, in: expect.arrayContaining(['uv-uv:vec2!']) });
    expect(view.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'uv', output: 'uv', to: 'bend', input: 'uv-uv' })]));
    const inner = await handleGetOperatorGraph({ clipId, effectId, nodeIds: [(effectOperatorGraph(useTimelineStore.getState().clips[0].effects.find(e => e.id === effectId)!)
      .nodes.find(node => node.id.startsWith('bend--'))!).id] });
    expect(inner.success).toBe(true);
    const duplicate = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'bend', operatorId: 'coordinates.radial-curvature.vec2' });
    expect(duplicate.success).toBe(false);
    const auto = await edit(effectId, { action: 'add', operatorId: 'coordinates.radial-curvature.vec2' });
    const handle = (auto.data as { nodeId: string }).nodeId;
    expect(handle.startsWith('@compound-')).toBe(true);
    await edit(effectId, { action: 'connect', fromNodeId: 'uv', fromPortId: 'uv', toNodeId: handle, toPortId: 'uv-uv' });
    const wrongPort = await handleEditOperatorGraph({ clipId, effectId, action: 'connect', fromNodeId: 'uv', fromPortId: 'uv', toNodeId: 'bend', toPortId: 'uv' });
    expect(wrongPort.error).toContain('Available: uv-uv');
    await edit(effectId, { action: 'remove', nodeId: 'bend' });
    const after = effectOperatorGraph(useTimelineStore.getState().clips[0].effects.find(e => e.id === effectId)!);
    expect(after.nodes.some(node => node.id === 'bend' || node.id.startsWith('bend--'))).toBe(false);
    expect(after.groups?.some(group => group.id === 'compound-bend') ?? false).toBe(false);
    expect(after.edges.some(edge => edge.to === 'sample' && edge.input === 'uv')).toBe(false);
  });

  it('maps dotted node IDs to dashes consistently and explains invalid or duplicate IDs', async () => {
    const effectId = await create();
    const added = await edit(effectId, { action: 'add', nodeId: 'key.amount', operatorId: 'values.number' });
    expect(added.data).toMatchObject({ nodeId: 'key-amount', renamedNodeIds: { 'key.amount': 'key-amount' } });
    await edit(effectId, { action: 'set', nodeId: 'key.amount', parameter: 'value', value: 0.5 });
    const invalid = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: '9lives', operatorId: 'values.number' });
    expect(invalid.error).toContain('start with a letter');
    const duplicate = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'key-amount', operatorId: 'values.number' });
    expect(duplicate.error).toContain('already exists');
    const read = await handleGetOperatorGraph({ clipId, effectId, nodeIds: ['key.amount'] });
    expect((read.data as { nodes: { id: string }[] }).nodes.map(node => node.id)).toEqual(['key-amount']);
  });

  it('inserts the single alpha/number conversion automatically when connecting mismatched ports', async () => {
    const effectId = await create();
    for (const [nodeId, operatorId] of [['split', 'vector.split.rgba'], ['half', 'values.number'], ['mul', 'math.multiply.scalar'], ['join', 'vector.combine.rgba']]) {
      await edit(effectId, { action: 'add', nodeId, operatorId });
    }
    await edit(effectId, { action: 'set', nodeId: 'half', parameter: 'value', value: 0.5 });
    const toMath = await edit(effectId, { action: 'connect', fromNodeId: 'split', fromPortId: 'alpha', toNodeId: 'mul', toPortId: 'a' });
    expect(toMath.data).toMatchObject({ insertedConversion: { operatorId: 'convert.alpha-to-scalar' } });
    const toAlpha = await edit(effectId, { action: 'connect', fromNodeId: 'mul', fromPortId: 'value', toNodeId: 'join', toPortId: 'alpha' });
    expect(toAlpha.data).toMatchObject({ insertedConversion: { operatorId: 'convert.scalar-to-alpha' } });
    for (const [fromNodeId, fromPortId, toNodeId, toPortId] of [['frame', 'image', 'split', 'image'], ['half', 'value', 'mul', 'b'],
      ['split', 'rgb', 'join', 'rgb'], ['join', 'image', 'output', 'image']]) await edit(effectId, { action: 'connect', fromNodeId, fromPortId, toNodeId, toPortId });
    expect(pixel(effectId)).toEqual([0.2, 0.4, 0.8, 0.375]);
  });

  it('builds linearly: each add carries its inputs, params and slider with inferred ports and placement', async () => {
    const effectId = await create();
    const rgba = await edit(effectId, { action: 'add', nodeId: 'rgba', operatorId: 'convert.image-to-vec4', inputs: ['frame'] });
    expect(rgba.data).toMatchObject({ connected: [{ from: 'frame.image', to: 'rgba.image' }], openInputs: [] });
    await edit(effectId, { action: 'add', nodeId: 'color', operatorId: 'values.color', params: { value: '#0000ff' } });
    await edit(effectId, { action: 'add', nodeId: 'amount', operatorId: 'values.number', params: { value: 50 }, label: 'Mix %', min: 0, max: 100, step: 1 });
    await edit(effectId, { action: 'add', nodeId: 'half', operatorId: 'values.number', params: { value: 0.01 } });
    const scaled = await edit(effectId, { action: 'add', nodeId: 'scaled', operatorId: 'math.multiply.scalar', inputs: { a: 'amount', b: 'half.value' } });
    expect(scaled.data).toMatchObject({ openInputs: [] });
    const mix = await edit(effectId, { action: 'add', nodeId: 'mix', operatorId: 'math.mix.vec4', inputs: ['rgba', 'color', 'scaled'] });
    expect((mix.data as { connected: Array<{ to: string }> }).connected.map(cable => cable.to)).toEqual(['mix.a', 'mix.b', 'mix.t']);
    await edit(effectId, { action: 'add', nodeId: 'image', operatorId: 'convert.vec4-to-image', inputs: ['mix'] });
    const output = await edit(effectId, { action: 'connect', fromNodeId: 'image', toNodeId: 'output' });
    expect(output.data).toMatchObject({ from: 'image.image', to: 'output.image' });
    expect(pixel(effectId)).toEqual([0.1, 0.2, 0.9, 0.875]);
    const graph = effectOperatorGraph(useTimelineStore.getState().clips[0].effects.find(e => e.id === effectId)!);
    expect(graph.nodes.find(node => node.id === 'amount')?.valueControl).toEqual({ label: 'Mix %', min: 0, max: 100, step: 1 });
    expect(graph.layout.mix.x).toBeGreaterThan(graph.layout.scaled.x);
    expect(graph.layout.image.x).toBeGreaterThan(graph.layout.mix.x);
  });

  it('wires compound ports on add and leaves the graph untouched when any part of an add fails', async () => {
    const effectId = await create();
    await edit(effectId, { action: 'add', nodeId: 'uv', operatorId: 'image.normalized-uv' });
    await edit(effectId, { action: 'add', nodeId: 'curve', operatorId: 'values.number' });
    await edit(effectId, { action: 'add', nodeId: 'amount', operatorId: 'values.number' });
    await edit(effectId, { action: 'add', nodeId: 'bend', operatorId: 'coordinates.radial-curvature.vec2',
      inputs: { 'uv-uv': 'uv', 'curve-value': 'curve', 'amount-value': 'amount' } });
    await edit(effectId, { action: 'add', nodeId: 'sample', operatorId: 'image.sample', inputs: { uv: 'bend', image: 'frame' } });
    await edit(effectId, { action: 'connect', fromNodeId: 'sample', toNodeId: 'output' });
    const view = (await handleGetOperatorGraph({ clipId, effectId })).data as { incomplete: unknown };
    expect(view.incomplete).toBeNull();
    const current = () => effectOperatorGraph(useTimelineStore.getState().clips[0].effects.find(e => e.id === effectId)!);
    const before = current();
    const missing = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'extra', operatorId: 'math.multiply.scalar', inputs: ['nowhere'] });
    expect(missing.error).toContain('nowhere');
    const noInput = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'lonely', operatorId: 'values.number', inputs: ['curve'] });
    expect(noInput.error).toContain('No compatible');
    const badValue = await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId: 'ranged', operatorId: 'values.number', params: { value: 5 }, min: 0, max: 1, step: 0.1 });
    expect(badValue.success).toBe(false);
    expect(current().nodes.map(node => node.id)).toEqual(before.nodes.map(node => node.id));
    expect(current().edges).toEqual(before.edges);
  });

  it('uses the first declared output when several same-typed outputs fit an input', async () => {
    const effectId = await create();
    await edit(effectId, { action: 'add', nodeId: 'green', operatorId: 'field.image-channel', inputs: { image: 'frame' } });
    const compare = await edit(effectId, { action: 'add', nodeId: 'isGreen', operatorId: 'compare.greater.scalar', inputs: { a: 'green' } });
    expect((compare.data as { connected: Array<{ from: string }> }).connected[0].from).toBe('green.value');
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
