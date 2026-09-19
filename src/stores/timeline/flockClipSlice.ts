import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { FlockDefinition, FlockParamValue } from '../../types/flock';
import { createFlockProperty, parseFlockProperty } from '../../types/flock';
import type { FlockClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateFlockClipId } from './helpers/idGenerator';
import { renderHostPort } from '../../services/render/renderHostPort';
import { Logger } from '../../services/logger';
import {
  addFlockNode,
  connectFlockPorts,
  createFlockGroupFromNodes,
  disconnectFlockEdge,
  duplicateFlockNodes,
  exposeFlockParam,
  importFlockGroupDefinition,
  moveFlockNode,
  removeFlockNodes,
  renameFlockNode,
  setFlockNodeBypass,
  setFlockNodeParam,
  unexposeFlockParam,
  ungroupFlockNode,
  updateFlockExposedParam,
  type FlockMutationResult,
} from '../../services/flock/mutations/flockGraphMutations';
import { createFlockPresetDefinition, getFlockPreset, DEFAULT_FLOCK_PRESET_ID } from '../../services/flock/presets/flockPresets';
import { FLOCK_GROUP_OPERATOR_ID } from '../../services/flock/operators/flockOperatorRegistry';
import { readFlockParamForProperty, writeFlockParamForProperty } from '../../services/flock/flockPropertyValues';

const log = Logger.create('FlockClipSlice');

export const DEFAULT_FLOCK_CLIP_DURATION = 10;

function withoutKeyframesFor(
  clipKeyframes: Map<string, Keyframe[]>,
  clipId: string,
  predicate: (keyframe: Keyframe) => boolean,
): Map<string, Keyframe[]> | null {
  const existing = clipKeyframes.get(clipId);
  if (!existing?.some(predicate)) return null;
  const next = new Map(clipKeyframes);
  const kept = existing.filter((keyframe) => !predicate(keyframe));
  if (kept.length > 0) next.set(clipId, kept); else next.delete(clipId);
  return next;
}

const belongsToNodes = (nodeIds: ReadonlySet<string>) => (keyframe: Keyframe) => {
  const parsed = parseFlockProperty(keyframe.property);
  return !!parsed && nodeIds.has(parsed.nodeId);
};

