import { buildPremiereProjectImportResult, summarizePremiereProject } from './premiereProjectBuilder';
import { readPremiereProjectGraph } from './premiereProjectFileParser';
import type { PremiereProjectGraph } from './premiereProjectTypes';
import type {
  PremiereProjectWorkerRequest,
  PremiereProjectWorkerResponse,
} from './premiereProjectWorkerProtocol';

interface PremiereProjectWorkerScope {
  postMessage(message: PremiereProjectWorkerResponse): void;
  onmessage: ((event: MessageEvent<PremiereProjectWorkerRequest>) => void) | null;
}

const workerScope = self as unknown as PremiereProjectWorkerScope;
let graph: PremiereProjectGraph | null = null;
let activeRequest: Extract<PremiereProjectWorkerRequest, { type: 'start' }> | null = null;

workerScope.onmessage = async (event) => {
  try {
    const request = event.data;
    if (request.type === 'start') {
      activeRequest = request;
      graph = await readPremiereProjectGraph(request.file, {
        onProgress: (progress) => workerScope.postMessage({ type: 'progress', progress }),
      });
      workerScope.postMessage({ type: 'summary', summary: summarizePremiereProject(graph) });
      return;
    }
    if (!graph || !activeRequest) throw new Error('Premiere project worker has no parsed project.');
    workerScope.postMessage({
      type: 'progress',
      progress: { phase: 'building', percent: 92, detail: 'Building MasterSelects compositions' },
    });
    const result = buildPremiereProjectImportResult(
      graph,
      activeRequest.file.name,
      activeRequest.existingMedia,
      activeRequest.parentId,
      request.selectedSequenceUids,
    );
    workerScope.postMessage({
      type: 'progress',
      progress: { phase: 'complete', percent: 100, detail: 'Premiere project imported' },
    });
    workerScope.postMessage({ type: 'result', result });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
