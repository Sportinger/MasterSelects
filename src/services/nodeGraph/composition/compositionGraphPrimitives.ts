import type {
  CompositionNodeBinding, NodeGraphEdge, NodeGraphLayout, NodeGraphNode,
  NodeGraphPort, NodeGraphPortMetadata, NodeGraphSignalType,
} from '../../../types/nodeGraph';
import type { CompositionGraphState } from '../../../types/compositionGraph';

/** Stable presentation group ids, separate from executable clip identities. */
export const compositionGroupId = {
  media: () => 'comp:media',
  timeChain: (clipId: string) => `comp:clip:${clipId}:time-chain`,
} as const;

export function compositionPort(
  id: string, label: string, type: NodeGraphSignalType,
  direction: 'input' | 'output', metadata: NodeGraphPortMetadata = {},
): NodeGraphPort {
  const time = type === 'time' || type === 'event';
  return { id, label, type, direction, metadata: {
    readOnly: true,
    contract: {
      typeLabel: time ? `${label} (seconds)` : label,
      description: time ? 'Seconds in composition timeline time.' : `${label}: ${type} reference.`,
      formats: [time ? 'seconds' : type],
      ...(time ? { constraints: ['unit: seconds', 'time-domain: timeline-time'] } : {}),
    },
    ...metadata,
  } };
}

export function compositionEdge(
  fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string,
  type: NodeGraphSignalType, readOnly = true, identity?: string,
): NodeGraphEdge {
  return { id: JSON.stringify([fromNodeId, fromPortId, toNodeId, toPortId, identity ?? '']),
    fromNodeId, fromPortId, toNodeId, toPortId, type, readOnly };
}

export function compositionNode(
  state: CompositionGraphState | undefined, id: string, label: string,
  binding: CompositionNodeBinding | { kind: 'operator-group'; groupId: string },
  layout: NodeGraphLayout, inputs: NodeGraphPort[] = [], outputs: NodeGraphPort[] = [],
): NodeGraphNode {
  const saved = state?.layout?.nodes[id];
  return { id, label, binding, defaultLayout: { ...layout }, layout: saved ? { ...saved } : { ...layout }, inputs, outputs,
    kind: binding.kind === 'composition-output' ? 'output'
      : binding.kind === 'composition-media' || binding.kind === 'composition-beat-source' ? 'source' : 'custom',
    runtime: 'builtin', domain: 'clip' };
}

export function finite(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function seconds(value: number): string {
  return `${Number(finite(value).toFixed(3))}s`;
}
