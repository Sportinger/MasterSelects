// Phone-local breadcrumb of nested compositions: entering a nested composition from the phone
// remembers where it came from, so the top bar can offer one tap back. Ids only (serializable view
// state); the compositions themselves live in the media store.

import { create } from 'zustand';

export interface PhoneCompositionStep {
  parentId: string;
  childId: string;
}

interface PhoneCompositionTrailState {
  trail: PhoneCompositionStep[];
  enter: (parentId: string, childId: string) => void;
  /** Drops the last step (after going back to its parent). */
  pop: () => void;
  clear: () => void;
}

/** The trail after entering `childId` from `parentId`; entering an ancestor cuts the trail back to it. */
export function nextPhoneCompositionTrail(trail: readonly PhoneCompositionStep[], parentId: string, childId: string): PhoneCompositionStep[] {
  const ancestor = trail.findIndex((step) => step.parentId === childId);
  if (ancestor >= 0) return trail.slice(0, ancestor);
  return [...trail, { parentId, childId }];
}

export const usePhoneCompositionTrail = create<PhoneCompositionTrailState>((set) => ({
  trail: [],
  enter: (parentId, childId) => set((state) => ({ trail: nextPhoneCompositionTrail(state.trail, parentId, childId) })),
  pop: () => set((state) => ({ trail: state.trail.slice(0, -1) })),
  clear: () => set({ trail: [] }),
}));

/** The step the top bar's back crumb offers: only while the active composition is its child. */
export function phoneCompositionBackStep(trail: readonly PhoneCompositionStep[], activeId: string | null): PhoneCompositionStep | null {
  const last = trail[trail.length - 1];
  return last && activeId !== null && last.childId === activeId ? last : null;
}
