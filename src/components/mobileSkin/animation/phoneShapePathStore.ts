// Draft of the shape path while the shape path sheet edits one: which motion shape clip, whether a
// finger draws a new path or edits points, the selected point and the path itself (local pixels,
// the clip's MotionPathVertex list). Plain data only: the preview overlay (PhoneShapePathOverlay)
// changes the draft, the sheet owns the transaction and writes each change into the clip.
import { create } from 'zustand';

import type { MotionPathVertex } from '../../../types/motionDesign';

export type PhoneShapePathMode = 'draw' | 'edit';

interface PhoneShapePathState {
  /** True while the shape path sheet is open on a path clip; the preview shows the path overlay. */
  active: boolean;
  clipId: string | null;
  mode: PhoneShapePathMode;
  selected: number | null;
  vertices: MotionPathVertex[];
  closed: boolean;
  begin: (clipId: string, vertices: MotionPathVertex[], closed: boolean, mode: PhoneShapePathMode) => void;
  end: () => void;
  setMode: (mode: PhoneShapePathMode) => void;
  select: (index: number | null) => void;
  setPath: (vertices: MotionPathVertex[], closed: boolean, selected?: number | null) => void;
}

export const usePhoneShapePathStore = create<PhoneShapePathState>()((set) => ({
  active: false,
  clipId: null,
  mode: 'edit',
  selected: null,
  vertices: [],
  closed: false,
  begin: (clipId, vertices, closed, mode) => set({ active: true, clipId, vertices, closed, mode, selected: null }),
  end: () => set({ active: false, clipId: null, selected: null, vertices: [], closed: false }),
  setMode: (mode) => set({ mode }),
  select: (selected) => set({ selected }),
  setPath: (vertices, closed, selected) => set((state) => {
    const next = selected === undefined ? state.selected : selected;
    return { vertices, closed, selected: next !== null && next < vertices.length ? next : null };
  }),
}));
