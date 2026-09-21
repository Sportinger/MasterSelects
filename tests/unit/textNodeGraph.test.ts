import { describe, expect, it } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { buildClipNodeGraph, buildClipNodeGraphDocument, createClipNodeGraphState, reconcileClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { keyframeNodeParameters, parameterNode } from '../../src/services/nodeGraph/keyframeNodeParameters';
import { effectOrderForConnection } from '../../src/services/nodeGraph/clipEffectChain';

const textClip = () => createMockClip({ id: 'text-test', source: { type: 'text' }, textProperties: { ...DEFAULT_TEXT_PROPERTIES, text: 'Hello' },
  effects: [{ id: 'invert', type: 'invert', name: 'Invert', enabled: true, params: {} }] });
describe('text source graph', () => {
  it('keeps strings separate from raster effects and exposes the shared renderer stages', () => {
    const clip = textClip(), document = buildClipNodeGraphDocument(clip);
    const root = document.graphs[0], text = document.graphs.find(g => g.id.endsWith(':text'))!;
    expect(root.nodes.find(n => n.id === 'source')?.outputs[0].type).toBe('text');
    expect(root.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'source', toNodeId: 'text-render', type: 'text', readOnly: true }));
    expect(root.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'text-render', toNodeId: 'effect-invert', type: 'texture' }));
    expect(text.nodes.map(n => n.id)).toEqual(['content', 'typography', 'layout', 'fill', 'stroke', 'shadow', 'render']);
    expect(text.edges.every(e => e.readOnly)).toBe(true);
    const expanded = buildUnifiedClipGraph(document, clip, [clip], [], undefined, true);
    for (const edge of expanded.edges) {
      const from = expanded.nodes.find(n => n.id === edge.fromNodeId)?.outputs.find(p => p.id === edge.fromPortId);
      const to = expanded.nodes.find(n => n.id === edge.toNodeId)?.inputs.find(p => p.id === edge.toPortId);
      expect(from?.type, edge.id).toBe(to?.type);
      expect(from, edge.id).toBeDefined(); expect(to, edge.id).toBeDefined();
    }
    expect(keyframeNodeParameters(clip).some(p => p.property === 'text.fontSize')).toBe(true);
    expect(parameterNode(clip, 'text.fontSize', expanded.nodes)?.binding).toEqual({ kind: 'clip-text', stage: 'typography' });
    expect(parameterNode(clip, 'text.fontSize', buildUnifiedClipGraph(document, clip).nodes)?.id).toBe('text-render');
  });
  it('migrates legacy source texture wiring and preserves the fixed text input after persistence', () => {
    const clip = textClip();
    clip.nodeGraph = { ...createClipNodeGraphState(clip), manualEdges: [
      { id: 'old', fromNodeId: 'source', fromPortId: 'texture', toNodeId: 'effect-invert', toPortId: 'input', type: 'texture' },
      { id: 'out', fromNodeId: 'effect-invert', fromPortId: 'output', toNodeId: 'output', toPortId: 'input', type: 'texture' },
    ], groups: { text: { collapsed: false, nodeLayouts: { typography: { x: 50, y: 60 } } } } };
    clip.nodeGraph = JSON.parse(JSON.stringify(reconcileClipNodeGraphState(clip, undefined, clip.nodeGraph)));
    const graph = buildClipNodeGraph(clip);
    expect(graph.edges.filter(e => e.toNodeId === 'text-render')).toHaveLength(1);
    expect(graph.edges.some(e => e.fromNodeId === 'source' && e.fromPortId === 'texture')).toBe(false);
    expect(buildClipNodeGraphDocument(clip).graphs.find(g => g.id.endsWith(':text'))?.nodes.find(n => n.id === 'typography')?.layout).toEqual({ x: 50, y: 60 });
    expect(effectOrderForConnection(clip, { fromNodeId: 'text-render', fromPortId: 'output', toNodeId: 'effect-invert', toPortId: 'input' })).toEqual(['invert']);
  });
  it('renders text before mapping its texture onto a 3D plane', () => {
    const clip = { ...textClip(), is3D: true };
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip);
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'source', toNodeId: 'text-render', type: 'text' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'text-render', toNodeId: 'scene3d', type: 'texture' }));
  });
});
