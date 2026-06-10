import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import { inputPort, outputPort } from './clipGraphProjectionGraph';
import { sourceOutputType } from './clipGraphProjectionNodeFactory';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import {
  cloneCustomNodeDefinition,
  reconcileClipNodeGraphState,
} from './clipGraphProjectionState';
import type {
  ClipCustomNodeDefinition,
  ClipNodeGraph,
  ClipNodeGraphForcedBuiltIn,
  NodeGraphPort,
  NodeGraphSignalType,
} from './types';

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
