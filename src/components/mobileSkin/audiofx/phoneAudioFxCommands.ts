// Commands of the phone Audio effects sheet. Every change goes through the editor's own clip audio
// effect actions (addClipAudioEffectInstance, setClipAudioEffectInstanceEnabled,
// reorderClipAudioEffectInstance, removeClipAudioEffectInstance, setPropertyValue - the desktop
// Audio FX Stack's calls) and the desktop silence cleanup (detectClipSilenceRanges +
// applyDetectedSilenceRemoval), inside one owned phone edit session: Done = one undo step,
// Cancel = exact rollback. Values are absolute, never deltas.

import { useEffect, useRef } from 'react';

import { Logger } from '../../../services/logger';
import type { AudioSilenceRange } from '../../../services/audio/audioSilenceDetection';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty, type AnimatableProperty } from '../../../types/animationProperties';
import type { AudioEffectInstance } from '../../../types/audio';
import type { PhoneActionResult } from '../contracts';
import { createPhoneEditSession, type PhoneEditSession } from '../sheets/phoneEditSession';
import { isPhoneAudioFxOffered, phoneAudioFxStartingPoint } from './phoneAudioFxCatalog';

const log = Logger.create('PhoneAudioFx');

export interface PhoneSilenceOptions {
  thresholdDb: number;
  minSilenceSeconds: number;
  /** Close the gap the removed silence leaves (later clips on the track move left). */
  ripple: boolean;
}

export const PHONE_SILENCE_DEFAULTS: PhoneSilenceOptions = { thresholdDb: -50, minSilenceSeconds: 0.32, ripple: false };

export type PhoneSilenceResult =
  | { kind: 'removed'; count: number; seconds: number }
  | { kind: 'none' }
  | { kind: 'failed'; message: string };

export interface PhoneAudioFxCommands {
  readonly clipId: string | null;
  readonly session: PhoneEditSession;
  add: (descriptorId: string) => Promise<string | null>;
  remove: (effectId: string) => Promise<void>;
  setEnabled: (effectId: string, enabled: boolean) => Promise<void>;
  move: (effectId: string, direction: -1 | 1) => Promise<void>;
  setParam: (effectId: string, paramName: string, value: number) => Promise<void>;
  /** Adds (or re-enables) a peak normalize to -1 dBFS; resolves with its effect id. */
  normalize: () => Promise<string | null>;
  removeSilence: (options: PhoneSilenceOptions) => Promise<PhoneSilenceResult>;
  /** Resolves once no silence removal is in flight (its detection runs outside the session). */
  whenIdle: () => Promise<void>;
  /** Waits for in-flight work, then commits everything as one undo step. */
  commit: () => Promise<PhoneActionResult>;
  cancel: () => void;
}

export function readPhoneAudioFxStack(clipId: string | null): readonly AudioEffectInstance[] {
  if (!clipId) return [];
  return useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.audioState?.effectStack ?? [];
}

/** New index for moving `effectId` one step; null at either end or when it is not in the stack. */
export function phoneAudioFxMoveIndex(stack: readonly Pick<AudioEffectInstance, 'id'>[], effectId: string, direction: -1 | 1): number | null {
  const index = stack.findIndex((effect) => effect.id === effectId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= stack.length) return null;
  return next;
}

