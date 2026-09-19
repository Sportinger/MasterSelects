import type { PremiereProjectSummary } from './premiereProjectTypes';

export interface PremiereSequenceSelectionRequest {
  id: number;
  fileName: string;
  summary: PremiereProjectSummary;
}

interface InternalSelectionRequest {
  publicRequest: PremiereSequenceSelectionRequest;
  resolve: (selection: readonly string[] | null) => void;
}

interface SelectionRuntime {
  nextId: number;
  active: InternalSelectionRequest | null;
  listeners: Set<() => void>;
}

type PremiereSelectionHotData = { runtime?: SelectionRuntime };

const hotData = import.meta.hot?.data as PremiereSelectionHotData | undefined;
const runtime: SelectionRuntime = hotData?.runtime ?? {
  nextId: 1,
  active: null,
  listeners: new Set(),
};

if (import.meta.hot) {
  import.meta.hot.dispose((data: PremiereSelectionHotData) => {
    data.runtime = runtime;
  });
}

export function requestPremiereSequenceSelection(
  fileName: string,
  summary: PremiereProjectSummary,
): Promise<readonly string[] | null> {
  if (summary.sequences.length <= 1) {
    return Promise.resolve(summary.sequences.map((sequence) => sequence.uid));
  }
  runtime.active?.resolve(null);
  return new Promise((resolve) => {
    runtime.active = {
      publicRequest: { id: runtime.nextId++, fileName, summary },
      resolve,
    };
    notifyListeners();
  });
}

export function resolvePremiereSequenceSelection(id: number, selection: readonly string[] | null): void {
  if (runtime.active?.publicRequest.id !== id) return;
  const request = runtime.active;
  runtime.active = null;
  request.resolve(selection);
  notifyListeners();
}

export function subscribePremiereSequenceSelection(listener: () => void): () => void {
  runtime.listeners.add(listener);
  return () => runtime.listeners.delete(listener);
}

export function getPremiereSequenceSelectionSnapshot(): PremiereSequenceSelectionRequest | null {
  return runtime.active?.publicRequest ?? null;
}

function notifyListeners(): void {
  for (const listener of runtime.listeners) listener();
}
