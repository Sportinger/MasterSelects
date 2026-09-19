import type { StreamHealthSample } from './streamTypes';

const HISTORY_CAPACITY = 1_800;
const EMPTY_HISTORY: readonly StreamHealthSample[] = Object.freeze([]);

interface StreamHealthHistoryState {
  buffer: StreamHealthSample[];
  start: number;
  size: number;
  snapshot: readonly StreamHealthSample[];
}

interface StreamHealthHistoryHotData {
  streamHealthHistory?: StreamHealthHistoryState;
}

function createHistoryState(): StreamHealthHistoryState {
  return {
    buffer: new Array<StreamHealthSample>(HISTORY_CAPACITY),
    start: 0,
    size: 0,
    snapshot: EMPTY_HISTORY,
  };
}

let historyState = (import.meta.hot?.data as StreamHealthHistoryHotData | undefined)?.streamHealthHistory
  ?? createHistoryState();
const listeners = new Set<() => void>();

function createSnapshot(): readonly StreamHealthSample[] {
  const snapshot = new Array<StreamHealthSample>(historyState.size);
  for (let index = 0; index < historyState.size; index += 1) {
    snapshot[index] = historyState.buffer[(historyState.start + index) % HISTORY_CAPACITY];
  }
  return snapshot;
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function appendStreamHealthSample(sample: StreamHealthSample): void {
  if (historyState.size < HISTORY_CAPACITY) {
    const writeIndex = (historyState.start + historyState.size) % HISTORY_CAPACITY;
    historyState.buffer[writeIndex] = sample;
    historyState.size += 1;
  } else {
    historyState.buffer[historyState.start] = sample;
    historyState.start = (historyState.start + 1) % HISTORY_CAPACITY;
  }
  historyState.snapshot = createSnapshot();
  notifyListeners();
}

export function getStreamHealthHistory(): readonly StreamHealthSample[] {
  return historyState.snapshot;
}

export function subscribeStreamHealthHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetStreamHealthHistory(): void {
  if (historyState.size === 0) return;
  historyState = createHistoryState();
  notifyListeners();
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => {
    (data as StreamHealthHistoryHotData).streamHealthHistory = historyState;
  });
}
