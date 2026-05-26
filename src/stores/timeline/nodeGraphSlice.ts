import type { NodeGraph, NodeGraphLayout, NodeGraphPort, NodeGraphSignalType, TimelineClip } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import {
  addClipCustomNodeDefinition,
  buildClipNodeGraph,
  connectClipNodeGraphPorts,
  createClipAICustomNodeDefinition,
  createClipNodeGraphState,
  disconnectClipNodeGraphEdge,
  hideClipBuiltInNode,
  reconcileClipNodeGraphState,
  removeClipCustomNodeDefinition,
  showClipBuiltInNode,
  updateClipCustomNodeDefinition,
  updateClipNodeGraphLayout,
  type ClipNodeGraphBuildOptions,
} from '../../services/nodeGraph';
import {
  createNodeGraphOwnerClip,
  resolveLinkedClipNodeGraphContext,
} from '../../services/nodeGraph/clipGraphLinking';
import type { NodeGraphActions, SliceCreator, TimelineStore } from './types';

function generateCustomNodeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const AI_SEED_AUDIO_SEMANTIC_KINDS = new Set([
  'waveform',
  'spectrum',
  'frequency-bands',
  'loudness',
  'beats',
  'onsets',
  'phase-correlation',
  'transcript',
  'frequency-summary',
  'audio-metadata',
]);

const AUDIO_REACTIVE_INPUT_IDS = new Map([
  ['waveform', 'waveform'],
  ['spectrum', 'spectrum'],
  ['frequency-bands', 'frequencyBands'],
  ['loudness', 'loudness'],
  ['beats', 'beats'],
  ['onsets', 'onsets'],
  ['phase-correlation', 'phaseCorrelation'],
  ['transcript', 'transcriptTiming'],
  ['transcript-timing', 'transcriptTiming'],
  ['frequency-summary', 'frequencySummary'],
  ['audio-metadata', 'audioMetadata'],
]);

const RESERVED_CUSTOM_NODE_INPUT_IDS = new Set(['input', 'time', 'metadata']);

function isAICustomNodeSeedPort(port: NodeGraphPort | undefined): port is NodeGraphPort {
  if (!port || port.direction !== 'output') return false;
  if (port.metadata?.generateAction?.type === 'generate-audio-analysis') return true;
  const semanticKind = typeof port.metadata?.semanticKind === 'string' ? port.metadata.semanticKind : undefined;
  return semanticKind !== undefined && AI_SEED_AUDIO_SEMANTIC_KINDS.has(semanticKind);
}

