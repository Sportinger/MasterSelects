import type {
  HistoryEventType,
  HistoryListEntry,
  ProjectHistoryState,
} from '../../types/history';
import type { HistoryState } from './historyStoreTypes';
import { productAnalytics, trackTimelineEdit } from '../../services/productAnalytics';

type HistoryStoreAccessor = {
  getState: () => HistoryState;
};

export function createHistoryFacade(useHistoryStore: HistoryStoreAccessor) {
  return {
    captureSnapshot: (label: string, options?: { isAutoCapture?: boolean }) => {
      const wasBatching = useHistoryStore.getState().batchId !== null;
      useHistoryStore.getState().captureSnapshot(label, options);
      // A batch is reported once by endBatch. Individual high-frequency
      // captures inside a slider/drag gesture must not become analytics spam.
      if (!wasBatching) trackTimelineEdit(label);
    },
    undo: () => {
      const result = useHistoryStore.getState().undo();
      if (result) productAnalytics.track('timeline_history_used', { action: 'undo' });
      return result;
    },
    redo: () => {
      const result = useHistoryStore.getState().redo();
      if (result) productAnalytics.track('timeline_history_used', { action: 'redo' });
      return result;
    },
    startBatch: (label: string) => useHistoryStore.getState().startBatch(label),
    endBatch: () => {
      const state = useHistoryStore.getState();
      const label = state.batchId === null ? null : state.batchLabel;
      state.endBatch();
      if (label) trackTimelineEdit(label);
    },
    cancelHistoryBatch: () => useHistoryStore.getState().cancelBatch(),
    recordHistoryEvent: (type: HistoryEventType, label: string) => {
      useHistoryStore.getState().recordEvent(type, label);
    },
    restoreHistoryEntry: (entry: HistoryListEntry) => {
      const result = useHistoryStore.getState().restoreEntry(entry);
      if (result) productAnalytics.track('timeline_history_used', { action: 'restore' });
      return result;
    },
    restoreHistoryBranch: (branchId: string, snapshotIndex?: number) => {
      const result = useHistoryStore.getState().restoreBranch(branchId, snapshotIndex);
      if (result) productAnalytics.track('timeline_history_used', { action: 'restore' });
      return result;
    },
    serializeHistoryStateForProject: () => useHistoryStore.getState().serializeForProject()!,
    hydrateHistoryStateFromProject: (history: ProjectHistoryState | null | undefined) => {
      useHistoryStore.getState().hydrateFromProject(history);
    },
  };
}
