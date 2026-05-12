import type { Effect, TimelineClip, TimelineTrack } from '../../types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type {
  ClipNodeGraph,
  ClipNodeGraphBacking,
  ClipCustomNodeDefinition,
  ClipNodeGraphNodeState,
  NodeGraph,
  NodeGraphEdge,
  NodeGraphLayout,
  NodeGraphNode,
  NodeGraphPort,
  NodeGraphSignalType,
} from './types';

const NODE_SPACING_X = 230;
const MAIN_LANE_Y = 88;
const AUDIO_LANE_Y = 252;

interface NodeGraphConnection {
  nodeId: string;
  portId: string;
}

function outputPort(id: string, label: string, type: NodeGraphSignalType): NodeGraphPort {
  return { id, label, type, direction: 'output' };
}

function inputPort(id: string, label: string, type: NodeGraphSignalType): NodeGraphPort {
  return { id, label, type, direction: 'input' };
}

function clonePort(port: NodeGraphPort): NodeGraphPort {
  return { ...port };
}

function edge(
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
  type: NodeGraphSignalType,
): NodeGraphEdge {
  return {
    id: `${fromNodeId}:${fromPortId}->${toNodeId}:${toPortId}`,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    type,
  };
}

function isVisualSource(clip: TimelineClip): boolean {
  return clip.source?.type !== 'audio';
}

function sourceOutputType(clip: TimelineClip): NodeGraphSignalType {
  switch (clip.source?.type) {
    case 'model':
    case 'gaussian-avatar':
    case 'gaussian-splat':
      return 'geometry';
    case 'audio':
      return 'audio';
    default:
      return 'texture';
  }
}

function describeSource(clip: TimelineClip, track?: TimelineTrack): string {
  const sourceType = clip.source?.type ?? 'unknown';
  const trackLabel = track ? `${track.name} ${track.type}` : 'Timeline clip';
  return `${trackLabel} source: ${sourceType}`;
}

function transformIsDefault(clip: TimelineClip): boolean {
  const transform = clip.transform;
  return (
    transform.opacity === DEFAULT_TRANSFORM.opacity &&
    transform.blendMode === DEFAULT_TRANSFORM.blendMode &&
    transform.position.x === DEFAULT_TRANSFORM.position.x &&
    transform.position.y === DEFAULT_TRANSFORM.position.y &&
    (transform.position.z ?? 0) === (DEFAULT_TRANSFORM.position.z ?? 0) &&
    transform.scale.x === DEFAULT_TRANSFORM.scale.x &&
    transform.scale.y === DEFAULT_TRANSFORM.scale.y &&
    (transform.scale.z ?? 1) === (DEFAULT_TRANSFORM.scale.z ?? 1) &&
    (transform.scale.all ?? 1) === (DEFAULT_TRANSFORM.scale.all ?? 1) &&
    transform.rotation.x === DEFAULT_TRANSFORM.rotation.x &&
    transform.rotation.y === DEFAULT_TRANSFORM.rotation.y &&
    transform.rotation.z === DEFAULT_TRANSFORM.rotation.z &&
    (clip.speed ?? 1) === 1 &&
    clip.reversed !== true
  );
}

function hasActiveMasks(clip: TimelineClip): boolean {
  return clip.masks?.some((mask) => mask.enabled !== false) ?? false;
}

function hasColorGraph(clip: TimelineClip): boolean {
  return clip.colorCorrection?.enabled === true;
}

function isAudioEffect(effect: Effect): boolean {
  return effect.type === 'audio-eq' || effect.type === 'audio-volume';
}

function createSourceNode(clip: TimelineClip, track?: TimelineTrack): NodeGraphNode {
  const outputs: NodeGraphPort[] = [];
  const primaryOutput = sourceOutputType(clip);

  outputs.push(outputPort(primaryOutput, primaryOutput, primaryOutput));
  outputs.push(outputPort('time', 'time', 'time'));
  outputs.push(outputPort('metadata', 'metadata', 'metadata'));

  if (clip.source?.type === 'video') {
    outputs.push(outputPort('audio', 'audio', 'audio'));
  }

  return {
    id: 'source',
    kind: 'source',
    runtime: 'builtin',
    label: `${clip.source?.type ?? 'Unknown'} Source`,
    description: describeSource(clip, track),
    sourceType: clip.source?.type,
    inputs: [],
    outputs,
    params: {
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
    },
    layout: { x: 0, y: MAIN_LANE_Y },
  };
}

function createTransformNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
  return {
    id: 'transform',
    kind: 'transform',
    runtime: 'builtin',
    label: 'Transform',
    description: 'Clip transform, opacity, blend mode, speed, and reverse state.',
    inputs: [inputPort('input', signalType, signalType)],
    outputs: [outputPort('output', signalType, signalType)],
    params: {
      opacity: clip.transform.opacity,
      blendMode: clip.transform.blendMode,
      x: clip.transform.position.x,
      y: clip.transform.position.y,
      scaleX: clip.transform.scale.x,
      scaleY: clip.transform.scale.y,
      rotation: clip.transform.rotation.z,
      speed: clip.speed ?? 1,
      reversed: clip.reversed === true,
    },
    layout: { x: depth * NODE_SPACING_X, y: MAIN_LANE_Y },
  };
}

function createMaskNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
  const maskCount = clip.masks?.filter((mask) => mask.enabled !== false).length ?? 0;
  return {
    id: 'mask',
    kind: 'mask',
    runtime: 'builtin',
    label: 'Masks',
    description: 'Active clip masks applied to the visual signal.',
    inputs: [
      inputPort('input', signalType, signalType),
      inputPort('mask', 'mask', 'mask'),
    ],
    outputs: [outputPort('output', signalType, signalType)],
    params: { masks: maskCount },
    layout: { x: depth * NODE_SPACING_X, y: MAIN_LANE_Y },
  };
}

function createColorNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
  const activeVersion = clip.colorCorrection?.versions.find(
    (version) => version.id === clip.colorCorrection?.activeVersionId,
  );

  return {
    id: 'color',
    kind: 'color',
    runtime: 'builtin',
    label: 'Color Graph',
    description: 'Clip color-correction graph compiled for preview and export.',
    inputs: [inputPort('input', signalType, signalType)],
    outputs: [outputPort('output', signalType, signalType)],
    params: {
      nodes: activeVersion?.nodes.length ?? 0,
      version: activeVersion?.name ?? 'Active',
    },
    layout: { x: depth * NODE_SPACING_X, y: MAIN_LANE_Y },
  };
}

function createEffectNode(effect: Effect, depth: number, laneY: number, signalType: NodeGraphSignalType): NodeGraphNode {
  const paramCount = Object.keys(effect.params ?? {}).length;
  return {
    id: `effect-${effect.id}`,
    kind: 'effect',
    runtime: 'builtin',
    label: effect.name || effect.type,
    description: `${effect.enabled === false ? 'Disabled ' : ''}${effect.type} effect`,
    inputs: [inputPort('input', signalType, signalType)],
    outputs: [outputPort('output', signalType, signalType)],
    params: {
      enabled: effect.enabled !== false,
      params: paramCount,
    },
    layout: { x: depth * NODE_SPACING_X, y: laneY },
  };
}

function createCustomNode(definition: ClipCustomNodeDefinition, depth: number): NodeGraphNode {
  const promptState = definition.ai.prompt.trim().length > 0 ? 'configured' : 'empty';
  return {
    id: definition.id,
    kind: 'custom',
    runtime: definition.runtime,
    label: definition.label,
    description: definition.description ?? 'AI-authored custom node. Draft nodes are deterministic pass-through graph nodes.',
    inputs: definition.inputs.map(clonePort),
    outputs: definition.outputs.map(clonePort),
    params: {
      status: definition.status,
      prompt: promptState,
      ...(definition.params ?? {}),
    },
    layout: { x: depth * NODE_SPACING_X, y: MAIN_LANE_Y },
  };
}

function createOutputNode(depth: number, clip: TimelineClip, signalType: NodeGraphSignalType, y = MAIN_LANE_Y): NodeGraphNode {
  return {
    id: y === AUDIO_LANE_Y ? 'audio-output' : 'output',
    kind: 'output',
    runtime: 'builtin',
    label: y === AUDIO_LANE_Y ? 'Audio Output' : 'Clip Output',
    description: 'Final signal consumed by the timeline, preview, and export layer builders.',
    inputs: [
      inputPort('input', signalType, signalType),
      inputPort('time', 'time', 'time'),
      inputPort('metadata', 'metadata', 'metadata'),
    ],
    outputs: [outputPort('clip', 'timeline', 'timeline')],
    params: {
      duration: clip.duration,
      outPoint: clip.outPoint,
    },
    layout: { x: depth * NODE_SPACING_X, y },
  };
}

