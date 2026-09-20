import { withClipSceneGraph } from './clipSceneGraph';
import type { NodeGraph, NodeGraphDocument, NodeGraphNode } from '../../types/nodeGraph';
import type { TimelineClip } from '../../types';
import { buildEffectOperatorGraph } from './effectGraphProjection';
import { foldOperatorGroups } from './nestedOperatorGroups';
import { collapsedArtifactLinks, projectSourceArtifactLinks } from './sourceArtifactProjection';
import { projectKeyframeNodes } from './keyframeNodeProjection';

/** A single canvas projection of every domain. Grouping changes presentation, never processing. */
export function buildUnifiedClipGraph(document: NodeGraphDocument, clip: TimelineClip, clips: TimelineClip[] = []): NodeGraph {
  document = withClipSceneGraph(document, clip, clips);
  const root = document.graphs.find(g => g.id === document.rootGraphId)!;
  const nodes: NodeGraphNode[] = [], edges = root.edges.map(e => ({ ...e }));
  const groups: NonNullable<NodeGraph['groups']> = [];
  let cursor = 0, expansion = 0;
  for (const rootNode of root.nodes) {
    const effect = rootNode.binding?.kind === 'clip-effect' ? clip.effects.find(e => e.id === (rootNode.binding as { effectId: string }).effectId) : undefined;
    const inner = effect?.type === 'face-cables' ? buildEffectOperatorGraph(clip, effect)
      : rootNode.subgraphId ? document.graphs.find(g => g.id === rootNode.subgraphId) : undefined;
    const groupId = rootNode.id === 'scene3d' ? 'scene3d' : effect ? `effect:${effect.id}` : rootNode.binding?.kind === 'clip-color-correction' ? 'color' : 'flock';
    if (!inner) { nodes.push({ ...rootNode, groupOffset: { x: expansion, y: 0 }, layout: { x: rootNode.layout.x + expansion, y: rootNode.layout.y } }); cursor = Math.max(cursor, rootNode.layout.x + expansion + 280); continue; }
    const state = clip.nodeGraph?.groups?.[groupId];
    const offset = state?.position ?? { x: cursor + 35, y: 95 };
    const collapsed = state?.collapsed === true;
    const group = { id: groupId, label: effect?.name ?? (groupId === 'scene3d' ? '3D Scene' : groupId === 'flock' ? 'Flock' : 'Color'),
      color: groupId === 'scene3d' ? '#d7a262' : groupId === 'flock' ? '#7ea65b' : groupId === 'color' ? '#ba8bd6' : '#55a6c4', collapsed, nodeIds: [] as string[], proxyId: rootNode.id };
    groups.push(group);
    if (collapsed) {
      const proxy: NodeGraphNode = { ...rootNode, runtime: 'subgraph', label: group.label, groupId, groupOffset: offset, layout: offset };
      nodes.push(proxy);
      if (effect?.type === 'face-cables') edges.push(...collapsedArtifactLinks(inner, proxy, effect.id));
      group.nodeIds.push(rootNode.id); cursor = Math.max(cursor + 320, offset.x + 320); expansion = cursor - rootNode.layout.x - 280; continue;
    }
    const idFor = (id: string) => `${inner.id}/${id}`;
    const minX = Math.min(0, ...inner.nodes.map(n => n.layout.x)), minY = Math.min(0, ...inner.nodes.map(n => n.layout.y));
    const innerNodes = inner.nodes.map(node => ({ ...node, id: idFor(node.id), groupId,
      groupOffset: { x: offset.x - minX, y: offset.y - minY },
      layout: { x: node.layout.x - minX + offset.x, y: node.layout.y - minY + offset.y } }));
    const entrance = innerNodes.find(n => n.kind === 'source') ?? innerNodes[0];
    const exit = innerNodes.find(n => n.kind === 'output') ?? innerNodes.at(-1)!;
    // Boundary adapters only connect the containing clip chain; internal ports retain their semantics.
    for (const edge of edges) {
      if (edge.toNodeId === rootNode.id) {
        const target = groupId === 'scene3d' && edge.type === 'geometry'
          ? innerNodes.find(n => n.operatorId === 'geometry.source') ?? entrance : entrance;
        const id = `group-in-${edge.toPortId}`;
        if (!target.inputs.some(p => p.id === id)) target.inputs = [...target.inputs, { id, label: 'Clip input', type: edge.type, direction: 'input' }];
        edge.toNodeId = target.id; edge.toPortId = id;
      }
      if (edge.fromNodeId === rootNode.id) {
        const id = `group-out-${edge.fromPortId}`;
        if (!exit.outputs.some(p => p.id === id)) exit.outputs = [...exit.outputs, { id, label: 'Clip output', type: edge.type, direction: 'output' }];
        edge.fromNodeId = exit.id; edge.fromPortId = id;
      }
    }
    nodes.push(...innerNodes); group.nodeIds.push(...innerNodes.map(n => n.id));
    for (const nested of inner.groups ?? []) {
      const collectMembers = (id: string): string[] => (inner.groups ?? []).filter(g => g.parentId === id).flatMap(g => [...g.nodeIds, ...collectMembers(g.id)]);
      groups.push({ ...nested, id: `${groupId}/${nested.id}`, parentId: nested.parentId ? `${groupId}/${nested.parentId}` : groupId,
        proxyId: `${inner.id}/@${nested.id}`, nodeIds: [...nested.nodeIds, ...collectMembers(nested.id)].map(idFor) });
    }
    edges.push(...inner.edges.map(edge => ({ ...edge, id: `${inner.id}/${edge.id}`, fromNodeId: idFor(edge.fromNodeId), toNodeId: idFor(edge.toNodeId) })));
    cursor = Math.max(cursor + 280, ...innerNodes.map(n => n.layout.x + 330));
    expansion = cursor - rootNode.layout.x - 280;
  }
  return foldOperatorGroups(projectKeyframeNodes(projectSourceArtifactLinks({ ...root, nodes, edges, groups }), clip), clip.nodeGraph);
}
