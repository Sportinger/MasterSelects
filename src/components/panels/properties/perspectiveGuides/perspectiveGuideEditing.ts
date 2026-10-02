import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface PerspectiveGuideTarget {
  clipId: string; effectId: string; compositionId: string; panelId: string | null; id: string;
}
interface EditingState {
  target: PerspectiveGuideTarget | null;
  begin: (target: Omit<PerspectiveGuideTarget, 'id'>) => void;
  end: (id?: string) => void;
}
/** Transient UI ownership only. Drafts and runtime photo resources belong to the mounted editor. */
export const usePerspectiveGuideEditing = create<EditingState>()(subscribeWithSelector(set => ({
  target: null,
  begin: target => set({ target: { ...target, id: crypto.randomUUID() } }),
  end: id => set(state => !id || state.target?.id === id ? { target: null } : state),
})));
