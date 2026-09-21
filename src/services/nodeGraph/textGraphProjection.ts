import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph, NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';
import { TEXT_NODE_STAGES, type TextNodeStage } from '../text/textNodeStages';
import { edge } from './clipGraphProjectionGraph';

export const hasTextSourceGraph = (clip: TimelineClip) => clip.source?.type === 'text' && !!clip.textProperties;
export const textGraphId = (clipId: string) => `clip-graph:${clipId}:text`;
const port = (id: string, type: NodeGraphPort['type'], direction: NodeGraphPort['direction'], label = id): NodeGraphPort => ({
  id, label, type, direction, metadata: { readOnly: true, semanticKind: `text:${id}` },
});

export function createTextRenderNode(clip: TimelineClip): NodeGraphNode {
  return { id: 'text-render', kind: 'transform', runtime: 'subgraph', label: 'Text',
    description: 'Typography, layout and appearance rendered to a texture.',
    inputs: [port('input', 'text', 'input', 'Text')], outputs: [{ id: 'output', label: 'Texture', type: 'texture', direction: 'output' }],
    layout: { x: 280, y: 100 }, binding: { kind: 'clip-text', stage: 'render' }, subgraphId: textGraphId(clip.id) };
}

/** Exposes the existing text renderer's dependencies; inspector edits use its canonical clip fields. */
export function buildTextSourceGraph(clip: TimelineClip): NodeGraph | null {
  if (!hasTextSourceGraph(clip)) return null;
  const properties = clip.textProperties!;
  const make = (stage: TextNodeStage, x: number, y: number, inputs: NodeGraphPort[], outputs: NodeGraphPort[]): NodeGraphNode => ({
    id: stage, kind: stage === 'content' ? 'source' : stage === 'render' ? 'output' : 'transform',
    runtime: 'builtin', label: TEXT_NODE_STAGES[stage].label,
    description: stage === 'content' ? 'Text supplied by the clip source.' : stage === 'render' ? 'Shared text renderer output before image effects.' : `Shared ${TEXT_NODE_STAGES[stage].label.toLowerCase()} settings.`,
    inputs, outputs, binding: { kind: 'clip-text', stage }, operatorId: `text.${stage}`,
    params: Object.fromEntries(TEXT_NODE_STAGES[stage].fields.flatMap(field => {
      const value = properties[field]; return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [[field, value]] : [];
    })),
    layout: clip.nodeGraph?.groups?.text?.nodeLayouts?.[stage] ?? { x, y },
  });
  const nodes = [
    make('content', 0, 0, [], [port('text', 'text', 'output', 'Text')]),
    make('typography', 0, 250, [], [port('typography', 'metadata', 'output', 'Typography')]),
    make('layout', 280, 0, [port('text', 'text', 'input', 'Text'), port('typography', 'metadata', 'input', 'Typography')], [port('layout', 'metadata', 'output', 'Layout')]),
    ...(['fill', 'stroke', 'shadow'] as const).map((stage, index) => make(stage, 280, 280 + index * 210, [], [port(stage, 'metadata', 'output', TEXT_NODE_STAGES[stage].label)])),
    make('render', 600, 0, ['layout', 'fill', 'stroke', 'shadow'].map(id => port(id, 'metadata', 'input')), [{ id: 'texture', label: 'Texture', type: 'texture', direction: 'output' }]),
  ];
  const edges = [edge('content', 'text', 'layout', 'text', 'text'), edge('typography', 'typography', 'layout', 'typography', 'metadata'),
    ...['layout', 'fill', 'stroke', 'shadow'].map(id => edge(id, id, 'render', id, 'metadata'))].map(link => ({ ...link, readOnly: true }));
  return { id: textGraphId(clip.id), owner: { kind: 'clip', id: clip.id, name: clip.name }, nodes, edges, domain: 'clip' };
}

/** Migrate the old raster source endpoint without losing manually wired consumers. */
export function migrateTextSourceEdges(graph: NodeGraph, saved: NodeGraph['edges']): NodeGraph['edges'] {
  if (!graph.nodes.some(node => node.id === 'text-render')) return saved;
  return saved.filter(link => !(link.toNodeId === 'text-render' && link.toPortId === 'input')).map(link => {
    if (link.fromNodeId !== 'source' || link.fromPortId !== 'texture') return link;
    return { ...link, fromNodeId: 'text-render', fromPortId: 'output', id: `text-render:output->${link.toNodeId}:${link.toPortId}` };
  });
}
