// Commands of the phone Effects sheet. Every change goes through the editor's own clip effect
// actions (addClipEffect, removeClipEffect, setClipEffectEnabled, reorderClipEffect, setPropertyValue)
// inside one owned, cancellable phone edit session: Done is one undo step, Cancel rolls everything
// back. New effects go to every selected visual clip; the stack rows act on the primary clip. With
// nothing selected the first added effect creates an adjustment layer at the playhead.

import { useEffect, useRef } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty, type AnimatableProperty } from '../../../types/animationProperties';
import { isAudioEffect, type Effect, type EffectType } from '../../../types/effects';
import type { PhoneActionResult } from '../contracts';
import { createPhoneEditSession, type PhoneEditSession } from '../sheets/phoneEditSession';
import { addPhoneAdjustmentLayer, readPhoneVisualSelection, type PhoneVisualSelection } from './phoneEffectTargets';

/** Effects the phone stack lists: video effects in the clip chain (no audio, no free-standing node groups). */
export function phoneVisibleEffects(effects: readonly Effect[] | undefined): Effect[] {
  return (effects ?? []).filter((effect) => !isAudioEffect(effect.type as EffectType) && !effect.detached);
}

/**
 * Index in the clip's full effect array that moves `effectId` one visible step up (-1) or down (+1),
 * skipping audio effects and node groups that the phone does not list. Null at either end.
 */
export function phoneEffectMoveIndex(effects: readonly Effect[], effectId: string, direction: -1 | 1): number | null {
  const visible = phoneVisibleEffects(effects);
  const position = visible.findIndex((effect) => effect.id === effectId);
  const neighbour = visible[position + direction];
  if (position < 0 || !neighbour) return null;
  return effects.findIndex((effect) => effect.id === neighbour.id);
}

export interface PhoneEffectsCommands {
  readonly selection: PhoneVisualSelection;
  /** The clip whose stack the sheet shows: the primary selection or the adjustment layer it created. */
  targetClipId: () => string | null;
  /** True once the sheet created an adjustment layer (root scope). */
  createdAdjustment: () => boolean;
  /** Adds `effectType` to every target clip; resolves with the new effect id on the primary clip. */
  add: (effectType: string) => Promise<string | null>;
  remove: (effectId: string) => Promise<void>;
  setEnabled: (effectId: string, enabled: boolean) => Promise<void>;
  move: (effectId: string, direction: -1 | 1) => Promise<void>;
  /** Sets one numeric parameter (absolute value; keyframed parameters get a key at the playhead, as on the desktop). */
  setParam: (effectId: string, paramName: string, value: number) => Promise<void>;
  commit: () => Promise<PhoneActionResult>;
  cancel: () => void;
  readonly session: PhoneEditSession;
}

export function createPhoneEffectsCommands(selection: PhoneVisualSelection = readPhoneVisualSelection()): PhoneEffectsCommands {
  const session = createPhoneEditSession(selection.nothingSelected ? 'Add adjustment effect' : 'Effects');
  let adjustmentId: string | null = null;
  const targets = () => (adjustmentId ? [adjustmentId] : selection.clips.map((clip) => clip.id));
  const primary = () => adjustmentId ?? selection.primary?.id ?? null;
  const store = () => useTimelineStore.getState();

  const add = async (effectType: string) => {
    let added: string | null = null;
    await session.apply(() => {
      if (selection.nothingSelected && !adjustmentId) adjustmentId = addPhoneAdjustmentLayer();
      const primaryId = primary();
      for (const clipId of targets()) {
        const id = store().addClipEffect(clipId, effectType);
        if (clipId === primaryId) added = id;
      }
    });
    return added;
  };

  const onPrimary = (change: (clipId: string) => void) => session.apply(() => {
    const clipId = primary();
    if (clipId) change(clipId);
  });

  return {
    selection,
    session,
    targetClipId: primary,
    createdAdjustment: () => adjustmentId !== null,
    add,
    remove: (effectId) => onPrimary((clipId) => store().removeClipEffect(clipId, effectId)),
    setEnabled: (effectId, enabled) => onPrimary((clipId) => store().setClipEffectEnabled(clipId, effectId, enabled)),
    move: (effectId, direction) => onPrimary((clipId) => {
      const effects = store().clips.find((clip) => clip.id === clipId)?.effects ?? [];
      const index = phoneEffectMoveIndex(effects, effectId, direction);
      if (index !== null) store().reorderClipEffect(clipId, effectId, index);
    }),
    setParam: (effectId, paramName, value) => onPrimary((clipId) => {
      store().setPropertyValue(clipId, createEffectProperty(effectId, paramName) as AnimatableProperty, value);
    }),
    commit: () => session.commit(adjustmentId ? () => { store().selectClip(adjustmentId) } : undefined),
    cancel: () => session.cancel(),
  };
}

/** One effects session per sheet mount; a sheet that unmounts without Done is rolled back. */
export function usePhoneEffectsCommands(): PhoneEffectsCommands {
  const ref = useRef<PhoneEffectsCommands | null>(null);
  ref.current ??= createPhoneEffectsCommands();
  const commands = ref.current;
  useEffect(() => () => commands.cancel(), [commands]);
  return commands;
}
