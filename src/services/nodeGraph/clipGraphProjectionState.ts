import { extractAINodeGeneratedCode } from './aiNodeDefinition';
import { buildClipNodeGraphView } from './clipGraphProjectionBuildView';
import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import {
  cloneEdge,
  cloneLayout,
  cloneManualEdges,
  createValidatedManualEdge,
  validateManualEdges,
} from './clipGraphProjectionGraph';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import type {
  ClipCustomNodeAIAuthoring,
  ClipCustomNodeDefinition,
  ClipNodeGraph,
  ClipNodeGraphBacking,
  ClipNodeGraphNodeState,
  NodeGraph,
  NodeGraphConnectionRequest,
  NodeGraphEdge,
  NodeGraphLayout,
  NodeGraphNode,
} from './types';

function getNodeBacking(node: NodeGraphNode): ClipNodeGraphBacking {
  switch (node.id) {
    case 'source':
      return { kind: 'clip-source' };
    case 'transform':
      return { kind: 'clip-transform' };
    case 'mask':
      return { kind: 'clip-mask-stack' };
    case 'color':
      return { kind: 'clip-color-correction' };
    case 'audio-analysis':
      return { kind: 'clip-audio-analysis' };
    case 'output':
      return { kind: 'clip-output' };
    case 'audio-output':
      return { kind: 'clip-audio-output' };
    default:
      if (node.id.startsWith('custom-')) {
        return { kind: 'clip-custom-node', nodeId: node.id };
      }
      if (node.id.startsWith('audio-effect-')) {
        return { kind: 'clip-audio-effect-instance', effectId: node.id.slice('audio-effect-'.length) };
      }
      if (node.id.startsWith('effect-')) {
        return { kind: 'clip-effect', effectId: node.id.slice('effect-'.length) };
      }
      return { kind: 'clip-output' };
  }
}

export function cloneCustomNodeDefinition(definition: ClipCustomNodeDefinition): ClipCustomNodeDefinition {
  return {
    ...definition,
    inputs: definition.inputs.map((port) => ({ ...port, ...(port.metadata ? { metadata: { ...port.metadata } } : {}) })),
    outputs: definition.outputs.map((port) => ({ ...port, ...(port.metadata ? { metadata: { ...port.metadata } } : {}) })),
    params: definition.params ? { ...definition.params } : undefined,
    parameterSchema: definition.parameterSchema?.map((param) => ({
      ...param,
      options: param.options?.map((option) => ({ ...option })),
    })),
    ai: cloneCustomNodeAIAuthoring(definition.ai),
  };
}

function cloneCustomNodeAIAuthoring(ai: ClipCustomNodeAIAuthoring): ClipCustomNodeAIAuthoring {
  const generatedCode = ai.generatedCode !== undefined
    ? ai.generatedCode
    : [...(ai.conversation ?? [])]
        .reverse()
        .map((message) => message.kind === 'code' ? extractAINodeGeneratedCode(message.content) : null)
        .find((code): code is string => !!code);

  return {
    ...ai,
    ...(generatedCode ? { generatedCode } : {}),
    conversation: ai.conversation?.map((message) => ({ ...message })),
  };
}

export function cloneCustomNodeDefinitions(definitions?: ClipCustomNodeDefinition[]): ClipCustomNodeDefinition[] | undefined {
  if (!definitions || definitions.length === 0) {
    return undefined;
  }
  return definitions.map(cloneCustomNodeDefinition);
}

function createNodeState(node: NodeGraphNode): ClipNodeGraphNodeState {
  return {
    id: node.id,
    backing: getNodeBacking(node),
    layout: cloneLayout(node.layout),
  };
}

export function applyClipNodeGraphState(graph: NodeGraph, state?: ClipNodeGraph): NodeGraph {
  if (!state || state.version !== 1) {
    return graph;
  }

  const layoutsByNodeId = new Map(state.nodes.map((node) => [node.id, node.layout]));
  const graphWithLayouts = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const storedLayout = layoutsByNodeId.get(node.id);
      return storedLayout
        ? { ...node, layout: cloneLayout(storedLayout) }
        : node;
    }),
  };

  if (state.manualEdges === undefined) {
    return graphWithLayouts;
  }

  return {
    ...graphWithLayouts,
    edges: validateManualEdges(graphWithLayouts, state.manualEdges),
  };
}

function buildProjectedClipNodeGraphState(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const graph = buildClipNodeGraphView(clip, track, options);
  const manualEdges = clip.nodeGraph?.manualEdges === undefined
    ? undefined
    : validateManualEdges(graph, clip.nodeGraph.manualEdges);

  return {
    version: 1,
    nodes: graph.nodes.map(createNodeState),
    customNodes: cloneCustomNodeDefinitions(clip.nodeGraph?.customNodes),
    forcedBuiltIns: clip.nodeGraph?.forcedBuiltIns ? [...clip.nodeGraph.forcedBuiltIns] : undefined,
    ...(manualEdges !== undefined ? { manualEdges } : {}),
  };
}

