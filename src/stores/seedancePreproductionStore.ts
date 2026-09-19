import { create } from 'zustand';

import {
  createEmptySeedancePreproductionState,
  type SeedancePreproductionProjectState,
  type SeedancePlanningDocument,
  type SeedancePreproductionRun,
  type SeedanceSourceBundleReference,
} from '../services/seedancePreproduction/contracts';

interface SeedancePreproductionActions {
  hydrate(state: SeedancePreproductionProjectState): void;
  patchRun(runId: string, patch: Partial<SeedancePreproductionRun>): void;
  putDocument(document: SeedancePlanningDocument): void;
  putRun(run: SeedancePreproductionRun): void;
  removeDocument(documentId: string): void;
  reset(): void;
  resetRuns(): void;
  setActiveRun(runId: string | null): void;
  setSourceBundle(sourceBundle: SeedanceSourceBundleReference | undefined): void;
}

export type SeedancePreproductionStore = SeedancePreproductionProjectState
  & SeedancePreproductionActions;

export const useSeedancePreproductionStore = create<SeedancePreproductionStore>((set) => ({
  ...createEmptySeedancePreproductionState(),
  hydrate: (state) => set(JSON.parse(JSON.stringify(state)) as SeedancePreproductionProjectState),
  patchRun: (runId, patch) => set((state) => {
    const current = state.runs[runId];
    if (!current) return state;
    return {
      runs: {
        ...state.runs,
        [runId]: {
          ...current,
          ...patch,
          id: current.id,
          schemaVersion: 1,
          updatedAt: Date.now(),
        },
      },
    };
  }),
  putRun: (run) => set((state) => ({
    activeRunId: run.id,
    runs: { ...state.runs, [run.id]: JSON.parse(JSON.stringify(run)) as SeedancePreproductionRun },
  })),
  putDocument: (document) => set((state) => ({
    documents: [
      ...state.documents.filter((candidate) => candidate.id !== document.id),
      JSON.parse(JSON.stringify(document)) as SeedancePlanningDocument,
    ],
    sourceBundle: undefined,
  })),
  removeDocument: (documentId) => set((state) => ({
    documents: state.documents.filter((document) => document.id !== documentId),
    sourceBundle: undefined,
  })),
  reset: () => set(createEmptySeedancePreproductionState()),
  resetRuns: () => set({ activeRunId: null, runs: {} }),
  setActiveRun: (activeRunId) => set({ activeRunId }),
  setSourceBundle: (sourceBundle) => set({
    sourceBundle: sourceBundle === undefined
      ? undefined
      : JSON.parse(JSON.stringify(sourceBundle)) as SeedanceSourceBundleReference,
  }),
}));

export function getSeedancePreproductionProjectState(): SeedancePreproductionProjectState {
  const state = useSeedancePreproductionStore.getState();
  return JSON.parse(JSON.stringify({
    schemaVersion: 1,
    activeRunId: state.activeRunId,
    documents: state.documents,
    runs: state.runs,
    sourceBundle: state.sourceBundle,
  })) as SeedancePreproductionProjectState;
}
