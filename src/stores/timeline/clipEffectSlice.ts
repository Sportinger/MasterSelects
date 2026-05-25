// Clip effect actions slice - extracted from clipSlice

import type { Effect, EffectType, TimelineClip } from '../../types';
import { isAudioEffect } from '../../types';
import type { ClipEffectActions, SliceCreator } from './types';
import { getDefaultEffectParams } from './utils';
import { generateEffectId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';

function updateClipEffectState(
  clip: TimelineClip,
  updater: (clip: TimelineClip) => TimelineClip,
  invalidateProcessedAudio: boolean,
): TimelineClip {
  const updated = updater(clip);
  return invalidateProcessedAudio ? clearProcessedAudioAnalysisRefs(updated) : updated;
}

export const createClipEffectSlice: SliceCreator<ClipEffectActions> = (set, get) => ({
  addClipEffect: (clipId, effectType) => {
    const { clips, invalidateCache } = get();
    const effect: Effect = {
      id: generateEffectId(),
      name: effectType,
      type: effectType as EffectType,
      enabled: true,
      params: getDefaultEffectParams(effectType),
    };
    set({
      clips: clips.map(c => c.id === clipId
        ? updateClipEffectState(
            c,
            clip => ({ ...clip, effects: [...(clip.effects || []), effect] }),
            isAudioEffect(effect.type),
          )
        : c),
    });
    invalidateCache();
    return effect.id;
  },

  removeClipEffect: (clipId, effectId) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const removedEffect = c.effects.find(e => e.id === effectId);
        return updateClipEffectState(
          c,
          clip => ({ ...clip, effects: clip.effects.filter(e => e.id !== effectId) }),
          !!removedEffect && isAudioEffect(removedEffect.type),
        );
      }),
    });
    invalidateCache();
  },

  updateClipEffect: (clipId, effectId, params) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId
              ? { ...e, params: { ...e.params, ...params } as Effect['params'] }
              : e),
          }),
          !!updatedEffect && isAudioEffect(updatedEffect.type),
        );
      }),
    });
    invalidateCache();
  },

  setClipEffectEnabled: (clipId, effectId, enabled) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId ? { ...e, enabled } : e),
          }),
          !!updatedEffect && isAudioEffect(updatedEffect.type),
        );
      }),
    });
    invalidateCache();
  },

  reorderClipEffect: (clipId, effectId, newIndex) => {
    const { clips, invalidateCache } = get();
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
          !!movedEffect && isAudioEffect(movedEffect.type),
        );
      }),
    });
    invalidateCache();
  },
});