export function reconcileClipNodeGraphState(
  clip: TimelineClip,
  track?: TimelineTrack,
  existingState?: ClipNodeGraph,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const projectedState = buildProjectedClipNodeGraphState(clip, track, options);
  if (!existingState || existingState.version !== 1) {
    return projectedState;
  }

  const existingNodesById = new Map(existingState.nodes.map((node) => [node.id, node]));
  const graphForValidation = buildClipNodeGraphView({
    ...clip,
    nodeGraph: {
      ...projectedState,
      customNodes: cloneCustomNodeDefinitions(existingState.customNodes),
      forcedBuiltIns: existingState.forcedBuiltIns ? [...existingState.forcedBuiltIns] : undefined,
    },
  }, track, options);
  const manualEdges = existingState.manualEdges === undefined
    ? undefined
    : validateManualEdges(graphForValidation, existingState.manualEdges);

  return {
    version: 1,
    nodes: projectedState.nodes.map((node) => ({
      ...node,
      layout: cloneLayout(existingNodesById.get(node.id)?.layout ?? node.layout),
    })),
    customNodes: cloneCustomNodeDefinitions(existingState.customNodes),
    forcedBuiltIns: existingState.forcedBuiltIns ? [...existingState.forcedBuiltIns] : undefined,
    ...(manualEdges !== undefined ? { manualEdges } : {}),
    updatedAt: existingState.updatedAt,
  };
}

export function createClipNodeGraphState(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  return reconcileClipNodeGraphState(clip, track, undefined, options);
}

export function updateClipNodeGraphLayout(
  clip: TimelineClip,
  nodeId: string,
  layout: NodeGraphLayout,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const state = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const nodes = state.nodes.map((node) => (
    node.id === nodeId
      ? { ...node, layout: cloneLayout(layout) }
      : node
  ));

  if (!nodes.some((node) => node.id === nodeId)) {
    return state;
  }

  return {
    ...state,
    nodes,
    updatedAt: Date.now(),
  };
}

export function connectClipNodeGraphPorts(
  clip: TimelineClip,
  connection: NodeGraphConnectionRequest,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const state = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const graph = applyClipNodeGraphState(buildClipNodeGraphView({ ...clip, nodeGraph: state }, track, options), state);
  const nextEdge = createValidatedManualEdge(graph, connection);

  if (!nextEdge) {
    return state;
  }

  const edges = graph.edges
    .filter((candidate) => (
      candidate.id !== nextEdge.id &&
      !(candidate.toNodeId === nextEdge.toNodeId && candidate.toPortId === nextEdge.toPortId)
    ))
    .map(cloneEdge);

  edges.push(nextEdge);

  return {
    ...state,
    manualEdges: validateManualEdges(graph, edges),
    updatedAt: Date.now(),
  };
}

export function disconnectClipNodeGraphEdge(
  clip: TimelineClip,
  edgeId: string,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const state = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const graph = applyClipNodeGraphState(buildClipNodeGraphView({ ...clip, nodeGraph: state }, track, options), state);
  const edges = graph.edges.filter((candidate) => candidate.id !== edgeId).map(cloneEdge);

  if (edges.length === graph.edges.length) {
    return state;
  }

  return {
    ...state,
    manualEdges: validateManualEdges(graph, edges),
    updatedAt: Date.now(),
  };
}

export function cloneClipNodeGraph(graph?: ClipNodeGraph): ClipNodeGraph | undefined {
  if (!graph || graph.version !== 1) {
    return undefined;
  }

  return {
    version: 1,
    nodes: graph.nodes.map((node) => ({
      ...node,
      backing: { ...node.backing },
      layout: cloneLayout(node.layout),
    })),
    customNodes: cloneCustomNodeDefinitions(graph.customNodes),
    forcedBuiltIns: graph.forcedBuiltIns ? [...graph.forcedBuiltIns] : undefined,
    manualEdges: cloneManualEdges(graph.manualEdges),
    updatedAt: graph.updatedAt,
  };
}

function remapEffectNodeId(nodeId: string, effectIdMap: Map<string, string>): string {
  if (!nodeId.startsWith('effect-')) {
    return nodeId;
  }

  const nextEffectId = effectIdMap.get(nodeId.slice('effect-'.length));
  return nextEffectId ? `effect-${nextEffectId}` : nodeId;
}

function remapManualEdgeEffectIds(edgeToRemap: NodeGraphEdge, effectIdMap: Map<string, string>): NodeGraphEdge {
  const fromNodeId = remapEffectNodeId(edgeToRemap.fromNodeId, effectIdMap);
  const toNodeId = remapEffectNodeId(edgeToRemap.toNodeId, effectIdMap);
  return {
    ...edgeToRemap,
    fromNodeId,
    toNodeId,
    id: `${fromNodeId}:${edgeToRemap.fromPortId}->${toNodeId}:${edgeToRemap.toPortId}`,
  };
}

export function remapClipNodeGraphEffectIds(
  graph: ClipNodeGraph | undefined,
  effectIdMap: Map<string, string>,
): ClipNodeGraph | undefined {
  const cloned = cloneClipNodeGraph(graph);
  if (!cloned) return undefined;

  return {
    ...cloned,
    nodes: cloned.nodes.map((node) => {
      if (node.backing.kind !== 'clip-effect') {
        return node;
      }

      const nextEffectId = effectIdMap.get(node.backing.effectId);
      if (!nextEffectId) {
        return node;
      }

      return {
        ...node,
        id: `effect-${nextEffectId}`,
        backing: { kind: 'clip-effect', effectId: nextEffectId },
      };
    }),
    manualEdges: cloned.manualEdges?.map((candidate) => remapManualEdgeEffectIds(candidate, effectIdMap)),
    updatedAt: Date.now(),
  };
}