function sanitizeCustomNodeInputId(value: string): string {
  const words = value
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const id = words
    .map((word, index) => (
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1)
    ))
    .join('');
  const safeId = /^[A-Za-z_]/.test(id) ? id : `audio${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  return safeId || 'audioSignal';
}

function createAudioSidechainInputId(port: NodeGraphPort): string {
  const semanticKind = typeof port.metadata?.semanticKind === 'string' ? port.metadata.semanticKind : undefined;
  const mapped = (semanticKind ? AUDIO_REACTIVE_INPUT_IDS.get(semanticKind) : undefined)
    ?? AUDIO_REACTIVE_INPUT_IDS.get(port.id)
    ?? port.id;
  const inputId = sanitizeCustomNodeInputId(mapped);
  return RESERVED_CUSTOM_NODE_INPUT_IDS.has(inputId)
    ? `audio${inputId.charAt(0).toUpperCase()}${inputId.slice(1)}`
    : inputId;
}

function getGraphPrimarySignalType(graph: NodeGraph): NodeGraphSignalType | undefined {
  return graph.nodes
    .find((node) => node.id === 'output')
    ?.inputs.find((port) => port.id === 'input')
    ?.type;
}

function createAudioPortAIPrompt(port: NodeGraphPort): string {
  const semanticKind = typeof port.metadata?.semanticKind === 'string' ? port.metadata.semanticKind : port.label;
  const availability = port.metadata?.available === false
    ? 'The connected analysis artifact may be missing; use the graph context to request or handle generation before relying on values.'
    : 'Use the connected analysis signal and compact runtime summaries. Do not request raw audio buffers.';

  return [
    `Work with the connected ${semanticKind} audio analysis signal from the ${port.label} port.`,
    availability,
    'Return deterministic edits, parameters, markers, metadata, or visual/audio control data that preserve the original media non-destructively.',
  ].join('\n');
}

function createAudioReactiveVisualAIPrompt(port: NodeGraphPort, inputId: string): string {
  const semanticKind = typeof port.metadata?.semanticKind === 'string' ? port.metadata.semanticKind : port.label;
  const availability = port.metadata?.available === false
    ? 'The connected analysis artifact may be missing; handle absent values gracefully and explain if generation is needed.'
    : 'Use the connected analysis signal and compact runtime summaries. Do not request raw audio buffers.';

  return [
    `Create a deterministic visual texture effect driven by the connected ${semanticKind} audio analysis signal from the ${port.label} port.`,
    `The current visual texture arrives as input.input. The audio sidechain arrives as input.${inputId} and context.signals.connectedInputs.${inputId}.`,
    'Return { output } as a texture with the same width and height unless the user asks otherwise.',
    availability,
    'Keep the original media non-destructive and keep processing bounded to the provided texture and summaries.',
  ].join('\n');
}

function resolveGraphActionContext(state: TimelineStore, clipId: string): {
  selectedClip: TimelineClip;
  clip: TimelineClip;
  clipId: string;
  track: TimelineStore['tracks'][number] | undefined;
  options: ClipNodeGraphBuildOptions;
} | null {
  const context = resolveLinkedClipNodeGraphContext(state.clips, state.tracks, clipId);
  if (!context) {
    return null;
  }

  return {
    selectedClip: context.selectedClip,
    clip: createNodeGraphOwnerClip(context),
    clipId: context.ownerClip.id,
    track: context.ownerTrack ?? undefined,
    options: {
      linkedClip: context.linkedClip,
      linkedTrack: context.linkedTrack,
    },
  };
}

function setClipNodeGraph(clips: TimelineClip[], clipId: string, nodeGraph: TimelineClip['nodeGraph']): TimelineClip[] {
  return clips.map((candidate: TimelineClip) => (
    candidate.id === clipId
      ? { ...candidate, nodeGraph }
      : candidate
  ));
}

function cleanupNodeParamTimelineState(
  state: TimelineStore,
  clipId: string,
  nodeId: string,
  allowedParamIds: Set<string> | null,
) {
  return cleanupPrefixedTimelineState(state, clipId, `node.${nodeId}.`, allowedParamIds);
}

function cleanupEffectParamTimelineState(
  state: TimelineStore,
  clipId: string,
  effectId: string,
) {
  return cleanupPrefixedTimelineState(state, clipId, `effect.${effectId}.`, null);
}

function cleanupPrefixedTimelineState(
  state: TimelineStore,
  clipId: string,
  propertyPrefix: string,
  allowedParamIds: Set<string> | null,
) {
  const shouldRemoveProperty = (property: string) => {
    if (!property.startsWith(propertyPrefix)) {
      return false;
    }
    if (!allowedParamIds) {
      return true;
    }
    const propertyName = property.slice(propertyPrefix.length);
    const baseParamId = propertyName.split('.')[0];
    return !allowedParamIds.has(propertyName) && !allowedParamIds.has(baseParamId);
  };

  const existingKeyframes = state.clipKeyframes.get(clipId) ?? [];
  const removedKeyframeIds = new Set<string>();
  const retainedKeyframes = existingKeyframes.filter((keyframe) => {
    const remove = shouldRemoveProperty(keyframe.property);
    if (remove) {
      removedKeyframeIds.add(keyframe.id);
    }
    return !remove;
  });
  const clipKeyframes = retainedKeyframes.length === existingKeyframes.length
    ? state.clipKeyframes
    : new Map(state.clipKeyframes);
  if (clipKeyframes !== state.clipKeyframes) {
    if (retainedKeyframes.length > 0) {
      clipKeyframes.set(clipId, retainedKeyframes);
    } else {
      clipKeyframes.delete(clipId);
    }
  }

  let recordingChanged = false;
  const keyframeRecordingEnabled = new Set(
    [...state.keyframeRecordingEnabled].filter((key) => {
      const separatorIndex = key.indexOf(':');
      const recordingClipId = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
      const property = separatorIndex === -1 ? '' : key.slice(separatorIndex + 1);
      const keep = recordingClipId !== clipId || !shouldRemoveProperty(property);
      if (!keep) {
        recordingChanged = true;
      }
      return keep;
    }),
  );

  const selectedKeyframeIds = removedKeyframeIds.size === 0
    ? state.selectedKeyframeIds
    : new Set([...state.selectedKeyframeIds].filter((id) => !removedKeyframeIds.has(id)));

  let expandedChanged = false;
  const expandedCurveProperties = new Map(state.expandedCurveProperties);
  for (const [trackId, properties] of expandedCurveProperties) {
    const retainedProperties = new Set([...properties].filter((property) => !shouldRemoveProperty(property)));
    if (retainedProperties.size > 0) {
      if (retainedProperties.size !== properties.size) {
        expandedChanged = true;
        expandedCurveProperties.set(trackId, retainedProperties);
      }
    } else {
      expandedChanged = true;
      expandedCurveProperties.delete(trackId);
    }
  }

  return {
    ...(clipKeyframes !== state.clipKeyframes ? { clipKeyframes } : {}),
    ...(recordingChanged ? { keyframeRecordingEnabled } : {}),
    ...(selectedKeyframeIds !== state.selectedKeyframeIds ? { selectedKeyframeIds } : {}),
    ...(expandedChanged ? { expandedCurveProperties } : {}),
  };
}

export const createNodeGraphSlice: SliceCreator<NodeGraphActions> = (set, get) => ({
  ensureClipNodeGraph: (clipId) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context || context.clip.nodeGraph) return;

    const nodeGraph = createClipNodeGraphState(context.clip, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
  },

  addClipAICustomNode: (clipId) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return null;

    const nodeId = generateCustomNodeId();
    const definition = createClipAICustomNodeDefinition(nodeId, context.clip);
    const nodeGraph = addClipCustomNodeDefinition(context.clip, definition, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
    invalidateCacheAndRequestRender(get());
    return nodeId;
  },

  addClipAICustomNodeFromPort: (clipId, source) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return null;

    const graph = buildClipNodeGraph(context.clip, context.track, context.options);
    const sourceNode = graph.nodes.find((node) => node.id === source.fromNodeId);
    const sourcePort = sourceNode?.outputs.find((port) => port.id === source.fromPortId);
    if (!isAICustomNodeSeedPort(sourcePort)) {
      return null;
    }

    const nodeId = generateCustomNodeId();
    const nodeLabel = source.label?.trim() || `${sourcePort.label} AI`;
    const primarySignalType = getGraphPrimarySignalType(graph);
    const createVisualReactiveNode = primarySignalType === 'texture';
    const sidechainInputId = createVisualReactiveNode
      ? createAudioSidechainInputId(sourcePort)
      : 'input';
    const definition = createVisualReactiveNode
      ? createClipAICustomNodeDefinition(nodeId, context.clip, nodeLabel, {
          primaryInput: {
            id: 'input',
            label: 'texture',
            type: 'texture',
          },
          additionalInputs: [{
            id: sidechainInputId,
            label: sourcePort.label,
            type: sourcePort.type,
            metadata: sourcePort.metadata ? { ...sourcePort.metadata } : undefined,
          }],
          outputType: 'texture',
          description: `AI-authored visual node driven by the ${sourcePort.label} audio analysis signal.`,
          prompt: createAudioReactiveVisualAIPrompt(sourcePort, sidechainInputId),
        })
      : createClipAICustomNodeDefinition(nodeId, context.clip, nodeLabel, {
          primaryInput: {
            id: 'input',
            label: sourcePort.label,
            type: sourcePort.type,
            metadata: sourcePort.metadata ? { ...sourcePort.metadata } : undefined,
          },
          outputType: sourcePort.type,
          description: `AI-authored node seeded from the ${sourcePort.label} audio analysis signal.`,
          prompt: createAudioPortAIPrompt(sourcePort),
        });
    const withNodeGraph = addClipCustomNodeDefinition(context.clip, definition, context.track, context.options);
    const connectedNodeGraph = connectClipNodeGraphPorts(
      { ...context.clip, nodeGraph: withNodeGraph },
      {
        fromNodeId: source.fromNodeId,
        fromPortId: source.fromPortId,
        toNodeId: nodeId,
        toPortId: sidechainInputId,
      },
      context.track,
      context.options,
    );

    set({
      clips: setClipNodeGraph(clips, context.clipId, connectedNodeGraph),
    });
    invalidateCacheAndRequestRender(get());
    return nodeId;
  },

  updateClipAICustomNode: (clipId, nodeId, updates) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    const clearsGeneratedCode = Object.prototype.hasOwnProperty.call(updates.ai ?? {}, 'generatedCode') &&
      updates.ai?.generatedCode === '';
    const normalizedUpdates = clearsGeneratedCode
      ? {
          ...updates,
          status: 'draft' as const,
          params: {},
          parameterSchema: [],
          ai: {
            ...updates.ai,
            generatedCode: '',
          },
        }
      : updates;
    const schemaChanged = clearsGeneratedCode || Object.prototype.hasOwnProperty.call(updates, 'parameterSchema');
    const cleanup = schemaChanged
      ? cleanupNodeParamTimelineState(
          state,
          context.clipId,
          nodeId,
          new Set((normalizedUpdates.parameterSchema ?? []).map((param) => param.id)),
        )
      : {};

    const nodeGraph = updateClipCustomNodeDefinition(
      context.clip,
      nodeId,
      normalizedUpdates,
      context.track,
      context.options,
    );
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
      ...cleanup,
    });
    invalidateCacheAndRequestRender(get());
  },

  removeClipNodeGraphNode: (clipId, nodeId) => {
    const state = get();
    const { clips, tracks } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    let nextClip: TimelineClip | null = null;
    let nextClipId = context.clipId;
    let cleanup: Partial<TimelineStore> = {};

    if (nodeId.startsWith('effect-')) {
      const effectId = nodeId.slice('effect-'.length);
      const effectOwner = context.clip.effects.some((effect) => effect.id === effectId)
        ? context.clip
        : context.options.linkedClip?.effects.some((effect) => effect.id === effectId)
          ? context.options.linkedClip
          : null;
      if (!effectOwner) {
        return;
      }

      const effectTrack = tracks.find((candidate) => candidate.id === effectOwner.trackId);
      const effects = effectOwner.effects.filter((effect) => effect.id !== effectId);
      const clipWithoutEffect = { ...effectOwner, effects };
      nextClip = {
        ...clipWithoutEffect,
        nodeGraph: effectOwner.id === context.clipId
          ? reconcileClipNodeGraphState(clipWithoutEffect, context.track, context.clip.nodeGraph, context.options)
          : effectOwner.nodeGraph,
      };
      nextClipId = effectOwner.id;
      cleanup = cleanupEffectParamTimelineState(state, effectOwner.id, effectId);
      if (effectTrack && effectOwner.id !== context.clipId) {
        const ownerGraph = reconcileClipNodeGraphState(
          context.clip,
          context.track,
          context.clip.nodeGraph,
          {
            ...context.options,
            linkedClip: nextClip,
            linkedTrack: effectTrack,
          },
        );
        set({
          clips: clips.map((candidate: TimelineClip) => {
            if (candidate.id === effectOwner.id) return nextClip as TimelineClip;
            if (candidate.id === context.clipId) return { ...context.clip, nodeGraph: ownerGraph };
            return candidate;
          }),
          ...cleanup,
        });
        invalidateCacheAndRequestRender(get());
        return;
      }
    } else if (context.clip.nodeGraph?.customNodes?.some((definition) => definition.id === nodeId)) {
      nextClip = {
        ...context.clip,
        nodeGraph: removeClipCustomNodeDefinition(context.clip, nodeId, context.track, context.options),
      };
      cleanup = cleanupNodeParamTimelineState(state, context.clipId, nodeId, null);
    } else if (nodeId === 'transform' || nodeId === 'mask' || nodeId === 'color') {
      const nodeGraph = hideClipBuiltInNode(context.clip, nodeId, context.track, context.options);
      if (nodeGraph === context.clip.nodeGraph) {
        return;
      }
      nextClip = { ...context.clip, nodeGraph };
    }

    if (!nextClip) {
      return;
    }

    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === nextClipId ? nextClip : candidate
      )),
      ...cleanup,
    });
    invalidateCacheAndRequestRender(get());
  },

  showClipNodeGraphBuiltIn: (clipId, node) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    const nodeGraph = showClipBuiltInNode(context.clip, node, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
    invalidateCacheAndRequestRender(get());
  },

  connectClipNodeGraphPorts: (clipId, connection) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    const nodeGraph = connectClipNodeGraphPorts(context.clip, connection, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
    invalidateCacheAndRequestRender(get());
  },

  disconnectClipNodeGraphEdge: (clipId, edgeId) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    const nodeGraph = disconnectClipNodeGraphEdge(context.clip, edgeId, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
    invalidateCacheAndRequestRender(get());
  },

  moveClipNodeGraphNode: (clipId, nodeId, layout: NodeGraphLayout) => {
    const state = get();
    const { clips } = state;
    const context = resolveGraphActionContext(state, clipId);
    if (!context) return;

    const nodeGraph = updateClipNodeGraphLayout(context.clip, nodeId, layout, context.track, context.options);
    set({
      clips: setClipNodeGraph(clips, context.clipId, nodeGraph),
    });
  },
});

function invalidateCacheAndRequestRender(state: TimelineStore): void {
  state.invalidateCache();
  engine.requestRender();
}
