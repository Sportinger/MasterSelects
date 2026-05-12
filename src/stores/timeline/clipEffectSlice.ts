// Clip effect actions slice - extracted from clipSlice

import type { Effect, EffectType } from '../../types';
import type { ClipEffectActions, SliceCreator } from './types';
import { getDefaultEffectParams } from './utils';
import { generateEffectId } from './helpers/idGenerator';

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
    set({ clips: clips.map(c => c.id === clipId ? { ...c, effects: [...(c.effects || []), effect] } : c) });
    invalidateCache();
    return effect.id;
  },

  removeClipEffect: (clipId, effectId) => {
    const { clips, invalidateCache } = get();
    set({ clips: clips.map(c => c.id === clipId ? { ...c, effects: c.effects.filter(e => e.id !== effectId) } : c) });
    invalidateCache();
  },

  updateClipEffect: (clipId, effectId, params) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, effects: c.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, ...params } as Effect['params'] } : e) }
          : c
      ),
    });
    invalidateCache();
  },

  setClipEffectEnabled: (clipId, effectId, enabled) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, effects: c.effects.map(e => e.id === effectId ? { ...e, enabled } : e) }
          : c
      ),
    });
    invalidateCache();
  },

  reorderClipEffect: (clipId, effectId, newIndex) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const effects = [...c.effects];
        const oldIndex = effects.findIndex(e => e.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effects.splice(oldIndex, 1);
        effects.splice(newIndex, 0, moved);
        return { ...c, effects };
      }),
    });
    invalidateCache();
  },
});