function appendProcessingNode(
  nodes: NodeGraphNode[],
  edges: NodeGraphEdge[],
  previousNodeId: string,
  previousPortId: string,
  node: NodeGraphNode,
  signalType: NodeGraphSignalType,
): NodeGraphConnection {
  nodes.push(node);
  edges.push(edge(previousNodeId, previousPortId, node.id, 'input', signalType));
  return { nodeId: node.id, portId: 'output' };
}

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
    case 'output':
      return { kind: 'clip-output' };
    case 'audio-output':
      return { kind: 'clip-audio-output' };
    default:
      if (node.id.startsWith('custom-')) {
        return { kind: 'clip-custom-node', nodeId: node.id };
      }
      if (node.id.startsWith('effect-')) {
        return { kind: 'clip-effect', effectId: node.id.slice('effect-'.length) };
      }
      return { kind: 'clip-output' };
  }
}

function cloneLayout(layout: NodeGraphLayout): NodeGraphLayout {
  return { x: layout.x, y: layout.y };
}

function cloneCustomNodeDefinition(definition: ClipCustomNodeDefinition): ClipCustomNodeDefinition {
  return {
    ...definition,
    inputs: definition.inputs.map(clonePort),
    outputs: definition.outputs.map(clonePort),
    params: definition.params ? { ...definition.params } : undefined,
    ai: { ...definition.ai },
  };
}

function cloneCustomNodeDefinitions(definitions?: ClipCustomNodeDefinition[]): ClipCustomNodeDefinition[] | undefined {
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

function applyClipNodeGraphState(graph: NodeGraph, state?: ClipNodeGraph): NodeGraph {
  if (!state || state.version !== 1) {
    return graph;
  }

  const layoutsByNodeId = new Map(state.nodes.map((node) => [node.id, node.layout]));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const storedLayout = layoutsByNodeId.get(node.id);
      return storedLayout
        ? { ...node, layout: cloneLayout(storedLayout) }
        : node;
    }),
  };
}

function buildProjectedClipNodeGraphState(clip: TimelineClip, track?: TimelineTrack): ClipNodeGraph {
  const graph = buildClipNodeGraphView(clip, track);
  return {
    version: 1,
    nodes: graph.nodes.map(createNodeState),
    customNodes: cloneCustomNodeDefinitions(clip.nodeGraph?.customNodes),
  };
}

export function reconcileClipNodeGraphState(
  clip: TimelineClip,
  track?: TimelineTrack,
  existingState?: ClipNodeGraph,
): ClipNodeGraph {
  const projectedState = buildProjectedClipNodeGraphState(clip, track);
  if (!existingState || existingState.version !== 1) {
    return projectedState;
  }

  const existingNodesById = new Map(existingState.nodes.map((node) => [node.id, node]));
  return {
    version: 1,
    nodes: projectedState.nodes.map((node) => ({
      ...node,
      layout: cloneLayout(existingNodesById.get(node.id)?.layout ?? node.layout),
    })),
    customNodes: cloneCustomNodeDefinitions(existingState.customNodes),
    updatedAt: existingState.updatedAt,
  };
}

export function createClipNodeGraphState(clip: TimelineClip, track?: TimelineTrack): ClipNodeGraph {
  return reconcileClipNodeGraphState(clip, track);
}

export function updateClipNodeGraphLayout(
  clip: TimelineClip,
  nodeId: string,
  layout: NodeGraphLayout,
  track?: TimelineTrack,
): ClipNodeGraph {
  const state = reconcileClipNodeGraphState(clip, track, clip.nodeGraph);
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

export function createClipAICustomNodeDefinition(
  id: string,
  clip: TimelineClip,
  label = 'AI Node',
): ClipCustomNodeDefinition {
  const signalType = sourceOutputType(clip);
  return {
    id,
    label,
    runtime: 'typescript',
    status: 'draft',
    inputs: [
      inputPort('input', signalType, signalType),
      inputPort('time', 'time', 'time'),
      inputPort('metadata', 'metadata', 'metadata'),
    ],
    outputs: [outputPort('output', signalType, signalType)],
    params: {},
    ai: {
      prompt: '',
      updatedAt: Date.now(),
    },
  };
}

export function addClipCustomNodeDefinition(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  track?: TimelineTrack,
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph);
  const customNodes = [
    ...(baseState.customNodes ?? []),
    cloneCustomNodeDefinition(definition),
  ];
  const nextState: ClipNodeGraph = {
    ...baseState,
    customNodes,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState);
}

