import type { NodeGraphLayout, TimelineClip } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import {
  addClipCustomNodeDefinition,
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
} from '../../services/nodeGraph';
import type { NodeGraphActions, SliceCreator, TimelineStore } from './types';

function generateCustomNodeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip || clip.nodeGraph) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = createClipNodeGraphState(clip, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
  },

  addClipAICustomNode: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeId = generateCustomNodeId();
    const definition = createClipAICustomNodeDefinition(nodeId, clip);
    const nodeGraph = addClipCustomNodeDefinition(clip, definition, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
    invalidateCacheAndRequestRender(get());
    return nodeId;
  },

  updateClipAICustomNode: (clipId, nodeId, updates) => {
    const state = get();
    const { clips, tracks } = state;
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

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
          clipId,
          nodeId,
          new Set((normalizedUpdates.parameterSchema ?? []).map((param) => param.id)),
        )
      : {};

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = updateClipCustomNodeDefinition(clip, nodeId, normalizedUpdates, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
      ...cleanup,
    });
    invalidateCacheAndRequestRender(get());
  },

  removeClipNodeGraphNode: (clipId, nodeId) => {
    const state = get();
    const { clips, tracks } = state;
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    let nextClip: TimelineClip | null = null;
    let cleanup: Partial<TimelineStore> = {};

    if (nodeId.startsWith('effect-')) {
      const effectId = nodeId.slice('effect-'.length);
      const effects = clip.effects.filter((effect) => effect.id !== effectId);
      if (effects.length === clip.effects.length) {
        return;
      }

      const clipWithoutEffect = { ...clip, effects };
      nextClip = {
        ...clipWithoutEffect,
        nodeGraph: reconcileClipNodeGraphState(clipWithoutEffect, track, clip.nodeGraph),
      };
      cleanup = cleanupEffectParamTimelineState(state, clipId, effectId);
    } else if (clip.nodeGraph?.customNodes?.some((definition) => definition.id === nodeId)) {
      nextClip = {
        ...clip,
        nodeGraph: removeClipCustomNodeDefinition(clip, nodeId, track),
      };
      cleanup = cleanupNodeParamTimelineState(state, clipId, nodeId, null);
    } else if (nodeId === 'transform' || nodeId === 'mask' || nodeId === 'color') {
      const nodeGraph = hideClipBuiltInNode(clip, nodeId, track);
      if (nodeGraph === clip.nodeGraph) {
        return;
      }
      nextClip = { ...clip, nodeGraph };
    }

    if (!nextClip) {
      return;
    }

    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId ? nextClip : candidate
      )),
      ...cleanup,
    });
    invalidateCacheAndRequestRender(get());
  },

  showClipNodeGraphBuiltIn: (clipId, node) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = showClipBuiltInNode(clip, node, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
    invalidateCacheAndRequestRender(get());
  },

  connectClipNodeGraphPorts: (clipId, connection) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = connectClipNodeGraphPorts(clip, connection, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
    invalidateCacheAndRequestRender(get());
  },

  disconnectClipNodeGraphEdge: (clipId, edgeId) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = disconnectClipNodeGraphEdge(clip, edgeId, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
    invalidateCacheAndRequestRender(get());
  },

  moveClipNodeGraphNode: (clipId, nodeId, layout: NodeGraphLayout) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = updateClipNodeGraphLayout(clip, nodeId, layout, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
  },
});

function invalidateCacheAndRequestRender(state: TimelineStore): void {
  state.invalidateCache();
  engine.requestRender();
}
