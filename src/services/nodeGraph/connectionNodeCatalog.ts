import type { TimelineClip } from '../../types/timeline';
import type { NodeConnectionDrop, NodeGraph } from '../../types/nodeGraph';
import type { OperatorDefinition } from '../../types/operatorGraph';
import { getCategoriesWithEffects } from '../../effects';
import { getAllAudioEffects } from '../../engine/audio/AudioEffectRegistry';
import { addableEffectOperators, effectOperatorGraph } from '../operators/effectGraphOwner';
import { findClipOperatorEffect, resolveClipOperatorOwner } from '../operators/clipOperatorGraphOwner';
import { operatorConnectionGraph } from '../operators/operatorConnectionGraph';
import { operatorAdaptiveVariants } from '../operators/operatorAdaptiveVariants';
import { operatorAddMenu } from '../operators/operatorAddMenu';
import { NODE_CATEGORIES, operatorCategoryId, operatorCategoryLabel, operatorVisibility } from '../operators/operatorTaxonomy';
import { catalogText } from './catalogText';
import { projectOperatorPort } from '../operators/operatorPortProjection';
import { SCENE_OPERATORS } from '../operators/sceneOperators';
import { sceneGraphForClip } from '../operators/sceneGraph';
import { connectedNodeOptions, type ConnectionEndpoint, type ConnectionNodeCandidate } from './connectedNodeOptions';
import { resolveLinkedAudioClip } from './clipGraphProjectionAudio';
import { resolveLinkedClipNodeGraphContext } from './clipGraphLinking';
import { domainConnectionCatalog } from './domainConnectionCatalog';

export const NEW_CONNECTION_NODE = '__new_connection_node__';
export function operatorConnectionCandidates(operators: readonly OperatorDefinition[]): ConnectionNodeCandidate[] {
  // Basic nodes by category, then reusable node groups; effect building parts stay in the Advanced menus.
  return operatorAddMenu(operators.filter(operator => operatorVisibility(operator) === 'public')).map(operator => {
    const category = operatorCategoryId(operator), rank = NODE_CATEGORIES.findIndex(entry => entry.id === category);
    return { id: operator.id, label: operator.label,
    category: `${operator.composition ? 'Node Groups · ' : ''}${operatorCategoryLabel(operator)}`,
    order: (operator.composition ? NODE_CATEGORIES.length : 0) + (rank < 0 ? NODE_CATEGORIES.length - 1 : rank),
    description: catalogText(operator.id).description ?? operator.description,
    node: { id: NEW_CONNECTION_NODE, operatorId: operator.id, connectionVariants: operatorAdaptiveVariants(operator, operators),
      inputs: operator.inputs.map(port => projectOperatorPort(port, 'input')),
      outputs: operator.outputs.map(port => projectOperatorPort(port, 'output')) } };
  });
}