export function updateClipCustomNodeDefinition(
  clip: TimelineClip,
  nodeId: string,
  updates: Partial<Omit<ClipCustomNodeDefinition, 'id' | 'inputs' | 'outputs' | 'ai'>> & {
    ai?: Partial<ClipCustomNodeDefinition['ai']>;
  },
  track?: TimelineTrack,
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph);
  const customNodes = (baseState.customNodes ?? []).map((definition) => (
    definition.id === nodeId
      ? {
          ...definition,
          ...updates,
          ai: {
            ...definition.ai,
            ...(updates.ai ?? {}),
            updatedAt: Date.now(),
          },
        }
      : definition
  ));

  const nextState: ClipNodeGraph = {
    ...baseState,
    customNodes,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState);
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
    updatedAt: graph.updatedAt,
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
    updatedAt: Date.now(),
  };
}

function buildClipNodeGraphView(clip: TimelineClip, track?: TimelineTrack): NodeGraph {
  const nodes: NodeGraphNode[] = [];
  const edges: NodeGraphEdge[] = [];
  const sourceNode = createSourceNode(clip, track);
  nodes.push(sourceNode);

  const primarySignal = sourceOutputType(clip);
  let depth = 1;
  let chain: NodeGraphConnection = { nodeId: sourceNode.id, portId: primarySignal };

  if (isVisualSource(clip) && !transformIsDefault(clip)) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createTransformNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  if (isVisualSource(clip) && hasActiveMasks(clip)) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createMaskNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  if (isVisualSource(clip) && hasColorGraph(clip)) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createColorNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  for (const effect of clip.effects.filter((candidate) => !isAudioEffect(candidate))) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createEffectNode(effect, depth, MAIN_LANE_Y, primarySignal),
      primarySignal,
    );
    depth += 1;
  }

  for (const customNode of clip.nodeGraph?.customNodes ?? []) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createCustomNode(customNode, depth),
      primarySignal,
    );
    depth += 1;
  }

  const outputNode = createOutputNode(depth, clip, primarySignal);
  nodes.push(outputNode);
  edges.push(edge(chain.nodeId, chain.portId, outputNode.id, 'input', primarySignal));
  edges.push(edge(sourceNode.id, 'time', outputNode.id, 'time', 'time'));
  edges.push(edge(sourceNode.id, 'metadata', outputNode.id, 'metadata', 'metadata'));

  const audioSourceAvailable = clip.source?.type === 'audio' || clip.source?.type === 'video';
  const audioEffects = clip.effects.filter(isAudioEffect);
  if (audioSourceAvailable && audioEffects.length > 0) {
    let audioDepth = 1;
    let audioChain: NodeGraphConnection = { nodeId: sourceNode.id, portId: 'audio' };
    for (const effect of audioEffects) {
      audioChain = appendProcessingNode(
        nodes,
        edges,
        audioChain.nodeId,
        audioChain.portId,
        createEffectNode(effect, audioDepth, AUDIO_LANE_Y, 'audio'),
        'audio',
      );
      audioDepth += 1;
    }
    const audioOutput = createOutputNode(audioDepth, clip, 'audio', AUDIO_LANE_Y);
    nodes.push(audioOutput);
    edges.push(edge(audioChain.nodeId, audioChain.portId, audioOutput.id, 'input', 'audio'));
  }

  return {
    id: `clip-graph:${clip.id}`,
    owner: {
      kind: 'clip',
      id: clip.id,
      name: clip.name,
    },
    nodes,
    edges,
  };
}

export function buildClipNodeGraph(clip: TimelineClip, track?: TimelineTrack): NodeGraph {
  return applyClipNodeGraphState(buildClipNodeGraphView(clip, track), clip.nodeGraph);
}
