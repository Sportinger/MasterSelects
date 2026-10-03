import { captureSnapshot } from '../historyStore';
import type { CompositionGraphActions, SliceCreator } from './types';

export const createCompositionGraphSlice: SliceCreator<CompositionGraphActions> = (set, get) => ({
  updateCompositionGraph: (updater, options) => {
    const state = get();
    if (state.isExporting) return;
    const current = state.compositionGraph ?? { version: 1 as const };
    const compositionGraph = updater(current);
    if (compositionGraph === current) return;
    set({ compositionGraph });
    // No shared skip-history mechanism exists: callers batch drag frames or keep previews local.
    // Legacy capture joins an outer batch; repository history belongs to the current store scope.
    captureSnapshot(options?.historyLabel ?? 'Edit composition graph');
  },
});
