// Draft of the pen path while the mask sheet draws one. Plain data only (no handles): the sheet owns
// the session and writes every change into the clip's mask; the preview overlay
// (PhoneMaskPenOverlay) reads the draft to draw it and edits it through these actions.

import { create } from 'zustand';

import { NO_PHONE_PEN_CONSTRAINTS, type PhonePenConstraintKey, type PhonePenConstraints } from './phoneMaskConstraints';
import { EMPTY_PHONE_PEN_PATH, type PhonePenPath } from './phonePenModel';

interface PhonePenState {
  /** True while the mask sheet is in pen mode; the preview shows the drawing overlay then. */
  active: boolean;
  clipId: string | null;
  path: PhonePenPath;
  /** Point whose handle is shown and can be dragged (the last touched one). */
  selected: number | null;
  begin: (clipId: string, path?: PhonePenPath) => void;
  end: () => void;
  update: (change: (path: PhonePenPath) => PhonePenPath, selected?: number | null) => void;
  select: (index: number | null) => void;
  /** Touch toggles for the desktop's modifier-key constraints (phoneMaskConstraints); reset per pen session. */
  constraints: PhonePenConstraints;
  setConstraint: (key: PhonePenConstraintKey, on: boolean) => void;
}

export const usePhonePenStore = create<PhonePenState>()((set) => ({
  active: false,
  clipId: null,
  path: EMPTY_PHONE_PEN_PATH,
  selected: null,
  // Constraints are momentary like the desktop's modifier keys: every pen session starts without them.
  begin: (clipId, path = EMPTY_PHONE_PEN_PATH) => set({ active: true, clipId, path, selected: path.points.length > 0 ? path.points.length - 1 : null, constraints: NO_PHONE_PEN_CONSTRAINTS }),
  end: () => set({ active: false, clipId: null, path: EMPTY_PHONE_PEN_PATH, selected: null }),
  update: (change, selected) => set((state) => {
    const path = change(state.path);
    if (path === state.path && selected === undefined) return state;
    const next = selected === undefined ? state.selected : selected;
    return { path, selected: next !== null && next < path.points.length ? next : null };
  }),
  select: (selected) => set({ selected }),
  constraints: NO_PHONE_PEN_CONSTRAINTS,
  setConstraint: (key, on) => set((state) => ({ constraints: { ...state.constraints, [key]: on } })),
}));
