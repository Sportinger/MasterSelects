import type { AudioEffectInstance, Effect, TimelineClip, TimelineTrack } from '../../types';
import type { AudioAnalysisArtifactKind, MediaFileAudioAnalysisRefs } from '../../types/audio';
import { getAudioEffect, hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type {
  ClipNodeGraph,
  ClipNodeGraphBacking,
  ClipCustomNodeDefinition,
  ClipCustomNodeAIAuthoring,
  ClipNodeGraphForcedBuiltIn,
  ClipNodeGraphNodeState,
  NodeGraph,
  NodeGraphConnectionRequest,
  NodeGraphEdge,
  NodeGraphLayout,
  NodeGraphNode,
  NodeGraphPort,
  NodeGraphPortMetadata,
  NodeGraphSignalType,
} from './types';
import { extractAINodeGeneratedCode } from './aiNodeDefinition';

const NODE_SPACING_X = 230;
const MAIN_LANE_Y = 88;
const AUDIO_LANE_Y = 252;
const AUDIO_ANALYSIS_LANE_Y = 416;
const MAX_PROJECTED_SPECTRUM_PORTS = 16;

export interface ClipNodeGraphBuildOptions {
  linkedClip?: TimelineClip | null;
  linkedTrack?: TimelineTrack | null;
}

interface NodeGraphChainHead {
  nodeId: string;
  portId: string;
}

function outputPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  metadata?: NodeGraphPortMetadata,
): NodeGraphPort {
  return { id, label, type, direction: 'output', ...(metadata ? { metadata } : {}) };
}

function inputPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  metadata?: NodeGraphPortMetadata,
): NodeGraphPort {
  return { id, label, type, direction: 'input', ...(metadata ? { metadata } : {}) };
}