/** Resolve a displayed group socket back to the canonical owner's endpoint(s). */
export function connectionNodeCatalog(clip: TimelineClip, graph: NodeGraph, drop: NodeConnectionDrop, clips: readonly TimelineClip[]) {
  const visible = graph.nodes.find(node => node.id === drop.nodeId);
  const port = (drop.direction === 'input' ? visible?.inputs : visible?.outputs)?.find(port => port.id === drop.portId);
  if (!visible || !port || port.metadata?.readOnly) throw new Error('This port is unavailable or read-only.');
  const endpoint = port.metadata?.groupEndpoint;
  const node = endpoint ? graph.expandedNodes?.find(node => node.id === endpoint.nodeId) ?? visible : visible;
  const binding = node.binding;
  const endpoints = (drop.direction === 'input' && port.metadata?.groupEndpoints) || [endpoint ?? { nodeId: node.id, portId: port.id }];
  const localEndpoints = endpoints.map(point => ({ nodeId: point.nodeId.split('/').at(-1)!, portId: point.portId }));
  const localOrigin: ConnectionEndpoint = { ...localEndpoints[0], direction: drop.direction };
  const position = { x: drop.layout.x - (node.groupOffset?.x ?? 0) - (drop.direction === 'input' ? 184 : 0),
    y: drop.layout.y - (node.groupOffset?.y ?? 0) };
  const prefix = node.id.includes('/') ? node.id.slice(0, node.id.lastIndexOf('/') + 1) : '';
  if (!drop.portId.startsWith('group-') && (binding?.kind === 'effect-operator' || binding?.kind === 'scene-operator')) {
    const owner = binding.kind === 'effect-operator' ? resolveClipOperatorOwner(clip, binding.effectId, [...clips]) : clip;
    if (!owner) throw new Error('Graph owner is unavailable.');
    const effect = binding.kind === 'effect-operator' ? findClipOperatorEffect(owner, binding.effectId) : undefined;
    const supported = effect ? addableEffectOperators(effect.type) : SCENE_OPERATORS.filter(operator => operator.addable);
    const canonical = effect ? effectOperatorGraph(effect) : sceneGraphForClip(owner).graph;
    // Dragging out of a collapsed building block adds beside it, not invisibly inside it.
    const visibleGroupId = visible.binding?.kind === 'operator-group' ? visible.binding.groupId.split('/').at(-1) : undefined;
    const groupId = visibleGroupId ? canonical.groups?.find(group => group.id === visibleGroupId)?.parentId ?? null : undefined;
    const options = connectedNodeOptions(operatorConnectionGraph(canonical, supported), localOrigin, operatorConnectionCandidates(supported));
    return { kind: effect ? 'effect' as const : 'scene' as const, ownerId: owner.id, effectId: effect?.id,
      origin: localOrigin, endpoints: localEndpoints, position, prefix, options, groupId };
  }
  const domain = !drop.portId.startsWith('group-') && domainConnectionCatalog(clip, binding, localOrigin);
  if (domain) return { ...domain, ownerId: clip.id, origin: localOrigin, endpoints: localEndpoints, position, prefix };
  // Root clip ports carry image/audio streams; their nodes are effect instances.
  if (node.id.includes('/') && !drop.portId.startsWith('group-')) throw new Error('No addable nodes are available at this boundary.');
  const group = graph.groups?.find(group => group.id === node.groupId);
  const origin: ConnectionEndpoint = { nodeId: group?.proxyId ?? node.id,
    portId: drop.portId.replace(/^group-(in|out)-/, ''), direction: drop.direction };
  const streamPort = { ...port, id: origin.portId };
  const linked = resolveLinkedClipNodeGraphContext(clips, [], clip.id)?.linkedClip;
  const audioOwner = resolveLinkedAudioClip(clip, linked);
  const candidates: ConnectionNodeCandidate[] = [];
  const stream = (id: string, label: string, category: string, type: 'audio' | 'texture') => candidates.push({ id, label, category,
    node: { id: NEW_CONNECTION_NODE, inputs: [{ id: 'input', label: 'Input', type, direction: 'input' }],
      outputs: [{ id: 'output', label: 'Output', type, direction: 'output' }] } });
  if (port.type === 'audio' && audioOwner) for (const descriptor of getAllAudioEffects()) stream(`audio:${descriptor.id}`, descriptor.name, 'Audio effects', 'audio');
  if (port.type === 'texture' && clip.source?.type !== 'audio') {
    for (const { category, effects } of getCategoriesWithEffects()) for (const effect of effects) stream(`effect:${effect.id}`, effect.name, category, 'texture');
    for (const id of ['transform', 'mask', 'color']) if (!graph.nodes.some(node => node.id === id) && !graph.groups?.some(group => group.id === id))
      stream(`builtin:${id}`, id[0].toUpperCase() + id.slice(1), 'Clip', 'texture');
  }
  return { kind: 'clip' as const, ownerId: port.type === 'audio' ? audioOwner?.id ?? clip.id : clip.id, origin, endpoints: [origin],
    position: { x: drop.layout.x - (drop.direction === 'input' ? 184 : 0), y: drop.layout.y }, prefix: '',
    options: connectedNodeOptions({ nodes: [{ id: origin.nodeId, inputs: drop.direction === 'input' ? [streamPort] : [],
      outputs: drop.direction === 'output' ? [streamPort] : [] }], edges: [] }, origin, candidates) };
}
export type ConnectionNodeCatalog = ReturnType<typeof connectionNodeCatalog>;
