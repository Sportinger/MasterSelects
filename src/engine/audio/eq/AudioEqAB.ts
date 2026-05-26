import { normalizeAudioEqParams } from './AudioEqLegacy';
import type { AudioEqParamsV2 } from './AudioEqTypes';

export type AudioEqABSlot = 'A' | 'B';

export interface AudioEqABState {
  activeSlot: AudioEqABSlot;
  slots: {
    A: AudioEqParamsV2;
    B: AudioEqParamsV2;
  };
}

function cloneParams(params: AudioEqParamsV2 | unknown): AudioEqParamsV2 {
  return normalizeAudioEqParams({ eq: params });
}

function oppositeSlot(slot: AudioEqABSlot): AudioEqABSlot {
  return slot === 'A' ? 'B' : 'A';
}

export function createAudioEqABState(params: AudioEqParamsV2 | unknown): AudioEqABState {
  const normalized = cloneParams(params);
  return {
    activeSlot: 'A',
    slots: {
      A: normalized,
      B: cloneParams(normalized),
    },
  };
}

export function syncAudioEqABActiveSlot(
  state: AudioEqABState,
  activeParams: AudioEqParamsV2 | unknown,
): AudioEqABState {
  return {
    activeSlot: state.activeSlot,
    slots: {
      ...state.slots,
      [state.activeSlot]: cloneParams(activeParams),
    },
  };
}

export function switchAudioEqABSlot(
  state: AudioEqABState,
  activeParams: AudioEqParamsV2 | unknown,
  targetSlot: AudioEqABSlot = oppositeSlot(state.activeSlot),
): { state: AudioEqABState; params: AudioEqParamsV2 } {
  const synced = syncAudioEqABActiveSlot(state, activeParams);
  const params = cloneParams(synced.slots[targetSlot]);
  return {
    state: {
      ...synced,
      activeSlot: targetSlot,
    },
    params,
  };
}

export function copyAudioEqABSlot(
  state: AudioEqABState,
  fromSlot: AudioEqABSlot,
  toSlot: AudioEqABSlot,
): AudioEqABState {
  return {
    activeSlot: state.activeSlot,
    slots: {
      ...state.slots,
      [toSlot]: cloneParams(state.slots[fromSlot]),
    },
  };
}

export function resetInactiveAudioEqABSlot(
  state: AudioEqABState,
  activeParams: AudioEqParamsV2 | unknown,
): AudioEqABState {
  const inactiveSlot = oppositeSlot(state.activeSlot);
  return {
    activeSlot: state.activeSlot,
    slots: {
      ...state.slots,
      [state.activeSlot]: cloneParams(activeParams),
      [inactiveSlot]: cloneParams(activeParams),
    },
  };
}
