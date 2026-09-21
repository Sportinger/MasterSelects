import { withClipSceneGraph } from './clipSceneGraph';
import type { NodeGraph, NodeGraphDocument, NodeGraphNode } from '../../types/nodeGraph';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import { buildEffectOperatorGraph } from './effectGraphProjection';
import { findClipOperatorEffect, resolveClipOperatorOwner } from '../operators/clipOperatorGraphOwner';
import { hasEffectOperatorGraph } from '../operators/effectGraphOwner';
import { foldOperatorGroups } from './nestedOperatorGroups';
import { collapsedArtifactLinks, projectSourceArtifactLinks } from './sourceArtifactProjection';
import { projectKeyframeNodes } from './keyframeNodeProjection';
import { projectStabilizationGraph } from './stabilizationGraphProjection';

/** A single canvas projection of every domain and its executable ownership. */
export function buildUnifiedClipGraph(document: NodeGraphDocument, clip: TimelineClip, clips: TimelineClip[] = [], keys: readonly Keyframe[] = [], trackingCreatedAt?: number, expandAllGroups = false,
  preparedEffects?: ReadonlyMap<string, NodeGraph>): NodeGraph {
  document = withClipSceneGraph(document, clip, clips);
  const root = document.graphs.find(g => g.id === document.rootGraphId)!;
  const nodes: NodeGraphNode[] = [], edges = root.edges.map(e => ({ ...e }));
  const groups: NonNullable<NodeGraph['groups']> = [];
  let cursor = 0, expansion = 0;
  for (const rootNode of root.nodes) {
    const effectId = rootNode.binding?.kind === 'clip-effect' || rootNode.binding?.kind === 'clip-audio-effect-instance' ? rootNode.binding.effectId : undefined;
    const effectClip = effectId ? resolveClipOperatorOwner(clip, effectId, clips) : undefined;
    const effect = effectId ? findClipOperatorEffect(effectClip, effectId) : undefined;
    const inner = effect && hasEffectOperatorGraph(effect.type) ? preparedEffects?.get(effect.id) ?? buildEffectOperatorGraph(effectClip!, effect)
      : rootNode.subgraphId ? document.graphs.find(g => g.id === rootNode.subgraphId) : undefined;
    const groupId = rootNode.id === 'scene3d' ? 'scene3d' : effect ? `effect:${effect.id}` : rootNode.binding?.kind === 'clip-color-correction' ? 'color' : 'flock';
    if (!inner) { nodes.push({ ...rootNode, groupOffset: { x: expansion, y: 0 }, layout: { x: rootNode.layout.x + expansion, y: rootNode.layout.y } }); cursor = Math.max(cursor, rootNode.layout.x + expansion + 280); continue; }
    const state = clip.nodeGraph?.groups?.[groupId];
    const offset = state?.position ?? { x: cursor + 35, y: 95 };
    const collapsed = !expandAllGroups && state?.collapsed !== false;
    const group = { id: groupId, label: effect?.name ?? (groupId === 'scene3d' ? '3D Scene' : groupId === 'flock' ? 'Flock' : 'Color'),
      color: groupId === 'scene3d' ? '#d7a262' : groupId === 'flock' ? '#7ea65b' : groupId === 'color' ? '#ba8bd6' : '#55a6c4', collapsed, nodeIds: [] as string[], proxyId: rootNode.id, issue: inner.issue,
      ...(effect ? { effectId: effect.id, bypassNodeId: rootNode.id, bypassed: !effect.enabled } : {}),
      layoutMode: 'flow' as const };
    groups.push(group);
    if (collapsed || !inner.nodes.length) {
      const proxy: NodeGraphNode = { ...rootNode, runtime: 'subgraph', label: group.label,
        description: !inner.nodes.length ? 'Empty effect — drop compatible nodes here' : rootNode.description, groupId, groupOffset: offset, layout: offset };
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
        ...(nested.composition ? { composition: { ...nested.composition,
          position: { x: nested.composition.position.x - minX + offset.x, y: nested.composition.position.y - minY + offset.y },
          inputs: nested.composition.inputs.map(port => ({ ...port, endpoints: port.endpoints.map(endpoint => ({ ...endpoint, nodeId: idFor(endpoint.nodeId) })) })),
          outputs: nested.composition.outputs.map(port => ({ ...port, endpoints: port.endpoints.map(endpoint => ({ ...endpoint, nodeId: idFor(endpoint.nodeId) })) })) } } : {}),
        proxyId: `${inner.id}/@${nested.id}`, nodeIds: [...nested.nodeIds, ...collectMembers(nested.id)].map(idFor) });
    }
    edges.push(...inner.edges.map(edge => ({ ...edge, id: `${inner.id}/${edge.id}`, fromNodeId: idFor(edge.fromNodeId), toNodeId: idFor(edge.toNodeId) })));
    cursor = Math.max(cursor + 280, ...innerNodes.map(n => n.layout.x + 330));
    expansion = cursor - rootNode.layout.x - 280;
  }
  const animated = projectKeyframeNodes(projectSourceArtifactLinks({ ...root, nodes, edges, groups }), clip);
  return foldOperatorGroups(projectStabilizationGraph(animated, clip, keys, trackingCreatedAt), clip.nodeGraph, expandAllGroups);
}
