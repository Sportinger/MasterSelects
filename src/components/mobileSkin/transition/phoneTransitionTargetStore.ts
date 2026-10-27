// Which cut the transition sheet edits. Phone-local, serializable view state (clip ids only):
// the cut button sets it before opening the sheet, the Transition tool leaves it empty so the sheet
// resolves the cut of the selected clip, and the sheet clears it when it closes.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { PhoneCutTarget } from './phoneTransitionCuts';

interface PhoneTransitionTargetState {
  target: PhoneCutTarget | null;
  setTarget: (target: PhoneCutTarget | null) => void;
}

export const usePhoneTransitionTargetStore = create<PhoneTransitionTargetState>()(subscribeWithSelector((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
})));
