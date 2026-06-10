import { getAudioEffect, hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import {
  appendAudioAnalysisPorts,
  hasAnyAudioAnalysisRef,
  hasAudioAnalysisSurface,
  isAudioAnalysisSeededInput,
  resolveLinkedAudioClip,
  summarizeAudioAnalysisOutputs,
} from './clipGraphProjectionAudio';
import type { AudioEffectInstance, Effect, TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import { clonePort, edge, inputPort, outputPort } from './clipGraphProjectionGraph';
import {
  AUDIO_LANE_Y,
  AUDIO_ANALYSIS_LANE_Y,
  MAIN_LANE_Y,
  NODE_SPACING_X,
  type ClipNodeGraphBuildOptions,
  type NodeGraphChainHead,
} from './clipGraphProjectionShared';
import type {
  ClipCustomNodeDefinition,
  ClipNodeGraphForcedBuiltIn,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPort,
  NodeGraphSignalType,
} from './types';
export function isVisualSource(clip: TimelineClip): boolean {
  return clip.source?.type !== 'audio';
}

export function sourceOutputType(clip: TimelineClip): NodeGraphSignalType {
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

function describeLinkedSource(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  audioClip: TimelineClip | undefined,
  linkedTrack?: TimelineTrack | null,
): string {
  const description = describeSource(clip, track);
  if (!audioClip || audioClip.id === clip.id) {
    return description;
  }

  const audioTrackLabel = linkedTrack ? `${linkedTrack.name} ${linkedTrack.type}` : 'linked audio clip';
  return `${description}; audio from ${audioTrackLabel}`;
}

export function transformIsDefault(clip: TimelineClip): boolean {
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

export function hasActiveMasks(clip: TimelineClip): boolean {
  return clip.masks?.some((mask) => mask.enabled !== false) ?? false;
}

export function hasColorGraph(clip: TimelineClip): boolean {
  return clip.colorCorrection?.enabled === true;
}

export function hasForcedBuiltInNode(clip: TimelineClip, node: ClipNodeGraphForcedBuiltIn): boolean {
  return clip.nodeGraph?.forcedBuiltIns?.includes(node) ?? false;
}

export function isAudioEffect(effect: Effect): boolean {
  return hasAudioEffect(effect.type);
}

export function createSourceNode(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraphNode {
  const outputs: NodeGraphPort[] = [];
  const primaryOutput = sourceOutputType(clip);
  const linkedClip = options.linkedClip ?? undefined;
  const audioClip = resolveLinkedAudioClip(clip, linkedClip);
  const audioAnalysisOutputStart = outputs.length;

  outputs.push(outputPort(
    primaryOutput,
    primaryOutput,
    primaryOutput,
    primaryOutput === 'audio'
      ? { semanticKind: 'audio-source', targetClipId: audioClip?.id ?? clip.id, available: true, previewable: true }
      : undefined,
  ));
  outputs.push(outputPort('time', 'time', 'time'));
  outputs.push(outputPort('metadata', 'metadata', 'metadata'));

  if (audioClip && primaryOutput !== 'audio') {
    outputs.push(outputPort('audio', 'audio', 'audio', {
      semanticKind: 'audio-source',
      targetClipId: audioClip.id,
      available: true,
      previewable: true,
    }));
  }

  if (audioClip && hasAudioAnalysisSurface(audioClip)) {
    appendAudioAnalysisPorts(outputs, audioClip);
  }
  const analysisOutputs = outputs.slice(audioAnalysisOutputStart).filter((port) => (
    port.metadata?.generateAction?.type === 'generate-audio-analysis'
  ));
  const hasAnalysisOutputs = analysisOutputs.length > 0;

  return {
    id: 'source',
    kind: 'source',
    runtime: 'builtin',
    label: audioClip && audioClip.id !== clip.id
      ? `${clip.source?.type ?? 'Unknown'} + audio Source`
      : `${clip.source?.type ?? 'Unknown'} Source`,
    description: describeLinkedSource(clip, track, audioClip, options.linkedTrack),
    sourceType: clip.source?.type,
    inputs: [],
    outputs,
    params: {
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      ...(audioClip && audioClip.id !== clip.id ? { linkedAudioClipId: audioClip.id } : {}),
      ...(hasAnalysisOutputs ? {
        sourceRefs: hasAnyAudioAnalysisRef(audioClip?.audioState?.sourceAnalysisRefs),
        processedRefs: hasAnyAudioAnalysisRef(audioClip?.audioState?.processedAnalysisRefs),
        ...summarizeAudioAnalysisOutputs(outputs),
      } : {}),
    },
    layout: { x: 0, y: MAIN_LANE_Y },
  };
}
export function createTransformNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
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

export function createMaskNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
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

export function createColorNode(depth: number, signalType: NodeGraphSignalType, clip: TimelineClip): NodeGraphNode {
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

export function createEffectNode(
  effect: Effect,
  depth: number,
  laneY: number,
  signalType: NodeGraphSignalType,
  targetClipId?: string,
): NodeGraphNode {
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
      ...(targetClipId ? { targetClipId } : {}),
    },
    layout: { x: depth * NODE_SPACING_X, y: laneY },
  };
}

export function createAudioEffectInstanceNode(
  effect: AudioEffectInstance,
  depth: number,
  laneY = AUDIO_LANE_Y,
  targetClipId?: string,
): NodeGraphNode {
  const descriptor = getAudioEffect(effect.descriptorId);
  const paramCount = Object.keys(effect.params ?? {}).length;

  return {
    id: `audio-effect-${effect.id}`,
    kind: 'effect',
    runtime: 'builtin',
    label: descriptor?.name ?? effect.descriptorId,
    description: `${effect.enabled === false ? 'Disabled ' : ''}${effect.descriptorId} registry audio effect`,
    inputs: [inputPort('input', 'audio', 'audio')],
    outputs: [outputPort('output', 'audio', 'audio')],
    params: {
      enabled: effect.enabled !== false,
      params: paramCount,
      descriptorId: effect.descriptorId,
      automationMode: effect.automationMode ?? 'none',
      ...(targetClipId ? { targetClipId } : {}),
    },
    layout: { x: depth * NODE_SPACING_X, y: laneY },
  };
}

export function createCustomNode(definition: ClipCustomNodeDefinition, depth: number, laneY = MAIN_LANE_Y): NodeGraphNode {
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
      bypassed: definition.bypassed === true,
      ...(definition.params ?? {}),
    },
    layout: { x: depth * NODE_SPACING_X, y: laneY },
  };
}

export function createOutputNode(
  depth: number,
  clip: TimelineClip,
  signalType: NodeGraphSignalType,
  includeAudioInput = false,
): NodeGraphNode {
  const inputs = [
    inputPort('input', signalType, signalType),
    ...(includeAudioInput ? [inputPort('audio', 'audio', 'audio')] : []),
    inputPort('time', 'time', 'time'),
    inputPort('metadata', 'metadata', 'metadata'),
  ];

  return {
    id: 'output',
    kind: 'output',
    runtime: 'builtin',
    label: 'Clip Output',
    description: 'Final signal consumed by the timeline, preview, and export layer builders.',
    inputs,
    outputs: [outputPort('clip', 'timeline', 'timeline')],
    params: {
      duration: clip.duration,
      outPoint: clip.outPoint,
    },
    layout: { x: depth * NODE_SPACING_X, y: MAIN_LANE_Y },
  };
}

export function appendProcessingNode(
  nodes: NodeGraphNode[],
  edges: NodeGraphEdge[],
  previousNodeId: string,
  previousPortId: string,
  node: NodeGraphNode,
  signalType: NodeGraphSignalType,
): NodeGraphChainHead {
  nodes.push(node);
  edges.push(edge(previousNodeId, previousPortId, node.id, 'input', signalType));
  return { nodeId: node.id, portId: 'output' };
}

export function appendAudioProcessingNodes(
  nodes: NodeGraphNode[],
  edges: NodeGraphEdge[],
  chain: NodeGraphChainHead,
  audioClip: TimelineClip,
  depth: number,
  laneY: number,
): { chain: NodeGraphChainHead; depth: number } {
  let audioChain = chain;
  let audioDepth = depth;
  const registryAudioEffects = audioClip.audioState?.effectStack ?? [];
  const legacyAudioEffects = audioClip.effects.filter(isAudioEffect);

  for (const effect of registryAudioEffects) {
    audioChain = appendProcessingNode(
      nodes,
      edges,
      audioChain.nodeId,
      audioChain.portId,
      createAudioEffectInstanceNode(effect, audioDepth, laneY, audioClip.id),
      'audio',
    );
    audioDepth += 1;
  }

  for (const effect of legacyAudioEffects) {
    audioChain = appendProcessingNode(
      nodes,
      edges,
      audioChain.nodeId,
      audioChain.portId,
      createEffectNode(effect, audioDepth, laneY, 'audio', audioClip.id),
      'audio',
    );
    audioDepth += 1;
  }

  return { chain: audioChain, depth: audioDepth };
}

export function isMainSignalCustomNode(
  definition: ClipCustomNodeDefinition,
  primarySignal: NodeGraphSignalType,
): boolean {
  const input = definition.inputs.find((port) => port.id === 'input');
  const output = definition.outputs.find((port) => port.id === 'output');
  return input?.type === primarySignal &&
    output?.type === primarySignal &&
    !isAudioAnalysisSeededInput(input);
}

export function customNodeLaneY(definition: ClipCustomNodeDefinition): number {
  const primaryInput = definition.inputs.find((port) => port.id === 'input');
  return isAudioAnalysisSeededInput(primaryInput) ? AUDIO_ANALYSIS_LANE_Y : MAIN_LANE_Y;
}
