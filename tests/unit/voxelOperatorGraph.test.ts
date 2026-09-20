import { afterEach, describe, expect, it } from 'vitest';
import { compileVoxelGraph, createDefaultVoxelGraph, validateVoxelGraph, voxelOperatorGraph } from '../../src/services/operators/voxelGraph';
import { connectEffectGraph, EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraph';
import { VOXEL_SHARED_OPERATOR_IDS } from '../../src/services/operators/voxelOperators';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { SCENE_OPERATORS } from '../../src/services/operators/sceneOperators';
import { voxelRelief } from '../../src/effects/stylize/voxel-relief';
import { VOXEL_RELIEF_PARAMS } from '../../src/effects/stylize/voxel-relief/parameters';
import { createEffectGraphActions, editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphDocument';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { parameterNode } from '../../src/services/nodeGraph/keyframeNodeParameters';
import { scalarFieldBounds } from '../../src/services/operators/scalarFieldBounds';
import { expandVoxelGeometry } from '../../src/services/operators/expandVoxelGeometry';
import { voxelPreview } from '../../src/services/nodePreview/voxelPreviews';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const paramsFor = (graph = createDefaultVoxelGraph(), params: Record<string, number | boolean | string> = {}) => ({ ...params, [EFFECT_GRAPH_PARAM]: JSON.stringify(graph) });
describe('Executable Voxel Relief operator group', () => {
  it('executes nested math, follows rewiring and retains a safe height bound', () => {
    const graph = createDefaultVoxelGraph();
    expect(graph.groups?.find(group => group.id === 'height-math')?.parentId).toBe('height-field');
    expect(compileVoxelGraph(paramsFor(graph, { height: 2, baseHeight: 0.1 })).maxHeight).toBeCloseTo(2.1);
    const rewired = connectEffectGraph(graph, { id: 'direct', from: 'luminance', output: 'value', to: 'geometry', input: 'height' });
    expect(compileVoxelGraph(paramsFor(rewired, { height: 2, baseHeight: 0.1 })).maxHeight).toBe(1);
    graph.nodes.find(node => node.id === 'height')!.bypassed = true;
    expect(compileVoxelGraph(paramsFor(graph, { height: 2, baseHeight: 0.1 })).maxHeight).toBeCloseTo(1.1);
    graph.edges = graph.edges.filter(edge => edge.to !== 'geometry' || edge.input !== 'points');
    expect(compileVoxelGraph(paramsFor(graph)).visible).toBe(false);
  });
  it('bounds extreme and singular field calculations without inverted intervals', () => {
    expect(scalarFieldBounds([[0, 0, 0, 1e9]], 0)).toEqual([10000, 10000]);
    expect(scalarFieldBounds([[0, 0, 0, -1e9]], 0)).toEqual([-10000, -10000]);
    expect(scalarFieldBounds([[1, 0, 0, 0], [0, 0, 0, -2], [6, 0, 1, 0]], 2)).toEqual([1, 10000]);
  });
  it('evaluates timeline keyframes even when a primitive still uses its implicit default', () => {
    const clip = createMockClip({ id: 'keyed', effects: [{ id: 'relief', name: 'Relief', type: 'voxel-relief', enabled: true, params: {} }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, [
      { id: 'start', property: 'effect.relief.voxel_box_depth', value: 0, time: 0, interpolation: 'linear' },
      { id: 'end', property: 'effect.relief.voxel_box_depth', value: 1, time: 2, interpolation: 'linear' },
    ]]]) });
    const sampled = useTimelineStore.getState().getInterpolatedEffects(clip.id, 1)[0];
    expect(sampled.params.voxel_box_depth).toBeCloseTo(0.5);
    expect(compileVoxelGraph(sampled.params).maxHeight).toBeCloseTo(0.6075);
  });
  it('expands a saved opaque geometry node while preserving its texture, keys and parent', () => {
    const graph = createDefaultVoxelGraph();
    const primitives = new Set(['luminance', 'clamp', 'contrast', 'height', 'base', 'grid', 'box']);
    graph.nodes = graph.nodes.filter(node => !primitives.has(node.id));
    const geometry = graph.nodes.find(node => node.id === 'geometry')!;
    geometry.operator = 'geometry.voxel'; geometry.bindings = { columns: 'columns', height: 'customHeight', baseHeight: 'baseHeight', heightContrast: 'heightContrast' };
    graph.edges = graph.edges.filter(edge => !primitives.has(edge.from) && !primitives.has(edge.to));
    graph.edges.push({ id: 'old-height', from: 'texture', output: 'texture', to: 'geometry', input: 'height' });
    graph.groups = [{ id: 'saved-group', label: 'Saved geometry', color: '#abc', nodeIds: ['geometry'] }];
    const serialized = JSON.stringify(graph), migrated = voxelOperatorGraph(paramsFor(graph));
    expect(migrated.nodes).toHaveLength(16);
    expect(migrated.nodes.find(node => node.operator === 'math.multiply')?.bindings.b).toBe('customHeight');
    expect(migrated.groups?.find(group => group.id === 'geometry-construction')?.parentId).toBe('saved-group');
    expect(validateVoxelGraph(migrated)).toEqual([]);
    expect(compileVoxelGraph(paramsFor(graph, { customHeight: 0.4 })).maxHeight).toBeCloseTo(0.415);
    expect(JSON.stringify(graph)).toBe(serialized);
    expect(expandVoxelGeometry(migrated)).toBe(migrated);
  });
  it('labels node categories and previews the fixed operand at its actual default and animated value', async () => {
    const clip = createMockClip({ effects: [{ id: 'relief', name: 'Relief', type: 'voxel-relief', enabled: true, params: {} }] });
    const effect = clip.effects[0], graph = buildEffectOperatorGraph(clip, effect), node = graph.nodes.find(node => node.id === 'height')!;
    expect(node.params?.categoryLabel).toBe('Math');
    expect(graph.nodes.find(node => node.id === 'box')?.params?.categoryLabel).toBe('Geometry');
    const request = { key: 'height', revision: '1', clipId: clip.id, node, time: 0, width: 160, height: 100, interval: 100, priority: 0 };
    expect((await voxelPreview(request, clip, effect, [], 0)).drawing).toMatchObject({ kind: 'number', value: '1.2', caption: 'Height', details: ['A: connected'] });
    const key = { id: 'key', property: 'effect.relief.height' as const, time: 0, value: 0.7, interpolation: 'linear' as const };
    expect((await voxelPreview(request, clip, effect, [key], 0)).drawing).toMatchObject({ value: '0.7' });
  });
  it('reuses the scene operator definitions and preserves every legacy effect parameter', () => {
    for (const id of VOXEL_SHARED_OPERATOR_IDS) expect(getEffectOperator(id)).toBe(SCENE_OPERATORS.find(op => op.id === id));
    const params = Object.fromEntries(Object.entries(VOXEL_RELIEF_PARAMS).map(([id, spec]) => [id, spec.default]));
    params.height = 0.42; params.yaw = -84; params.limitToVideo = false;
    const before = JSON.stringify(params), plan = compileVoxelGraph(params);
    expect(plan).toMatchObject({ visible: true, heightUV: [1, 1, 0, 0], colorUV: [1, 1, 0, 0], tint: [1, 1, 1], opacity: 1, params });
    expect(JSON.stringify(params)).toBe(before);
    expect(validateVoxelGraph(createDefaultVoxelGraph())).toEqual([]);
  });
  it('uses the connected branch, independent height/color UVs and shared material', () => {
    const graph = createDefaultVoxelGraph();
    graph.nodes.push({ id: 'color-map', operator: 'texture.uv', bindings: { offsetU: 'colorOffset' } },
      { id: 'color-texture', operator: 'texture.image', bindings: {} });
    graph.edges.push({ id: 'color-frame', from: 'frame', output: 'image', to: 'color-texture', input: 'image' },
      { id: 'color-uv', from: 'color-map', output: 'uv', to: 'color-texture', input: 'uv' });
    const connected = connectEffectGraph(graph, { id: 'new-color', from: 'color-texture', output: 'texture', to: 'material', input: 'texture' });
    expect(compileVoxelGraph(paramsFor(connected, { voxel_uv_scaleU: 2, colorOffset: 0.4, voxel_material_red: 0.25, voxel_material_opacity: 0.6 })))
      .toMatchObject({ heightUV: [2, 1, 0, 0], colorUV: [1, 1, 0.4, 0], tint: [0.25, 1, 1], opacity: 0.6 });
  });
  it('disconnects and bypasses real processing without reverting to a hidden default graph', () => {
    const graph = createDefaultVoxelGraph();
    graph.edges = graph.edges.filter(edge => edge.to !== 'render' || edge.input !== 'scene');
    expect(compileVoxelGraph(paramsFor(graph)).visible).toBe(false);
    const muted = createDefaultVoxelGraph(); muted.nodes.find(node => node.id === 'texture')!.bypassed = true;
    expect(compileVoxelGraph(paramsFor(muted)).field.textureNodeId).toBeUndefined();
    const uv = createDefaultVoxelGraph(); uv.nodes.find(node => node.id === 'uv')!.bypassed = true;
    expect(compileVoxelGraph(paramsFor(uv, { voxel_uv_scaleU: 2 })).heightUV).toEqual([1, 1, 0, 0]);
    const material = createDefaultVoxelGraph(); material.edges = material.edges.filter(edge => edge.to !== 'material');
    expect(compileVoxelGraph(paramsFor(material))).toMatchObject({ visible: true, textured: false });
  });
  it('rejects corrupted, cross-domain and cyclic graphs', () => {
    expect(() => voxelOperatorGraph({ operatorGraph: '{' })).toThrow();
    const graph = createDefaultVoxelGraph(); graph.nodes.push({ id: 'extra', operator: 'forces.wind', bindings: {} });
    expect(() => compileVoxelGraph(paramsFor(graph))).toThrow(/Unsupported/);
    expect(() => connectEffectGraph(createDefaultVoxelGraph(), { id: 'feedback', from: 'render', output: 'image', to: 'texture', input: 'image' })).toThrow(/connection|cycle/i);
  });
  it('packs graph results and visibility into the actual 2D shader uniforms', () => {
    const graph = createDefaultVoxelGraph(), params = paramsFor(graph, { height: 0.6, voxel_uv_offsetU: 0.2, voxel_material_red: 0.3 });
    const uniforms = voxelRelief.packUniforms(params, 320, 180)!;
    expect(uniforms.byteLength).toBe(voxelRelief.uniformSize);
    expect(uniforms[1]).toBeCloseTo(0.6); expect(uniforms[30]).toBeCloseTo(0.2); expect(uniforms[36]).toBeCloseTo(0.3); expect(uniforms[40]).toBe(1);
    graph.nodes.find(node => node.id === 'render')!.bypassed = true;
    expect(voxelRelief.packUniforms(paramsFor(graph), 320, 180)![40]).toBe(0);
  });
  it('routes existing graph actions and animation owners to Voxel instead of the cable compiler', () => {
    const clip = createMockClip({ id: 'clip', effects: [{ id: 'relief', name: 'Voxel Relief', type: 'voxel-relief', enabled: true, params: { height: 0.8 } }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const actions = createEffectGraphActions(clip.id, 'relief');
    const id = actions.addNode('math.multiply');
    editEffectGraph(clip.id, 'relief', 'Edit relief', (graph, params) => { params[graph.nodes.find(node => node.id === id)!.bindings.b as string] = 0.3; });
    actions.connectPorts({ fromNodeId: id, fromPortId: 'value', toNodeId: 'base', toPortId: 'a' });
    const current = useTimelineStore.getState().clips[0];
    expect(compileVoxelGraph(current.effects[0].params).maxHeight).toBeCloseTo(0.315);
    const unified = buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
    expect(unified.groups?.some(group => group.id === 'effect:relief')).toBe(true);
    expect(parameterNode(current, 'effect.relief.height', unified.nodes)?.binding).toMatchObject({ kind: 'effect-operator', nodeId: 'height' });
    expect(() => actions.addNode('forces.wind')).toThrow();
  });
});