export const createFlockClipSlice: SliceCreator<FlockClipActions> = (set, get) => {
  const findFlockClip = (clipId: string): TimelineClip | null => {
    const clip = get().clips.find((candidate) => candidate.id === clipId);
    return clip?.source?.type === 'flock' && clip.flock ? clip : null;
  };

  const isLocked = (clip: TimelineClip) => get().tracks.find((track) => track.id === clip.trackId)?.locked === true;

  const writeDefinition = (clipId: string, definition: FlockDefinition, layoutOnly = false) => {
    set({
      clips: get().clips.map((clip) => (clip.id === clipId ? { ...clip, flock: definition } : clip)),
    });
    if (!layoutOnly) {
      get().invalidateCache();
      renderHostPort.requestRender();
    }
  };

  const mutate = <T extends object>(
    clipId: string,
    planner: (definition: FlockDefinition) => FlockMutationResult<T>,
    options: { layoutOnly?: boolean } = {},
  ): FlockMutationResult<T> => {
    const clip = findFlockClip(clipId);
    if (!clip) return { ok: false, code: 'missing-clip', message: `Flock clip ${clipId} not found.` };
    if (isLocked(clip)) return { ok: false, code: 'track-locked', message: 'The clip is on a locked track.' };
    const result = planner(clip.flock!);
    if (!result.ok) {
      log.debug('Flock mutation rejected', { clipId, code: result.code, message: result.message });
      return result;
    }
    writeDefinition(clipId, result.definition, options.layoutOnly);
    return result;
  };

  return {
    addFlockClip: (trackId, startTime, options = {}) => {
      const { clips, tracks, updateDuration, invalidateCache } = get();
      const track = tracks.find((candidate) => candidate.id === trackId);
      if (!track || track.type !== 'video') {
        log.warn('Flock clips can only be added to video tracks');
        return null;
      }
      if (track.locked) {
        log.warn('Cannot add a flock clip to a locked track', { trackId });
        return null;
      }
      const presetId = options.presetId && getFlockPreset(options.presetId) ? options.presetId : DEFAULT_FLOCK_PRESET_ID;
      const preset = getFlockPreset(presetId)!;
      const definition = createFlockPresetDefinition(presetId);
      const duration = Math.max(0.1, options.duration ?? DEFAULT_FLOCK_CLIP_DURATION);
      const clipId = generateFlockClipId();
      const clip: TimelineClip = {
        id: clipId,
        trackId,
        name: options.name ?? `Flock: ${preset.label.replace(' (Showcase)', '')}`,
        file: new File([JSON.stringify({ kind: 'flock', presetId })], 'flock.json', { type: 'application/json' }),
        startTime: Math.max(0, startTime),
        duration,
        inPoint: 0,
        outPoint: duration,
        source: { type: 'flock', naturalDuration: duration },
        flock: definition,
        transform: { ...DEFAULT_TRANSFORM },
        effects: [],
        isLoading: false,
        is3D: true,
      };
      set({ clips: [...clips, clip] });
      updateDuration();
      invalidateCache();
      renderHostPort.requestRender();
      log.debug('Created flock clip', { clipId, presetId });
      return clipId;
    },

    applyFlockPreset: (clipId, presetId) => {
      const clip = findFlockClip(clipId);
      if (!clip || isLocked(clip) || !getFlockPreset(presetId)) return false;
      const nextKeyframes = withoutKeyframesFor(get().clipKeyframes, clipId, (keyframe) => keyframe.property.startsWith('flock.node.'));
      writeDefinition(clipId, createFlockPresetDefinition(presetId));
      if (nextKeyframes) set({ clipKeyframes: nextKeyframes });
      return true;
    },

    replaceFlockDefinition: (clipId, definition) => {
      const clip = findFlockClip(clipId);
      if (!clip || isLocked(clip)) return false;
      const keptNodeIds = new Set(definition.nodes.map((node) => node.id));
      const nextKeyframes = withoutKeyframesFor(get().clipKeyframes, clipId, (keyframe) => {
        const parsed = parseFlockProperty(keyframe.property);
        return !!parsed && !keptNodeIds.has(parsed.nodeId);
      });
      writeDefinition(clipId, structuredClone(definition));
      if (nextKeyframes) set({ clipKeyframes: nextKeyframes });
      return true;
    },

    addFlockGraphNode: (clipId, operatorId, options = {}) => {
      const result = mutate(clipId, (definition) => addFlockNode(definition, operatorId, options));
      return result.ok ? result.nodeId : null;
    },

    removeFlockGraphNodes: (clipId, nodeIds) => {
      const result = mutate(clipId, (definition) => removeFlockNodes(definition, nodeIds));
      if (!result.ok) return false;
      const nextKeyframes = withoutKeyframesFor(get().clipKeyframes, clipId, belongsToNodes(new Set(result.removedNodeIds)));
      if (nextKeyframes) set({ clipKeyframes: nextKeyframes });
      const recording = get().keyframeRecordingEnabled;
      const prefixes = result.removedNodeIds.map((nodeId) => `${clipId}:flock.node.${nodeId}.`);
      if ([...recording].some((key) => prefixes.some((prefix) => key.startsWith(prefix)))) {
        set({ keyframeRecordingEnabled: new Set([...recording].filter((key) => !prefixes.some((prefix) => key.startsWith(prefix)))) });
      }
      return true;
    },

    connectFlockGraphPorts: (clipId, from, to) => {
      const result = mutate(clipId, (definition) => connectFlockPorts(definition, from, to));
      return result.ok
        ? { ok: true, edgeId: result.edgeId, ...(result.replacedEdgeId ? { replacedEdgeId: result.replacedEdgeId } : {}) }
        : { ok: false, code: result.code, message: result.message };
    },

    disconnectFlockGraphEdge: (clipId, edgeId) => mutate(clipId, (definition) => disconnectFlockEdge(definition, edgeId)).ok,

    setFlockGraphParam: (clipId, nodeId, paramId, value) => (
      mutate(clipId, (definition) => setFlockNodeParam(definition, nodeId, paramId, value)).ok
    ),

    setFlockGraphBypass: (clipId, nodeId, bypassed) => (
      mutate(clipId, (definition) => setFlockNodeBypass(definition, nodeId, bypassed)).ok
    ),

    moveFlockGraphNode: (clipId, nodeId, x, y) => {
      mutate(clipId, (definition) => moveFlockNode(definition, nodeId, { x, y }), { layoutOnly: true });
    },

    renameFlockGraphNode: (clipId, nodeId, label) => (
      mutate(clipId, (definition) => renameFlockNode(definition, nodeId, label), { layoutOnly: true }).ok
    ),

    duplicateFlockGraphNodes: (clipId, nodeIds) => {
      const result = mutate(clipId, (definition) => duplicateFlockNodes(definition, nodeIds));
      return result.ok ? result.idMap : null;
    },

    exposeFlockGraphParam: (clipId, nodeId, paramId, options) => {
      const result = mutate(clipId, (definition) => exposeFlockParam(definition, nodeId, paramId, options), { layoutOnly: true });
      return result.ok ? result.exposedId : null;
    },

    unexposeFlockGraphParam: (clipId, exposedId) => (
      mutate(clipId, (definition) => unexposeFlockParam(definition, exposedId), { layoutOnly: true }).ok
    ),

    updateFlockExposedParam: (clipId, exposedId, patch) => (
      mutate(clipId, (definition) => updateFlockExposedParam(definition, exposedId, patch), { layoutOnly: true }).ok
    ),

    groupFlockGraphNodes: (clipId, nodeIds, label) => {
      const result = mutate(clipId, (definition) => createFlockGroupFromNodes(definition, nodeIds, label));
      if (!result.ok) return null;
      // Keyframes on grouped nodes move to the group instance override keys.
      const members = new Set(nodeIds);
      const keyframes = get().clipKeyframes.get(clipId);
      if (keyframes?.some(belongsToNodes(members))) {
        const next = new Map(get().clipKeyframes);
        next.set(clipId, keyframes.map((keyframe) => {
          const parsed = parseFlockProperty(keyframe.property);
          if (!parsed || !members.has(parsed.nodeId)) return keyframe;
          return {
            ...keyframe,
            property: createFlockProperty(result.groupNodeId, `${parsed.nodeId}__${parsed.param}`, parsed.component),
          };
        }));
        set({ clipKeyframes: next });
      }
      return result.groupNodeId;
    },

    ungroupFlockGraphNode: (clipId, groupNodeId) => {
      const result = mutate(clipId, (definition) => ungroupFlockNode(definition, groupNodeId));
      if (!result.ok) return null;
      // Instance-override keyframes move back to the inlined inner nodes.
      const keyframes = get().clipKeyframes.get(clipId);
      if (keyframes?.some(belongsToNodes(new Set([groupNodeId])))) {
        const next = new Map(get().clipKeyframes);
        next.set(clipId, keyframes.flatMap((keyframe) => {
          const parsed = parseFlockProperty(keyframe.property);
          if (!parsed || parsed.nodeId !== groupNodeId) return [keyframe];
          const separator = parsed.param.indexOf('__');
          const innerNodeId = separator > 0 ? result.nodeIdMap[parsed.param.slice(0, separator)] : undefined;
          return innerNodeId
            ? [{ ...keyframe, property: createFlockProperty(innerNodeId, parsed.param.slice(separator + 2), parsed.component) }]
            : [];
        }));
        set({ clipKeyframes: next });
      }
      return result.nodeIdMap;
    },

    insertFlockGroupDefinition: (clipId, group, layout) => {
      let groupNodeId: string | null = null;
      const result = mutate(clipId, (definition) => {
        const imported = importFlockGroupDefinition(definition, group);
        if (!imported.ok) return imported;
        const added = addFlockNode(imported.definition, FLOCK_GROUP_OPERATOR_ID, { groupRef: imported.groupId, label: group.label, layout });
        if (added.ok) groupNodeId = added.nodeId;
        return added;
      });
      return result.ok ? groupNodeId : null;
    },

    setFlockTimeSettings: (clipId, patch) => {
      mutate(clipId, (definition) => ({
        ok: true,
        definition: { ...definition, time: { ...definition.time, ...patch } },
      }));
    },

    setFlockCacheSettings: (clipId, patch) => {
      mutate(clipId, (definition) => ({
        ok: true,
        definition: {
          ...definition,
          cache: { precomputeStart: 0, precomputeEnd: 0, persist: false, ...definition.cache, ...patch },
        },
      }), { layoutOnly: true });
    },

    setFlockParamFromProperty: (clipId, property, value) => {
      const clip = findFlockClip(clipId);
      if (!clip) return false;
      const next = writeFlockParamForProperty(clip.flock!, property, value);
      if (!next) return false;
      return mutate(clipId, () => ({ ok: true, definition: next })).ok;
    },

    getFlockParamForProperty: (clipId, property) => {
      const clip = findFlockClip(clipId);
      return clip ? readFlockParamForProperty(clip.flock!, property) : undefined;
    },
  };
};

export type { FlockParamValue };
