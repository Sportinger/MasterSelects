interface PendingResourceRequest {
  id: number;
  resources: readonly string[];
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Analysis resource request was cancelled.', 'AbortError');
  }
  const error = new Error('Analysis resource request was cancelled.');
  error.name = 'AbortError';
  return error;
}

class AnalysisResourceCoordinator {
  private readonly held = new Set<string>();
  private readonly pending: PendingResourceRequest[] = [];
  private nextId = 1;

  async acquire(
    rawResources: readonly string[],
    signal?: AbortSignal,
  ): Promise<() => void> {
    if (signal?.aborted) throw abortError();
    const resources = [...new Set(rawResources.filter(Boolean))].toSorted();
    if (resources.length === 0) return () => undefined;

    return new Promise<() => void>((resolve, reject) => {
      const request: PendingResourceRequest = {
        id: this.nextId,
        resources,
        resolve,
        reject,
        signal,
      };
      this.nextId += 1;
      request.onAbort = () => {
        const index = this.pending.findIndex((candidate) => candidate.id === request.id);
        if (index < 0) return;
        this.pending.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener('abort', request.onAbort, { once: true });
      this.pending.push(request);
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.pending.length;) {
      const request = this.pending[index];
      if (request.signal?.aborted) {
        this.pending.splice(index, 1);
        request.reject(abortError());
        continue;
      }
      if (request.resources.some((resource) => this.held.has(resource))) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      request.signal?.removeEventListener('abort', request.onAbort!);
      for (const resource of request.resources) this.held.add(resource);
      let released = false;
      request.resolve(() => {
        if (released) return;
        released = true;
        for (const resource of request.resources) this.held.delete(resource);
        this.drain();
      });
    }
  }
}

type CoordinatorGlobal = typeof globalThis & {
  __MASTERSELECTS_AGENT_TIMELINE_RESOURCE_COORDINATOR__?: AnalysisResourceCoordinator;
};

const coordinatorGlobal = globalThis as CoordinatorGlobal;
export const analysisResourceCoordinator =
  coordinatorGlobal.__MASTERSELECTS_AGENT_TIMELINE_RESOURCE_COORDINATOR__
  ?? new AnalysisResourceCoordinator();
coordinatorGlobal.__MASTERSELECTS_AGENT_TIMELINE_RESOURCE_COORDINATOR__ =
  analysisResourceCoordinator;