function clonePort(port: NodeGraphPort): NodeGraphPort {
  return { ...port, ...(port.metadata ? { metadata: { ...port.metadata } } : {}) };
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

function cloneEdge(candidate: NodeGraphEdge): NodeGraphEdge {
  return { ...candidate };
}

function cloneManualEdges(edges?: NodeGraphEdge[]): NodeGraphEdge[] | undefined {
  if (edges === undefined) {
    return undefined;
  }
  return edges.map(cloneEdge);
}

function getNodePort(
  node: NodeGraphNode | undefined,
  portId: string,
  direction: 'input' | 'output',
): NodeGraphPort | undefined {
  if (!node) return undefined;
  const ports = direction === 'input' ? node.inputs : node.outputs;
  return ports.find((port) => port.id === portId);
}

function createValidatedManualEdge(
  graph: Pick<NodeGraph, 'nodes'>,
  connection: NodeGraphConnectionRequest,
): NodeGraphEdge | null {
  if (connection.fromNodeId === connection.toNodeId) {
    return null;
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const fromNode = nodesById.get(connection.fromNodeId);
  const toNode = nodesById.get(connection.toNodeId);
  const fromPort = getNodePort(fromNode, connection.fromPortId, 'output');
  const toPort = getNodePort(toNode, connection.toPortId, 'input');

  if (!fromPort || !toPort || fromPort.type !== toPort.type) {
    return null;
  }

  return edge(connection.fromNodeId, connection.fromPortId, connection.toNodeId, connection.toPortId, fromPort.type);
}

function validateManualEdges(graph: Pick<NodeGraph, 'nodes'>, manualEdges: NodeGraphEdge[]): NodeGraphEdge[] {
  const nextEdges: NodeGraphEdge[] = [];
  const connectedInputs = new Set<string>();
  const edgeIds = new Set<string>();

  for (const candidate of manualEdges) {
    const nextEdge = createValidatedManualEdge(graph, candidate);
    if (!nextEdge || edgeIds.has(nextEdge.id)) {
      continue;
    }

    const inputKey = `${nextEdge.toNodeId}:${nextEdge.toPortId}`;
    if (connectedInputs.has(inputKey)) {
      continue;
    }

    connectedInputs.add(inputKey);
    edgeIds.add(nextEdge.id);
    nextEdges.push(nextEdge);
  }

  return nextEdges;
}

function isVisualSource(clip: TimelineClip): boolean {
  return clip.source?.type !== 'audio';
}

function isAudioSourceClip(clip: TimelineClip | undefined | null): clip is TimelineClip {
  return !!clip && (
    clip.source?.type === 'audio' ||
    clip.source?.type === 'video' ||
    clip.file?.type?.startsWith('audio/') === true ||
    (clip.waveform?.length ?? 0) > 0 ||
    hasAnyAudioAnalysisRef(clip.audioState?.sourceAnalysisRefs) ||
    hasAnyAudioAnalysisRef(clip.audioState?.processedAnalysisRefs)
  );
}

function resolveLinkedAudioClip(clip: TimelineClip, linkedClip?: TimelineClip | null): TimelineClip | undefined {
  if (linkedClip?.source?.type === 'audio') {
    return linkedClip;
  }
  if (clip.source?.type === 'audio') {
    return clip;
  }
  if (isAudioSourceClip(clip)) {
    return clip;
  }
  return isAudioSourceClip(linkedClip) ? linkedClip : undefined;
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

function hasForcedBuiltInNode(clip: TimelineClip, node: ClipNodeGraphForcedBuiltIn): boolean {
  return clip.nodeGraph?.forcedBuiltIns?.includes(node) ?? false;
}

function isAudioEffect(effect: Effect): boolean {
  return hasAudioEffect(effect.type);
}

function hasAudioAnalysisSurface(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio' ||
    clip.source?.type === 'video' ||
    clip.file?.type?.startsWith('audio/') === true ||
    (clip.waveform?.length ?? 0) > 0 ||
    hasAnyAudioAnalysisRef(clip.audioState?.sourceAnalysisRefs) ||
    hasAnyAudioAnalysisRef(clip.audioState?.processedAnalysisRefs);
}

interface ResolvedAudioAnalysisRef {
  artifactId: string;
  artifactKind: AudioAnalysisArtifactKind;
  provenance: 'source' | 'processed';
  index?: number;
}

function hasAnyAudioAnalysisRef(refs: MediaFileAudioAnalysisRefs | undefined): boolean {
  return Boolean(
    refs?.waveformPyramidId ||
    refs?.processedWaveformPyramidId ||
    refs?.spectrogramTileSetIds?.length ||
    refs?.loudnessEnvelopeId ||
    refs?.beatGridId ||
    refs?.onsetMapId ||
    refs?.phaseCorrelationId ||
    refs?.transcriptTimingId ||
    refs?.frequencySummaryId,
  );
}

function firstResolvedRef(
  processedRef: ResolvedAudioAnalysisRef | undefined,
  sourceRef: ResolvedAudioAnalysisRef | undefined,
): ResolvedAudioAnalysisRef | undefined {
  return processedRef ?? sourceRef;
}

function resolveAudioRef(
  provenance: 'source' | 'processed',
  artifactId: string | undefined,
  artifactKind: AudioAnalysisArtifactKind,
  index?: number,
): ResolvedAudioAnalysisRef | undefined {
  if (!artifactId) {
    return undefined;
  }

  return { artifactId, artifactKind, provenance, ...(index !== undefined ? { index } : {}) };
}

function resolveAudioRefs(clip: TimelineClip): {
  waveform?: ResolvedAudioAnalysisRef;
  spectrum: ResolvedAudioAnalysisRef[];
  loudness?: ResolvedAudioAnalysisRef;
  beats?: ResolvedAudioAnalysisRef;
  onsets?: ResolvedAudioAnalysisRef;
  phaseCorrelation?: ResolvedAudioAnalysisRef;
  transcriptTiming?: ResolvedAudioAnalysisRef;
  frequencySummary?: ResolvedAudioAnalysisRef;
} {
  const source = clip.audioState?.sourceAnalysisRefs;
  const processed = clip.audioState?.processedAnalysisRefs;
  const processedSpectrum = (processed?.spectrogramTileSetIds ?? [])
    .slice(0, MAX_PROJECTED_SPECTRUM_PORTS)
    .map((artifactId, index) => resolveAudioRef('processed', artifactId, 'spectrogram-tiles', index))
    .filter((ref): ref is ResolvedAudioAnalysisRef => Boolean(ref));
  const sourceSpectrum = (source?.spectrogramTileSetIds ?? [])
    .slice(0, MAX_PROJECTED_SPECTRUM_PORTS)
    .map((artifactId, index) => resolveAudioRef('source', artifactId, 'spectrogram-tiles', index))
    .filter((ref): ref is ResolvedAudioAnalysisRef => Boolean(ref));

  return {
    waveform: firstResolvedRef(
      resolveAudioRef('processed', processed?.processedWaveformPyramidId, 'processed-waveform-pyramid') ??
        resolveAudioRef('processed', processed?.waveformPyramidId, 'waveform-pyramid'),
      resolveAudioRef('source', source?.waveformPyramidId, 'waveform-pyramid'),
    ),
    spectrum: processedSpectrum.length > 0 ? processedSpectrum : sourceSpectrum,
    loudness: firstResolvedRef(
      resolveAudioRef('processed', processed?.loudnessEnvelopeId, 'loudness-envelope'),
      resolveAudioRef('source', source?.loudnessEnvelopeId, 'loudness-envelope'),
    ),
    beats: firstResolvedRef(
      resolveAudioRef('processed', processed?.beatGridId, 'beat-grid'),
      resolveAudioRef('source', source?.beatGridId, 'beat-grid'),
    ),
    onsets: firstResolvedRef(
      resolveAudioRef('processed', processed?.onsetMapId, 'onset-map'),
      resolveAudioRef('source', source?.onsetMapId, 'onset-map'),
    ),
    phaseCorrelation: firstResolvedRef(
      resolveAudioRef('processed', processed?.phaseCorrelationId, 'phase-correlation'),
      resolveAudioRef('source', source?.phaseCorrelationId, 'phase-correlation'),
    ),
    transcriptTiming: firstResolvedRef(
      resolveAudioRef('processed', processed?.transcriptTimingId, 'transcript-timing'),
      resolveAudioRef('source', source?.transcriptTimingId, 'transcript-timing'),
    ),
    frequencySummary: firstResolvedRef(
      resolveAudioRef('processed', processed?.frequencySummaryId, 'frequency-summary'),
      resolveAudioRef('source', source?.frequencySummaryId, 'frequency-summary'),
    ),
  };
}

function audioArtifactPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  semanticKind: NonNullable<NodeGraphPortMetadata['semanticKind']>,
  ref: ResolvedAudioAnalysisRef | undefined,
  artifactKind: AudioAnalysisArtifactKind,
  targetClipId: string,
): NodeGraphPort {
  return outputPort(id, label, type, {
    semanticKind,
    targetClipId,
    signalRefId: ref?.artifactId,
    artifactId: ref?.artifactId,
    artifactProvenance: ref?.provenance,
    artifactIndex: ref?.index,
    available: Boolean(ref?.artifactId),
    stale: false,
    previewable: true,
    generateAction: {
      type: 'generate-audio-analysis',
      artifactKind,
      label,
    },
  });
}

function audioMetadataPort(clip: TimelineClip): NodeGraphPort {
  const signalRefId = clip.audioState?.sourceAudioRevisionId ?? clip.mediaFileId ?? clip.source?.mediaFileId;
  return outputPort('audio-metadata', 'audio metadata', 'metadata', {
    semanticKind: 'audio-metadata',
    targetClipId: clip.id,
    signalRefId,
    available: true,
    stale: false,
    previewable: false,
  });
}

function appendAudioAnalysisPorts(outputs: NodeGraphPort[], clip: TimelineClip): void {
  const refs = resolveAudioRefs(clip);
  const targetClipId = clip.id;

  outputs.push(audioArtifactPort(
    'waveform',
    'waveform',
    'curve',
    'waveform',
    refs.waveform,
    refs.waveform?.artifactKind ?? 'waveform-pyramid',
    targetClipId,
  ));
  refs.spectrum.forEach((ref, index) => {
    outputs.push(audioArtifactPort(
      index === 0 ? 'spectrum' : `spectrum-${index + 1}`,
      index === 0 ? 'spectrum' : `spectrum ${index + 1}`,
      'texture',
      'spectrum',
      ref,
      'spectrogram-tiles',
      targetClipId,
    ));
  });
  if (refs.spectrum.length === 0) {
    outputs.push(audioArtifactPort('spectrum', 'spectrum', 'texture', 'spectrum', undefined, 'spectrogram-tiles', targetClipId));
  }
  outputs.push(audioArtifactPort('loudness', 'loudness', 'curve', 'loudness', refs.loudness, 'loudness-envelope', targetClipId));
  outputs.push(audioArtifactPort('beats', 'beats', 'event', 'beats', refs.beats, 'beat-grid', targetClipId));
  outputs.push(audioArtifactPort('onsets', 'onsets', 'event', 'onsets', refs.onsets, 'onset-map', targetClipId));
  outputs.push(audioArtifactPort('phase-correlation', 'phase correlation', 'curve', 'phase-correlation', refs.phaseCorrelation, 'phase-correlation', targetClipId));
  outputs.push(audioArtifactPort('transcript-timing', 'transcript timing', 'text', 'transcript', refs.transcriptTiming, 'transcript-timing', targetClipId));
  outputs.push(audioArtifactPort('frequency-bands', 'frequency bands', 'table', 'frequency-bands', refs.frequencySummary, 'frequency-summary', targetClipId));
  outputs.push(audioArtifactPort('frequency-summary', 'frequency summary', 'table', 'frequency-summary', refs.frequencySummary, 'frequency-summary', targetClipId));
  outputs.push(audioMetadataPort(clip));
}

function summarizeAudioAnalysisOutputs(outputs: readonly NodeGraphPort[]): Record<string, string | number | boolean> {
  const artifactPorts = outputs.filter(port => port.metadata?.generateAction?.type === 'generate-audio-analysis');
  const total = artifactPorts.length;
  const available = artifactPorts.filter(port => port.metadata?.available === true).length;
  const stale = artifactPorts.filter(port => port.metadata?.stale === true).length;
  const processed = artifactPorts.filter(port => port.metadata?.artifactProvenance === 'processed').length;
  const source = artifactPorts.filter(port => port.metadata?.artifactProvenance === 'source').length;
  const missing = Math.max(0, total - available);

  return {
    status: total === 0 || available === 0 ? 'empty' : missing > 0 || stale > 0 ? 'partial' : 'ready',
    artifactPorts: total,
    availableArtifacts: available,
    missingArtifacts: missing,
    staleArtifacts: stale,
    processedArtifacts: processed,
    sourceArtifacts: source,
    progressPercent: total > 0 ? Math.round((available / total) * 100) : 0,
  };
}

function createSourceNode(
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

function createEffectNode(
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

function createAudioEffectInstanceNode(
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

function createCustomNode(definition: ClipCustomNodeDefinition, depth: number, laneY = MAIN_LANE_Y): NodeGraphNode {
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

function createOutputNode(
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

function appendProcessingNode(
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

function appendAudioProcessingNodes(
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

function isAudioAnalysisSemanticKind(kind: string | undefined): boolean {
  return kind === 'waveform' ||
    kind === 'spectrum' ||
    kind === 'frequency-bands' ||
    kind === 'loudness' ||
    kind === 'beats' ||
    kind === 'onsets' ||
    kind === 'phase-correlation' ||
    kind === 'transcript' ||
    kind === 'frequency-summary' ||
    kind === 'audio-metadata';
}

function isAudioAnalysisSeededInput(port: NodeGraphPort | undefined): boolean {
  if (!port?.metadata) return false;
  return port.metadata.generateAction?.type === 'generate-audio-analysis' ||
    isAudioAnalysisSemanticKind(typeof port.metadata.semanticKind === 'string' ? port.metadata.semanticKind : undefined);
}

function isMainSignalCustomNode(definition: ClipCustomNodeDefinition, primarySignal: NodeGraphSignalType): boolean {
  const input = definition.inputs.find((port) => port.id === 'input');
  const output = definition.outputs.find((port) => port.id === 'output');
  return input?.type === primarySignal &&
    output?.type === primarySignal &&
    !isAudioAnalysisSeededInput(input);
}

function customNodeLaneY(definition: ClipCustomNodeDefinition): number {
  const primaryInput = definition.inputs.find((port) => port.id === 'input');
  return isAudioAnalysisSeededInput(primaryInput) ? AUDIO_ANALYSIS_LANE_Y : MAIN_LANE_Y;
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

function cloneLayout(layout: NodeGraphLayout): NodeGraphLayout {
  return { x: layout.x, y: layout.y };
}

function cloneCustomNodeDefinition(definition: ClipCustomNodeDefinition): ClipCustomNodeDefinition {
  return {
    ...definition,
    inputs: definition.inputs.map(clonePort),
    outputs: definition.outputs.map(clonePort),
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
  const graph = buildClipNodeGraph({ ...clip, nodeGraph: state }, track, options);
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
  const graph = buildClipNodeGraph({ ...clip, nodeGraph: state }, track, options);
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

interface CreateClipAICustomNodeOptions {
  primaryInput?: Pick<NodeGraphPort, 'id' | 'label' | 'type' | 'metadata'>;
  additionalInputs?: Pick<NodeGraphPort, 'id' | 'label' | 'type' | 'metadata'>[];
  outputType?: NodeGraphSignalType;
  description?: string;
  prompt?: string;
}

export function createClipAICustomNodeDefinition(
  id: string,
  clip: TimelineClip,
  label = 'AI Node',
  options: CreateClipAICustomNodeOptions = {},
): ClipCustomNodeDefinition {
  const signalType = sourceOutputType(clip);
  const primaryInput = options.primaryInput ?? {
    id: 'input',
    label: signalType,
    type: signalType,
  };
  const outputType = options.outputType ?? primaryInput.type;
  return {
    id,
    label,
    ...(options.description ? { description: options.description } : {}),
    runtime: 'typescript',
    status: 'draft',
    inputs: [
      inputPort(
        primaryInput.id,
        primaryInput.label,
        primaryInput.type,
        primaryInput.metadata ? { ...primaryInput.metadata } : undefined,
      ),
      ...(options.additionalInputs ?? []).map((port) => inputPort(
        port.id,
        port.label,
        port.type,
        port.metadata ? { ...port.metadata } : undefined,
      )),
      inputPort('time', 'time', 'time'),
      inputPort('metadata', 'metadata', 'metadata'),
    ],
    outputs: [outputPort('output', outputType, outputType)],
    params: {},
    ai: {
      prompt: options.prompt ?? '',
      updatedAt: Date.now(),
    },
  };
}

export function addClipCustomNodeDefinition(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const customNodes = [
    ...(baseState.customNodes ?? []),
    cloneCustomNodeDefinition(definition),
  ];
  const nextState: ClipNodeGraph = {
    ...baseState,
    customNodes,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState, options);
}

export function removeClipCustomNodeDefinition(
  clip: TimelineClip,
  nodeId: string,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const customNodes = (baseState.customNodes ?? []).filter((definition) => definition.id !== nodeId);

  if (customNodes.length === (baseState.customNodes ?? []).length) {
    return baseState;
  }

  const manualEdges = baseState.manualEdges?.filter((edgeToKeep) => (
    edgeToKeep.fromNodeId !== nodeId &&
    edgeToKeep.toNodeId !== nodeId
  ));
  const nextState: ClipNodeGraph = {
    ...baseState,
    customNodes: customNodes.length > 0 ? customNodes : undefined,
    manualEdges: manualEdges && manualEdges.length > 0 ? manualEdges : undefined,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState, options);
}

export function showClipBuiltInNode(
  clip: TimelineClip,
  node: ClipNodeGraphForcedBuiltIn,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const forcedBuiltIns = Array.from(new Set([...(baseState.forcedBuiltIns ?? []), node]));
  const nextState: ClipNodeGraph = {
    ...baseState,
    forcedBuiltIns,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState, options);
}

export function hideClipBuiltInNode(
  clip: TimelineClip,
  node: ClipNodeGraphForcedBuiltIn,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
  const forcedBuiltIns = (baseState.forcedBuiltIns ?? []).filter((candidate) => candidate !== node);
  const nextState: ClipNodeGraph = {
    ...baseState,
    forcedBuiltIns: forcedBuiltIns.length > 0 ? forcedBuiltIns : undefined,
    updatedAt: Date.now(),
  };

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState, options);
}

export function updateClipCustomNodeDefinition(
  clip: TimelineClip,
  nodeId: string,
  updates: Partial<Omit<ClipCustomNodeDefinition, 'id' | 'inputs' | 'outputs' | 'ai'>> & {
    ai?: Partial<ClipCustomNodeDefinition['ai']>;
  },
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): ClipNodeGraph {
  const baseState = reconcileClipNodeGraphState(clip, track, clip.nodeGraph, options);
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

  return reconcileClipNodeGraphState({ ...clip, nodeGraph: nextState }, track, nextState, options);
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

function buildClipNodeGraphView(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraph {
  const nodes: NodeGraphNode[] = [];
  const edges: NodeGraphEdge[] = [];
  const sourceNode = createSourceNode(clip, track, options);
  nodes.push(sourceNode);

  const primarySignal = sourceOutputType(clip);
  const audioClip = resolveLinkedAudioClip(clip, options.linkedClip);
  const hasAudioOutput = Boolean(audioClip);
  let depth = 1;
  let chain: NodeGraphChainHead = { nodeId: sourceNode.id, portId: primarySignal };

  if (isVisualSource(clip) && (!transformIsDefault(clip) || hasForcedBuiltInNode(clip, 'transform'))) {
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

  if (isVisualSource(clip) && (hasActiveMasks(clip) || hasForcedBuiltInNode(clip, 'mask'))) {
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

  if (isVisualSource(clip) && (hasColorGraph(clip) || hasForcedBuiltInNode(clip, 'color'))) {
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

  if (primarySignal === 'audio' && audioClip) {
    const audioResult = appendAudioProcessingNodes(nodes, edges, chain, audioClip, depth, MAIN_LANE_Y);
    chain = audioResult.chain;
    depth = audioResult.depth;
  }

  const standaloneCustomNodes: ClipCustomNodeDefinition[] = [];
  for (const customNode of clip.nodeGraph?.customNodes ?? []) {
    if (!isMainSignalCustomNode(customNode, primarySignal)) {
      standaloneCustomNodes.push(customNode);
      continue;
    }

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

  const outputNode = createOutputNode(depth, clip, primarySignal, hasAudioOutput && primarySignal !== 'audio');
  nodes.push(outputNode);
  edges.push(edge(chain.nodeId, chain.portId, outputNode.id, 'input', primarySignal));
  edges.push(edge(sourceNode.id, 'time', outputNode.id, 'time', 'time'));
  edges.push(edge(sourceNode.id, 'metadata', outputNode.id, 'metadata', 'metadata'));

  standaloneCustomNodes.forEach((customNode, index) => {
    nodes.push(createCustomNode(customNode, depth + index + 1, customNodeLaneY(customNode)));
  });

  if (audioClip && primarySignal !== 'audio') {
    const audioResult = appendAudioProcessingNodes(
      nodes,
      edges,
      { nodeId: sourceNode.id, portId: 'audio' },
      audioClip,
      1,
      AUDIO_LANE_Y,
    );
    edges.push(edge(audioResult.chain.nodeId, audioResult.chain.portId, outputNode.id, 'audio', 'audio'));
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

export function buildClipNodeGraph(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraph {
  return applyClipNodeGraphState(buildClipNodeGraphView(clip, track, options), clip.nodeGraph);
}