export function createPhoneAudioFxCommands(clipId: string | null): PhoneAudioFxCommands {
  const session = createPhoneEditSession('Audio effects');
  const store = () => useTimelineStore.getState();
  const onClip = (change: (id: string) => void | Promise<void>) => session.apply(async () => {
    if (clipId) await change(clipId);
  });

  const add = async (descriptorId: string) => {
    if (!clipId || !isPhoneAudioFxOffered(descriptorId)) return null;
    let added: string | null = null;
    await session.apply(() => {
      added = store().addClipAudioEffectInstance(clipId, descriptorId);
      const start = added ? phoneAudioFxStartingPoint(descriptorId) : null;
      if (added && start) store().updateClipAudioEffectInstance(clipId, added, { ...start });
    });
    if (!added) log.warn('The editor did not add the audio effect', { clipId, descriptorId });
    return added;
  };

  const normalize = async () => {
    if (!clipId) return null;
    let id: string | null = null;
    await session.apply(() => {
      const existing = readPhoneAudioFxStack(clipId).find((effect) => effect.descriptorId === 'audio-normalize');
      id = existing?.id ?? store().addClipAudioEffectInstance(clipId, 'audio-normalize');
      if (!id) return;
      store().updateClipAudioEffectInstance(clipId, id, { mode: 'peak', targetPeakDb: -1, allowBoost: true });
      if (existing && existing.enabled === false) store().setClipAudioEffectInstanceEnabled(clipId, id, true);
    });
    return id;
  };

  // Silence detection decodes the clip and takes a while; Done and leaving the sheet wait for it
  // (whenIdle) so the requested cut is never dropped into an already closed session.
  const inFlight = new Set<Promise<unknown>>();
  const whenIdle = async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  };

  const removeSilence = (options: PhoneSilenceOptions): Promise<PhoneSilenceResult> => {
    const run = detectAndRemoveSilence(options);
    inFlight.add(run);
    void run.finally(() => inFlight.delete(run));
    return run;
  };

  const detectAndRemoveSilence = async (options: PhoneSilenceOptions): Promise<PhoneSilenceResult> => {
    if (!clipId) return { kind: 'failed', message: 'Select a clip with sound first.' };
    let ranges: AudioSilenceRange[];
    try {
      // Detection only reads the sound; the removal below is the edit.
      ranges = await store().detectClipSilenceRanges(clipId, { thresholdDb: options.thresholdDb, minSilenceSeconds: options.minSilenceSeconds });
    } catch (error) {
      log.warn('Silence detection failed', error);
      return { kind: 'failed', message: `Finding silence failed: ${error instanceof Error ? error.message : String(error)}.` };
    }
    if (ranges.length === 0) return { kind: 'none' };
    if (session.closed) {
      log.warn('The Audio effects sheet closed before the silence was removed', { clipId });
      return { kind: 'failed', message: 'The sheet was closed before the silence was removed, so nothing was cut.' };
    }
    let operationIds: string[] = [];
    await session.apply(async () => {
      operationIds = await store().applyDetectedSilenceRemoval(clipId, { ranges, rippleTimeline: options.ripple });
    });
    if (operationIds.length === 0) return { kind: 'failed', message: 'The editor did not remove the silence (is the track locked?).' };
    return { kind: 'removed', count: operationIds.length, seconds: ranges.reduce((sum, range) => sum + range.duration, 0) };
  };

  return {
    clipId,
    session,
    add,
    remove: (effectId) => onClip((id) => store().removeClipAudioEffectInstance(id, effectId)),
    setEnabled: (effectId, enabled) => onClip((id) => store().setClipAudioEffectInstanceEnabled(id, effectId, enabled)),
    move: (effectId, direction) => onClip((id) => {
      const index = phoneAudioFxMoveIndex(readPhoneAudioFxStack(id), effectId, direction);
      if (index !== null) store().reorderClipAudioEffectInstance(id, effectId, index);
    }),
    // Numbers go through setPropertyValue like the desktop stack: keyframed parameters get a key at the playhead.
    setParam: (effectId, paramName, value) => onClip((id) => {
      store().setPropertyValue(id, createEffectProperty(effectId, paramName) as AnimatableProperty, value);
    }),
    normalize,
    removeSilence,
    whenIdle,
    commit: async () => { await whenIdle(); return session.commit(); },
    cancel: () => session.cancel(),
  };
}

/** One commands object per sheet mount; unmounting without Done rolls back. */
export function usePhoneAudioFxCommands(clipId: string | null): PhoneAudioFxCommands {
  const ref = useRef<PhoneAudioFxCommands | null>(null);
  ref.current ??= createPhoneAudioFxCommands(clipId);
  const commands = ref.current;
  useEffect(() => () => commands.cancel(), [commands]);
  return commands;
}
