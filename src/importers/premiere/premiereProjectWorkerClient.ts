import type {
  PremiereExistingMediaDescriptor,
  PremiereProjectImportOptions,
  PremiereProjectImportResult,
} from './premiereProjectTypes';
import type {
  PremiereProjectWorkerRequest,
  PremiereProjectWorkerResponse,
} from './premiereProjectWorkerProtocol';

export function importPremiereProjectInWorker(
  file: File,
  existingMedia: PremiereExistingMediaDescriptor[],
  parentId: string | null,
  options: PremiereProjectImportOptions,
): Promise<PremiereProjectImportResult> {
  if (options.signal?.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./premiereProject.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
      action();
    };
    const handleAbort = () => finish(() => reject(createAbortError()));

    worker.onmessage = (event: MessageEvent<PremiereProjectWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === 'summary') {
        void resolveSequenceSelection(message.summary);
        return;
      }
      if (message.type === 'result') {
        finish(() => resolve(message.result));
        return;
      }
      finish(() => reject(new Error(message.message)));
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Premiere project import worker failed.')));
    };
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    const request: PremiereProjectWorkerRequest = {
      type: 'start',
      file,
      existingMedia,
      parentId,
    };
    worker.postMessage(request);

    async function resolveSequenceSelection(summary: Parameters<NonNullable<typeof options.selectSequences>>[0]) {
      try {
        const selected = options.selectedSequenceUids
          ?? (options.selectSequences ? await options.selectSequences(summary) : undefined);
        if (selected === null) {
          handleAbort();
          return;
        }
        const selectionRequest: PremiereProjectWorkerRequest = {
          type: 'select',
          ...(selected ? { selectedSequenceUids: [...selected] } : {}),
        };
        worker.postMessage(selectionRequest);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    }
  });
}

function createAbortError(): DOMException {
  return new DOMException('Premiere project import was cancelled.', 'AbortError');
}
