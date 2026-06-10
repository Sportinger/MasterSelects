import type { LayerSource } from "../../types/layers";
import type { TextClipProperties } from "../../types/text";
import type { TimelineClip } from "../../types/timeline";
import { createTextLayoutSnapshot, type TextBoxRect, type TextLayoutSnapshot } from '../textLayout';
import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import type { AINodeRuntimeAudioContext } from './aiNodeRuntimeAudioContext';
import type { AINodeRuntimeAudioArtifactSignal } from './aiNodeRuntimeAudioArtifactSignals';
import type { ClipCustomNodeParamValue, NodeGraph, NodeGraphPort } from './types';

interface AINodeRuntimeTime {
  currentTime: number;
  clipLocalTime: number;
  seconds: number;
  mediaTime?: number;
  valueOf: () => number;
  toString: () => string;
}

export type AINodeRuntimeTextSignal = TextClipProperties & {
  content: string;
  layout?: TextLayoutSnapshot;
  contentBounds?: TextBoxRect;
  box?: TextBoxRect;
};

export type AINodeRuntimeInputValue =
  | AINodeRuntimeTexture
  | AINodeRuntimeTime
  | AINodeRuntimeTextSignal
  | AINodeRuntimeAudioContext
  | string
  | number
  | boolean
  | readonly unknown[]
  | object
  | Record<string, unknown>
  | undefined;

export interface AINodeRuntimeContext {
  clipId: string;
  clipLocalTime: number;
  mediaTime?: number;
  metadata: Record<string, unknown>;
  params: Record<string, ClipCustomNodeParamValue>;
  clip: Record<string, unknown>;
  source: Record<string, unknown>;
  graph: Record<string, unknown>;
  node: Record<string, unknown>;
  signals: Record<string, AINodeRuntimeInputValue>;
  audio?: AINodeRuntimeAudioContext;
  text?: AINodeRuntimeTextSignal;
}

export function createRuntimeTime(context: AINodeRuntimeContext): AINodeRuntimeTime {
  return {
    currentTime: context.clipLocalTime,
    clipLocalTime: context.clipLocalTime,
    seconds: context.clipLocalTime,
    mediaTime: context.mediaTime,
    valueOf: () => context.clipLocalTime,
    toString: () => String(context.clipLocalTime),
  };
}

function findAudioArtifactSignal(
  signals: readonly AINodeRuntimeAudioArtifactSignal[],
  port: NodeGraphPort | undefined,
): AINodeRuntimeAudioArtifactSignal | undefined {
  const artifactId = port?.metadata?.artifactId ?? port?.metadata?.signalRefId;
  if (artifactId) {
    const byArtifact = signals.find((signal) => signal.artifactId === artifactId);
    if (byArtifact) {
      return byArtifact;
    }
  }

  const artifactIndex = port?.metadata?.artifactIndex;
  if (typeof artifactIndex === 'number') {
    return signals[artifactIndex];
  }

  return signals[0];
}

function resolveSourcePortRuntimeSignal(
  port: NodeGraphPort | undefined,
  baseSignals: Record<string, AINodeRuntimeInputValue>,
  audioSignal?: AINodeRuntimeAudioContext,
): AINodeRuntimeInputValue {
  if (!port) {
    return undefined;
  }

  if (port.id in baseSignals) {
    return baseSignals[port.id];
  }

  const analysis = audioSignal?.analysis.effective;
  switch (port.metadata?.semanticKind) {
    case 'audio-source':
      return audioSignal;
    case 'waveform':
      return analysis?.waveform;
    case 'spectrum':
      return findAudioArtifactSignal(analysis?.spectrogramTileSets ?? [], port);
    case 'loudness':
      return analysis?.loudness;
    case 'beats':
      return analysis?.beats;
    case 'onsets':
      return analysis?.onsets;
    case 'phase-correlation':
      return analysis?.phaseCorrelation;
    case 'transcript':
      return analysis?.transcriptTiming;
    case 'frequency-bands':
    case 'frequency-summary':
      return analysis?.frequencyBands;
    case 'audio-metadata':
      return audioSignal?.metadata;
    default:
      return undefined;
  }
}

export function createConnectedNodeInputs(
  graph: NodeGraph,
  nodeId: string,
  baseSignals: Record<string, AINodeRuntimeInputValue>,
  audioSignal?: AINodeRuntimeAudioContext,
): Record<string, AINodeRuntimeInputValue> {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectedInputs: Record<string, AINodeRuntimeInputValue> = {};

  for (const edgeToNode of graph.edges) {
    if (edgeToNode.toNodeId !== nodeId) {
      continue;
    }

    if (edgeToNode.toPortId === 'input' && edgeToNode.type === 'texture') {
      continue;
    }

    const fromNode = nodesById.get(edgeToNode.fromNodeId);
    const fromPort = fromNode?.outputs.find((port) => port.id === edgeToNode.fromPortId);
    const value = edgeToNode.fromNodeId === 'source'
      ? resolveSourcePortRuntimeSignal(fromPort, baseSignals, audioSignal)
      : undefined;

    if (value !== undefined) {
      connectedInputs[edgeToNode.toPortId] = value;
    }
  }

  return connectedInputs;
}

export function createSerializableGraph(graph: NodeGraph): Record<string, unknown> {
  return {
    id: graph.id,
    owner: graph.owner,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      runtime: node.runtime,
      label: node.label,
      inputs: node.inputs,
      outputs: node.outputs,
      params: node.params,
    })),
    edges: graph.edges,
  };
}

export function createRuntimeClipMetadata(clip: TimelineClip): Record<string, unknown> {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: clip.source?.type,
    trackId: clip.trackId,
  };
}

export function createRuntimeSourceMetadata(source: LayerSource): Record<string, unknown> {
  return {
    type: source.type,
    mediaTime: source.mediaTime,
    targetMediaTime: source.targetMediaTime,
    intrinsicWidth: source.intrinsicWidth,
    intrinsicHeight: source.intrinsicHeight,
    previewPath: source.previewPath,
  };
}

function createTextMeasureContext(): Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.createElement('canvas').getContext('2d');
}

export function createRuntimeTextSignal(
  text?: TextClipProperties,
  dimensions?: { width: number; height: number },
): AINodeRuntimeTextSignal | undefined {
  if (!text) {
    return undefined;
  }

  const measureContext = createTextMeasureContext();
  const layout = measureContext && dimensions
    ? createTextLayoutSnapshot(measureContext, text, dimensions.width, dimensions.height)
    : undefined;

  return {
    ...text,
    content: text.text,
    layout,
    contentBounds: layout?.contentBounds,
    box: layout?.box,
  };
}

export function createRuntimeMetadata(
  clip: TimelineClip,
  source: LayerSource,
  text?: TextClipProperties,
  dimensions?: { width: number; height: number },
  audio?: AINodeRuntimeAudioContext,
): Record<string, unknown> {
  return {
    clipName: clip.name,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: clip.source?.type,
    source: createRuntimeSourceMetadata(source),
    clip: createRuntimeClipMetadata(clip),
    audio,
    text: createRuntimeTextSignal(text, dimensions),
  };
}
