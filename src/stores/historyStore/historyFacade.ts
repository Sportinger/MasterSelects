import type {
  HistoryEventType,
  HistoryListEntry,
  ProjectHistoryState,
} from '../../types/history';
import type { HistoryState } from './historyStoreTypes';

type HistoryStoreAccessor = {
  getState: () => HistoryState;
};

export function createHistoryFacade(useHistoryStore: HistoryStoreAccessor) {
  return {
    captureSnapshot: (label: string, options?: { isAutoCapture?: boolean }) =>
      useHistoryStore.getState().captureSnapshot(label, options),
    undo: () => useHistoryStore.getState().undo(),
    redo: () => useHistoryStore.getState().redo(),
    startBatch: (label: string) => useHistoryStore.getState().startBatch(label),
    endBatch: () => useHistoryStore.getState().endBatch(),
    recordHistoryEvent: (type: HistoryEventType, label: string) => {
      useHistoryStore.getState().recordEvent(type, label);
    },
    restoreHistoryEntry: (entry: HistoryListEntry) => useHistoryStore.getState().restoreEntry(entry),
    restoreHistoryBranch: (branchId: string, snapshotIndex?: number) => (
      useHistoryStore.getState().restoreBranch(branchId, snapshotIndex)
    ),
    serializeHistoryStateForProject: () => useHistoryStore.getState().serializeForProject(),
    hydrateHistoryStateFromProject: (history: ProjectHistoryState | null | undefined) => {
      useHistoryStore.getState().hydrateFromProject(history);
    },
  };
}
