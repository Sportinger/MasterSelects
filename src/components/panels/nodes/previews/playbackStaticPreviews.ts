import type { NodeGraphEdge, NodeGraphNode } from '../../../../types/nodeGraph';

/** Operators whose outputs are a pure function of their inputs and constants. */
const PURE_OPERATOR = /^(values|math|vector|convert|logic|compare)\./;

/**
 * Nodes whose readout cannot change while the playhead moves: pure operators
 * fed only by constants that are not keyframed. Anything reading media, time,
 * tracking or an unknown source is treated as live.
 */
export function playbackStaticNodes(nodes: readonly NodeGraphNode[], edges: readonly NodeGraphEdge[], keyframedProperties: ReadonlySet<string>): Set<string> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const upstream = new Map<string, string[]>();
  for (const edge of edges) upstream.set(edge.toNodeId, [...(upstream.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  // Keyframed effect params name their graph node; an unmatched keyframed param
  // could drive any value of that effect, so its values count as live.
  const keyframedParams = new Map<string, string[]>();
  for (const property of keyframedProperties) {
    const [domain, effectId, ...param] = property.split('.');
    if (domain === 'effect' && effectId && param.length) keyframedParams.set(effectId, [...(keyframedParams.get(effectId) ?? []), param.join('.')]);
  }
  const valueIds = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.binding?.kind === 'effect-operator' && node.operatorId?.startsWith('values.')) {
      valueIds.set(node.binding.effectId, [...(valueIds.get(node.binding.effectId) ?? []), node.binding.nodeId]);
    }
  }
  const animatedValue = (node: NodeGraphNode) => {
    if (node.binding?.kind !== 'effect-operator') return false;
    const params = keyframedParams.get(node.binding.effectId) ?? [];
    const ids = valueIds.get(node.binding.effectId) ?? [];
    const nodeId = node.binding.nodeId;
    return params.some(param => param.includes(nodeId) || !ids.some(id => param.includes(id)));
  };
  const memo = new Map<string, boolean>();
  const isStatic = (id: string): boolean => {
    const known = memo.get(id); if (known !== undefined) return known;
    memo.set(id, false); // cycles and re-entry stay live
    const node = byId.get(id);
    const result = !!node && PURE_OPERATOR.test(node.operatorId ?? '') && !node.animation?.channels.length
      && !animatedValue(node) && (upstream.get(id) ?? []).every(isStatic);
    memo.set(id, result);
    return result;
  };
  return new Set(nodes.filter(node => isStatic(node.id)).map(node => node.id));
}
