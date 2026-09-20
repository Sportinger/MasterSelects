import { describe, expect, it } from 'vitest';
import { defaultSceneGraph, compileSceneGraph, validateSceneGraph } from '../../src/services/operators/sceneGraph';
import { connectEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { defaultCableOperatorGraph, compileCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { createMockClip } from '../helpers/mockData';
import { buildClipNodeGraphDocument, createClipNodeGraphState, cloneClipNodeGraph, reconcileClipNodeGraphState, remapClipNodeGraphEffectIds } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { applySceneOperatorGraph } from '../../src/engine/scene/sceneGraphRuntime';
import type { SceneFaceCableLayer } from '../../src/engine/scene/types';
import { buildPlaneUniformData } from '../../src/engine/native3d/sceneRenderer/planeUniforms';
import { groupOperators, ungroupOperators } from '../../src/services/operators/operatorGroups';

describe('executable scene operators and nested groups', () => {
  it('evaluates connected geometry, material, UV and transform instead of their display order', () => {
    const d = defaultSceneGraph();
    d.params.material_red = 0.2; d.params.geometry_width = 2; d.params.uv_scaleU = -1; d.params.uv_offsetU = 1;
    d.graph.nodes.reverse();
    expect(compileSceneGraph(d)).toMatchObject({ visible: true, textured: true, geometry: 'plane', width: 2, tint: [0.2, 1, 1], uv: [-1, 1, 1, 0], applyClipTransform: true });
    d.graph = connectEffectGraph(d.graph, { id: 'direct', from: 'mesh', output: 'scene', to: 'render', input: 'scene' });
    expect(compileSceneGraph(d).applyClipTransform).toBe(false);
    d.graph.edges = d.graph.edges.filter(e => e.to !== 'render');
    expect(compileSceneGraph(d).visible).toBe(false);
  });
  it('uses solid material when its texture is disconnected and mutes a mesh without geometry', () => {
    const d = defaultSceneGraph(true);
    d.graph.edges = d.graph.edges.filter(e => e.to !== 'material');
    expect(compileSceneGraph(d)).toMatchObject({ visible: true, textured: false, geometry: 'source' });
    d.graph.edges = d.graph.edges.filter(e => e.to !== 'mesh' || e.input !== 'geometry');
    expect(compileSceneGraph(d).visible).toBe(false);
  });
  it('rejects wrong types, cycles and unsupported scene operators', () => {
    const d = defaultSceneGraph();
    expect(() => connectEffectGraph(d.graph, { id: 'bad', from: 'texture', output: 'texture', to: 'mesh', input: 'geometry' })).toThrow('Invalid connection');
    expect(() => connectEffectGraph(d.graph, { id: 'cycle', from: 'uv', output: 'uv', to: 'uv', input: 'uv' })).toThrow();
    d.graph.nodes.push({ id: 'wind', operator: 'forces.wind', bindings: {} });
    expect(validateSceneGraph(d)).toContain('Unsupported scene operator.');
  });
  it('passes the graph into the actual scene payload and shader uniforms', () => {
    const d = defaultSceneGraph(true); d.params.material_red = 0.25; d.params.material_opacity = 0.5;
    const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1]);
    const layer = { kind: 'face-cables', opacity: 0.8, worldMatrix: matrix } as SceneFaceCableLayer;
    const rendered = applySceneOperatorGraph(layer, d);
    expect(rendered.opacity).toBe(0.4); expect(rendered.worldMatrix).toBe(matrix);
    const uniform = buildPlaneUniformData(matrix, rendered.opacity, true, false, false, rendered.surfacePlan);
    expect([...uniform.slice(20, 24)]).toEqual([1, 1, 0, 0]); expect([...uniform.slice(24)]).toEqual([0.25, 1, 1, 1]);
    const disconnected = structuredClone(d); disconnected.graph.edges = disconnected.graph.edges.filter(e => e.to !== 'render');
    expect(applySceneOperatorGraph(layer, disconnected).opacity).toBe(0);
    expect(layer.opacity).toBe(0.8);
  });
  it('roundtrips scene definitions through clone/reconcile and remaps nested group owners', () => {
    const clip = createMockClip({ is3D: true, source: { type: 'video' } });
    clip.nodeGraph = { ...createClipNodeGraphState(clip), scene: defaultSceneGraph(), groups: { 'effect:old/tracking': { collapsed: true } } };
    clip.nodeGraph.scene!.params.uv_offsetU = 0.3;
    const copy = JSON.parse(JSON.stringify(cloneClipNodeGraph(clip.nodeGraph)));
    const reconciled = reconcileClipNodeGraphState(clip, undefined, copy);
    expect(reconciled.scene).toEqual(clip.nodeGraph.scene);
    expect(remapClipNodeGraphEffectIds(reconciled, new Map([['old', 'new']]))?.groups).toHaveProperty('effect:new/tracking');
    reconciled.scene!.params.uv_offsetU = 0.9; expect(clip.nodeGraph.scene!.params.uv_offsetU).toBe(0.3);
  });
  it('collapses nested processing into typed boundary ports without changing the executable graph', () => {
    const clip = createMockClip({ id: 'clip', effects: [{ id: 'face', name: 'Face Cables', type: 'face-cables', enabled: true, params: {} }] });
    clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:face/tracking': { collapsed: true } } };
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip);
    const group = graph.groups!.find(g => g.id === 'effect:face/tracking')!;
    const proxy = graph.nodes.find(n => n.id === group.proxyId)!;
    expect(proxy.outputs.some(p => p.metadata?.groupEndpoint?.nodeId.endsWith('/anchors'))).toBe(true);
    expect(graph.nodes.some(n => n.binding?.kind === 'effect-operator' && n.binding.nodeId === 'tracking')).toBe(false);
    expect(graph.edges.every(e => graph.nodes.some(n => n.id === e.fromNodeId) && graph.nodes.some(n => n.id === e.toNodeId))).toBe(true);
    expect(clip.effects[0].params).toEqual({});
    const persisted = JSON.parse(JSON.stringify(defaultCableOperatorGraph()));
    expect(compileCableOperatorGraph({ operatorGraph: JSON.stringify(persisted), trackingSmoothing: 0.7 }).params.trackingSmoothing).toBe(0.7);
    persisted.groups[0].parentId = persisted.groups[0].id;
    expect(validateEffectGraph(persisted)).toContain('Invalid group hierarchy.');
  });
  it('creates groups inside groups, folds their ports recursively and ungroups without changing processing', () => {
    const definition = defaultCableOperatorGraph();
    const child = groupOperators(definition, ['tracking', 'smoothing']);
    expect(definition.groups!.find(g => g.id === child)?.parentId).toBe('tracking');
    const params = { operatorGraph: JSON.stringify(definition), sceneDepth: true };
    const before = compileCableOperatorGraph(params).params.sceneDepth;
    const clip = createMockClip({ id: 'clip', effects: [{ id: 'face', type: 'face-cables', name: 'Face Cables', enabled: true, params }] });
    clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { [`effect:face/${child}`]: { collapsed: true }, 'effect:face/tracking': { collapsed: true } } };
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip);
    expect(graph.groups?.some(g => g.id === `effect:face/${child}`)).toBe(false);
    const proxy = graph.nodes.find(n => n.binding?.kind === 'operator-group' && n.binding.groupId === 'effect:face/tracking')!;
    expect(proxy.binding).toMatchObject({ effectId: 'face' });
    expect(proxy.outputs.some(p => p.metadata?.groupEndpoint?.nodeId.endsWith('/smoothing'))).toBe(true);
    ungroupOperators(definition, child);
    expect(definition.groups!.find(g => g.id === 'tracking')?.nodeIds).toContain('smoothing');
    expect(compileCableOperatorGraph({ ...params, operatorGraph: JSON.stringify(definition) }).params.sceneDepth).toBe(before);
  });
});
