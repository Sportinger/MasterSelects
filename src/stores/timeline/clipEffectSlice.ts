// Clip effect actions slice - extracted from clipSlice

import type { AudioEffectInstance, Effect, EffectType, Keyframe, TimelineClip } from '../../types';
import type { ClipEffectActions, SliceCreator, TimelineStore } from './types';
import { captureSnapshot } from '../historyStore';
import { getDefaultEffectParams } from './utils';
import { generateEffectId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import {
  audioEffectInstanceRequiresProcessedAnalysis,
  legacyAudioEffectRequiresProcessedAnalysis,
} from '../../services/audio/processedWaveformEligibility';
import { getAudioEqAudibleStateForIdentity } from '../../engine/audio/eq/AudioEqIdentity';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';
import { mergeAudioEffectParamPatch } from '../../utils/audioEffectParamPath';
import { createClipNodeGraphState, reconcileClipNodeGraphState } from '../../services/nodeGraph';
import {
  createNodeGraphOwnerClip,
  resolveLinkedClipNodeGraphContext,
} from '../../services/nodeGraph/clipGraphLinking';
import { cleanupEffectParamTimelineState } from './helpers/propertyTimelineCleanup';
import { reconcileRemovedParameterTargets } from '../../services/parameterSources/parameterSourceLifecycle';
import { createInitialSlitScanGraph } from '../../services/operators/slitScanGraphUpgrade';
import { reconcileSlitScanDuration } from './helpers/slitScanDuration';
import { FLOCKING_EFFECT_TYPE, flockingEffectOf } from '../../services/flock/flockEffect';
import { createFlockPresetDefinition } from '../../services/flock/presets/flockPresets';

function updateClipEffectState(
  clip: TimelineClip,
  updater: (clip: TimelineClip) => TimelineClip,
  invalidateProcessedAudio: boolean,
): TimelineClip {
  const updated = reconcileSlitScanDuration(clip, updater(clip));
  return invalidateProcessedAudio ? clearProcessedAudioAnalysisRefs(updated) : updated;
}

function audioEffectUpdateInvalidatesProcessedAnalysis(
  currentEffect: AudioEffectInstance | undefined,
  nextEffect: AudioEffectInstance | undefined,
  keyframes: readonly Keyframe[],
): boolean {
  const currentRequires = audioEffectInstanceRequiresProcessedAnalysis(currentEffect, keyframes);
  const nextRequires = audioEffectInstanceRequiresProcessedAnalysis(nextEffect, keyframes);
  if (!currentRequires && !nextRequires) {
    return false;
  }

  if (currentEffect?.descriptorId === 'audio-eq' && nextEffect?.descriptorId === 'audio-eq') {
    return JSON.stringify(getAudioEqAudibleStateForIdentity(currentEffect.params)) !==
      JSON.stringify(getAudioEqAudibleStateForIdentity(nextEffect.params));
  }

  return true;
}

function createClipAudioEffectInstance(descriptorId: string): AudioEffectInstance | null {
  const descriptor = getAudioEffect(descriptorId);
  if (!descriptor) return null;

  return {
    id: generateEffectId(),
    descriptorId: descriptor.id,
    enabled: true,
    params: getAudioEffectDefaultParams(descriptor.id),
    automationMode: descriptor.automation === 'none' ? 'none' : 'clip',
  };
}

function mergeLegacyEffectParamPatch(
  effect: Effect,
  params: Partial<Effect['params']>,
): Effect['params'] {
  if (hasAudioEffect(effect.type)) {
    return mergeAudioEffectParamPatch(effect.params, params, effect.type) as Effect['params'];
  }

  return { ...effect.params, ...params } as Effect['params'];
}

function effectStackRequiresProcessedAnalysis(
  effectStack: readonly AudioEffectInstance[] | undefined,
  keyframes: readonly Keyframe[] = [],
): boolean {
  return (effectStack ?? []).some(effect => audioEffectInstanceRequiresProcessedAnalysis(effect, keyframes));
}

function reconcileEffectRemovalInNodeGraph(
  state: TimelineStore,
  updatedClip: TimelineClip,
): TimelineClip[] {
  const context = resolveLinkedClipNodeGraphContext(state.clips, state.tracks, updatedClip.id);
  if (!context) {
    return state.clips;
  }

  const graphOwnerClip = createNodeGraphOwnerClip(context);
  const existingGraph = graphOwnerClip.nodeGraph;
  if (!existingGraph) {
    return state.clips.map((clip) => clip.id === updatedClip.id ? updatedClip : clip);
  }

  if (context.ownerClip.id === updatedClip.id) {
    const nodeGraph = reconcileClipNodeGraphState(
      updatedClip,
      context.ownerTrack ?? undefined,
      existingGraph,
      {
        linkedClip: context.linkedClip,
        linkedTrack: context.linkedTrack,
      },
    );
    return state.clips.map((clip) => (
      clip.id === updatedClip.id ? { ...updatedClip, nodeGraph } : clip
    ));
  }

  const ownerNodeGraph = reconcileClipNodeGraphState(
    graphOwnerClip,
    context.ownerTrack ?? undefined,
    existingGraph,
    {
      linkedClip: updatedClip,
      linkedTrack: context.selectedTrack,
    },
  );
  return state.clips.map((clip) => {
    if (clip.id === updatedClip.id) return updatedClip;
    if (clip.id === context.ownerClip.id) return { ...context.ownerClip, nodeGraph: ownerNodeGraph };
    return clip;
  });
}

export const createClipEffectSlice: SliceCreator<ClipEffectActions> = (set, get) => ({
  addClipEffect: (clipId, effectType) => {
    const { clipKeyframes, invalidateCache } = get();
    const clips = get().clips;
    // One swarm per clip: adding Flocking again returns the existing effect.
    const existingFlocking = effectType === FLOCKING_EFFECT_TYPE ? flockingEffectOf(clips.find(c => c.id === clipId)) : undefined;
    if (existingFlocking) return existingFlocking.id;
    const effect: Effect = {
      id: generateEffectId(),
      name: effectType === FLOCKING_EFFECT_TYPE ? 'Flocking' : effectType,
      type: effectType as EffectType,
      enabled: true,
      params: { ...getDefaultEffectParams(effectType), ...(effectType === 'slit-scan' ? {
        stabilizationEnabled: false,
        geometryMode: '2d',
        geometrySampler: 'history',
        geometryLastMode: 'motion-surface',
        geometryPromoted3D: false,
      } : {}) },
      ...(effectType === 'slit-scan' ? { operatorGraph: createInitialSlitScanGraph() } : {}),
    };
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => c.id === clipId
        ? updateClipEffectState(
            c,
            clip => ({
              ...clip,
              effects: [...(clip.effects || []), effect],
              ...(effectType === FLOCKING_EFFECT_TYPE ? { flock: clip.flock ?? createFlockPresetDefinition() } : {}),
            }),
            legacyAudioEffectRequiresProcessedAnalysis(effect, keyframes),
          )
        : c),
    });
    invalidateCache();
    captureSnapshot('Add effect');
    return effect.id;
  },

  removeClipEffect: (clipId, effectId) => {
    const state = get();
    const { clipKeyframes, invalidateCache } = state;
    const clip = state.clips.find(candidate => candidate.id === clipId);
    const removedEffect = clip?.effects.find(effect => effect.id === effectId);
    if (!clip || !removedEffect) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const updatedClip = updateClipEffectState(
      clip,
      candidate => ({
        ...candidate,
        effects: candidate.effects.filter(effect => effect.id !== effectId),
        // The swarm graph belongs to its Flocking effect.
        ...(removedEffect.type === FLOCKING_EFFECT_TYPE ? { flock: undefined } : {}),
      }),
      legacyAudioEffectRequiresProcessedAnalysis(removedEffect, keyframes),
    );
    const cleanup = cleanupEffectParamTimelineState(state, clipId, effectId);
    if (removedEffect.type === FLOCKING_EFFECT_TYPE && keyframes.some(keyframe => keyframe.property.startsWith('flock.node.'))) {
      const clipKeyframesAfter = new Map(cleanup.clipKeyframes ?? clipKeyframes);
      const kept = (clipKeyframesAfter.get(clipId) ?? []).filter(keyframe => !keyframe.property.startsWith('flock.node.'));
      if (kept.length) clipKeyframesAfter.set(clipId, kept); else clipKeyframesAfter.delete(clipId);
      cleanup.clipKeyframes = clipKeyframesAfter;
    }
    set({
      clips: reconcileEffectRemovalInNodeGraph(state, updatedClip).map(candidate => candidate.id === clipId
        ? reconcileRemovedParameterTargets(clip, candidate) : candidate),
      ...cleanup,
    });
    invalidateCache();
    get().updateDuration();
    captureSnapshot('Remove effect');
  },

  updateClipEffect: (clipId, effectId, params) => {
    const state = get(), ref = state.clips.find(c => c.id === clipId)?.sceneGraphOutput;
    const document = ref && state.sharedSceneGraphs?.[ref.graphId];
    if (document?.effect.id === effectId) {
      set({ sharedSceneGraphs: { ...state.sharedSceneGraphs, [document.id]: { ...document, effect: { ...document.effect, params: mergeLegacyEffectParamPatch(document.effect, params) } } } });
      state.invalidateCache(); captureSnapshot('Adjust shared graph'); return;
    }
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        const nextEffect = updatedEffect
          ? { ...updatedEffect, params: mergeLegacyEffectParamPatch(updatedEffect, params) }
          : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId
              ? { ...e, params: mergeLegacyEffectParamPatch(e, params) }
              : e),
          }),
          legacyAudioEffectRequiresProcessedAnalysis(updatedEffect, keyframes) ||
            legacyAudioEffectRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
    get().updateDuration();
    captureSnapshot('Adjust effect');
  },

  setClipEffectEnabled: (clipId, effectId, enabled) => {
    const state = get(), ref = state.clips.find(c => c.id === clipId)?.sceneGraphOutput;
    const document = ref && state.sharedSceneGraphs?.[ref.graphId];
    if (document?.effect.id === effectId) {
      set({ sharedSceneGraphs: { ...state.sharedSceneGraphs, [document.id]: { ...document, effect: { ...document.effect, enabled } } } });
      state.invalidateCache(); captureSnapshot('Bypass shared graph'); return;
    }
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        // A free-standing group renders only once it is in the chain: enabling it attaches it.
        if (updatedEffect?.detached && !enabled) return c;
        const nextEffect = updatedEffect ? { ...updatedEffect, enabled } : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId ? { ...e, enabled, ...(e.detached ? { detached: undefined } : {}) } : e),
            ...(!enabled && updatedEffect ? {
              nodeGraph: {
                ...(clip.nodeGraph ?? createClipNodeGraphState(clip)),
                groups: {
                  ...clip.nodeGraph?.groups,
                  [`effect:${effectId}`]: { ...clip.nodeGraph?.groups?.[`effect:${effectId}`], collapsed: true },
                },
              },
            } : {}),
          }),
          legacyAudioEffectRequiresProcessedAnalysis(updatedEffect, keyframes) ||
            legacyAudioEffectRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
    get().updateDuration();
    captureSnapshot(enabled ? 'Enable effect' : 'Bypass effect');
  },

  reorderClipEffect: (clipId, effectId, newIndex) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const movedEffect = c.effects.find(e => e.id === effectId);
        const effects = [...c.effects];
        const oldIndex = effects.findIndex(e => e.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effects.splice(oldIndex, 1);
        effects.splice(newIndex, 0, moved);
        return updateClipEffectState(
          c,
          clip => ({ ...clip, effects }),
          legacyAudioEffectRequiresProcessedAnalysis(movedEffect, keyframes),
        );
      }),
    });
    invalidateCache();
    captureSnapshot('Reorder effect');
  },

  addClipAudioEffectInstance: (clipId, descriptorId) => {
    if (!hasAudioEffect(descriptorId)) return null;

    const { clips, clipKeyframes, invalidateCache } = get();
    const effect = createClipAudioEffectInstance(descriptorId);
    if (!effect) return null;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const audioState = c.audioState ?? {};
        const nextEffectStack = [...(audioState.effectStack ?? []), effect];
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: nextEffectStack,
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(effect, keyframes),
        );
      }),
    });
    invalidateCache();
    captureSnapshot('Add audio effect');
    return effect.id;
  },

  removeClipAudioEffectInstance: (clipId, effectId) => {
    const state = get();
    const { clipKeyframes, invalidateCache } = state;
    const clip = state.clips.find(candidate => candidate.id === clipId);
    const removedEffect = clip?.audioState?.effectStack?.find(effect => effect.id === effectId);
    if (!clip || !removedEffect) return;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    const updatedClip = updateClipEffectState(
      clip,
      candidate => ({
        ...candidate,
        audioState: {
          ...(candidate.audioState ?? {}),
          effectStack: candidate.audioState?.effectStack?.filter(effect => effect.id !== effectId) ?? [],
        },
      }),
      audioEffectInstanceRequiresProcessedAnalysis(removedEffect, keyframes),
    );
    set({
      clips: reconcileEffectRemovalInNodeGraph(state, updatedClip),
      ...cleanupEffectParamTimelineState(state, clipId, effectId),
    });
    invalidateCache();
    captureSnapshot('Remove audio effect');
  },

  updateClipAudioEffectInstance: (clipId, effectId, params) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const currentEffect = c.audioState.effectStack.find(effect => effect.id === effectId);
        const nextEffect = currentEffect
          ? {
              ...currentEffect,
              params: mergeAudioEffectParamPatch(currentEffect.params, params, currentEffect.descriptorId),
            }
          : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: clip.audioState?.effectStack?.map(effect => effect.id === effectId
                ? { ...effect, params: mergeAudioEffectParamPatch(effect.params, params, effect.descriptorId) }
                : effect) ?? [],
            },
          }),
          audioEffectUpdateInvalidatesProcessedAnalysis(currentEffect, nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
    captureSnapshot('Adjust audio effect');
  },

  setClipAudioEffectInstanceEnabled: (clipId, effectId, enabled) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const currentEffect = c.audioState.effectStack.find(effect => effect.id === effectId);
        const nextEffect = currentEffect ? { ...currentEffect, enabled } : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: clip.audioState?.effectStack?.map(effect => effect.id === effectId
                ? { ...effect, enabled }
                : effect) ?? [],
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(currentEffect, keyframes) ||
            audioEffectInstanceRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
    captureSnapshot(enabled ? 'Enable audio effect' : 'Bypass audio effect');
  },

  reorderClipAudioEffectInstance: (clipId, effectId, newIndex) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const effectStack = [...c.audioState.effectStack];
        const oldIndex = effectStack.findIndex(effect => effect.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effectStack.splice(oldIndex, 1);
        const clampedIndex = Math.max(0, Math.min(effectStack.length, newIndex));
        effectStack.splice(clampedIndex, 0, moved);
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack,
            },
          }),
          effectStackRequiresProcessedAnalysis(c.audioState.effectStack, keyframes),
        );
      }),
    });
    invalidateCache();
    captureSnapshot('Reorder audio effect');
  },
});
