import { describe, expect, it } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { buildClipNodeGraph, buildClipNodeGraphDocument, createClipNodeGraphState, cloneClipNodeGraph, reconcileClipNodeGraphState, remapClipNodeGraphEffectIds } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { applyVisualEffectOrder, effectOrderForConnection } from '../../src/services/nodeGraph/clipEffectChain';
import type { Effect, TimelineClip } from '../../src/types';

const face: Effect = { id: 'face', type: 'face-cables', name: 'Face Cables', enabled: true, params: { bakedData: 'keep-bake', sceneData: 'keep-depth' } };
const brightness: Effect = { id: 'bright', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.2 } };
const clipWith = (effects = [face]) => createMockClip({ id: 'clip', source: { type: 'video' }, effects });
const unified = (clip: TimelineClip, expandAll = false) => buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, expandAll);
const imageChain = (clip: TimelineClip) => buildClipNodeGraph(clip).edges.filter(e => e.type === 'texture').map(e => [e.fromNodeId, e.toNodeId]);

describe('unified clip canvas and canonical effect chain', () => {
  it('automatically connects new effects despite an older manual wiring snapshot', () => {
    const clip = clipWith();
    clip.nodeGraph = { ...createClipNodeGraphState(clip), manualEdges: buildClipNodeGraph(clip).edges };
    clip.effects = [face, brightness];
    expect(imageChain(clip)).toEqual([['source', 'effect-face'], ['effect-face', 'effect-bright'], ['effect-bright', 'output']]);
    const graph = unified(clip, true);
    expect(graph.nodes.some(n => n.operatorId === 'tracking.smooth')).toBe(true);
    const brightInput = graph.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'bright' && node.operatorId === 'image.frame')!;
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'clip-graph:clip:effect:face/output', toNodeId: brightInput.id }));
  });

  it('reconciles stack reorder and removal, including removing the final effect', () => {
    const clip = clipWith([face, brightness]);
    clip.nodeGraph = { ...createClipNodeGraphState(clip), manualEdges: buildClipNodeGraph(clip).edges };
    clip.effects = [brightness, face];
    expect(imageChain(clip)).toEqual([['source', 'effect-bright'], ['effect-bright', 'effect-face'], ['effect-face', 'output']]);
    clip.effects = [brightness];
    clip.nodeGraph = reconcileClipNodeGraphState(clip, undefined, clip.nodeGraph);
    expect(imageChain(clip)).toEqual([['source', 'effect-bright'], ['effect-bright', 'output']]);
    clip.effects = [];
    clip.nodeGraph = reconcileClipNodeGraphState(clip, undefined, clip.nodeGraph);
    expect(imageChain(clip)).toEqual([['source', 'output']]);
  });

  it('rewiring effects changes the canonical stack and keeps all effects connected', () => {
    const clip = clipWith([face, brightness]);
    const order = effectOrderForConnection(clip, { fromNodeId: 'effect-bright', fromPortId: 'output', toNodeId: 'effect-face', toPortId: 'input' });
    expect(order).toEqual(['bright', 'face']);
    const reordered = applyVisualEffectOrder(clip, order!);
    expect(reordered.effects.map(e => e.id)).toEqual(['bright', 'face']);
    expect(imageChain(reordered)).toEqual([['source', 'effect-bright'], ['effect-bright', 'effect-face'], ['effect-face', 'output']]);
    expect(effectOrderForConnection(reordered, { fromNodeId: 'effect-bright', fromPortId: 'output', toNodeId: 'output', toPortId: 'input' })).toEqual(['face', 'bright']);
    expect(effectOrderForConnection(clip, { fromNodeId: 'source', fromPortId: 'audio', toNodeId: 'effect-bright', toPortId: 'input' })).toBeNull();
  });

  it('collapses only the presentation, preserving links, parameters, bake and expansion layout', () => {
    const clip = clipWith([face, brightness]);
    clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:face': { collapsed: false } } };
    const expanded = unified(clip);
    clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:face': { collapsed: true } } };
    const collapsed = unified(clip);
    expect(collapsed.nodes.some(n => n.binding?.kind === 'effect-operator')).toBe(false);
    expect(collapsed.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'effect-face', toNodeId: 'effect-bright' }));
    expect(collapsed.nodes.find(n => n.id === 'effect-bright')!.layout.x).toBeGreaterThan(collapsed.nodes.find(n => n.id === 'effect-face')!.layout.x + 184);
    clip.nodeGraph.groups!['effect:face'].collapsed = false;
    expect(unified(clip).nodes.map(n => [n.id, n.layout])).toEqual(expanded.nodes.map(n => [n.id, n.layout]));
    expect(clip.effects[0].params).toEqual({ bakedData: 'keep-bake', sceneData: 'keep-depth' });
  });

  it('roundtrips group state and remaps its effect ID on clip duplication', () => {
    const clip = clipWith();
    clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:face': { collapsed: true, position: { x: 123, y: 45 } } } };
    const stored = JSON.parse(JSON.stringify(cloneClipNodeGraph(clip.nodeGraph)));
    const copied = remapClipNodeGraphEffectIds(stored, new Map([['face', 'copy']]))!;
    expect(copied.groups).toEqual({ 'effect:copy': { collapsed: true, position: { x: 123, y: 45 } } });
    expect(copied.nodes.find(n => n.id === 'effect-copy')).toBeTruthy();
    expect(clip.nodeGraph.groups!['effect:face'].collapsed).toBe(true);
  });
  it('shows the 3D pipeline, depth and scene dependencies around the correct effect boundary', () => {
    const clip = clipWith([{ ...face, params: { ...face.params, scene3D: true, sceneDepth: true } }, brightness]);
    clip.is3D = true;
    const light = createMockClip({ id: 'light', name: 'Key light', source: { type: 'light' }, is3D: true });
    const camera = createMockClip({ id: 'camera', name: 'Camera', source: { type: 'camera' }, is3D: true });
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip, light, camera], [], undefined, true);
    expect(graph.groups?.map(g => g.id)).toContain('scene3d');
    const roles = graph.nodes.filter(n => n.binding?.kind === 'scene-node').map(n => n.binding!.kind === 'scene-node' ? n.binding!.role : '');
    expect(roles).toEqual(expect.arrayContaining(['camera', 'light']));
    expect(graph.nodes.map(n => n.operatorId)).toEqual(expect.arrayContaining(['geometry.source', 'texture.image', 'texture.uv', 'material.surface', 'scene.mesh', 'scene.clip-transform', 'scene.render', 'depth.estimate']));
    const brightInput = graph.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.effectId === 'bright' && node.operatorId === 'image.frame')!;
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'clip-graph:clip:scene3d/render', toNodeId: brightInput.id }));
    const ids = new Set(graph.nodes.map(n => n.id));
    expect(graph.edges.every(e => ids.has(e.fromNodeId) && ids.has(e.toNodeId))).toBe(true);
    for (const e of graph.edges) {
      const out = graph.nodes.find(n => n.id === e.fromNodeId)!.outputs.find(p => p.id === e.fromPortId);
      const input = graph.nodes.find(n => n.id === e.toNodeId)!.inputs.find(p => p.id === e.toPortId);
      expect(out?.type, e.id).toBe(input?.type);
    }
  });

});
