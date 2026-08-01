import type { HistoryTimelineEvent } from '../../types/history';
import type { StateSnapshot } from './historyStoreTypes';
import { deepClone } from './snapshotCloning';

export function normalizePersistedSnapshot(value: unknown): StateSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<StateSnapshot>;
  if (typeof snapshot.timestamp !== 'number' || typeof snapshot.label !== 'string' ||
    !snapshot.timeline || !snapshot.media || !snapshot.dock || !snapshot.flashboard || !snapshot.export) return null;
  return deepClone(snapshot as StateSnapshot);
}

export function normalizePersistedEventLog(values: unknown, max: number): HistoryTimelineEvent[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is HistoryTimelineEvent => {
    const event = value as Partial<HistoryTimelineEvent>;
    return !!event && typeof event.id === 'string' && typeof event.label === 'string' &&
      typeof event.timestamp === 'number' && ['manual-save', 'autosave', 'system'].includes(event.type ?? '');
  }).filter((event) => event.type !== 'autosave').slice(-max);
}
