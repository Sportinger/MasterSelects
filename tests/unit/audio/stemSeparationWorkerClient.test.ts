import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StemSeparationWorkerClient,
  type StemModelCatalogEntry,
  type StemSeparationWorkerResponse,
} from '../../../src/services/audio/stemSeparation';

function createModel(): StemModelCatalogEntry {
  return {
    id: 'test-stem-model',
    label: 'Test Stem Model',
    modelVersion: 'test-v1',
    description: 'Test model',
    stems: ['drums', 'bass', 'other', 'vocals'],
    inputSampleRate: 44_100,
    outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
    files: [],
    supportedBackends: ['wasm'],
    testedBrowserRuntime: true,
    productionDropdown: true,
  };
}

class FakeWorker {
  onmessage: ((event: MessageEvent<StemSeparationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(message: StemSeparationWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<StemSeparationWorkerResponse>);
  }
}

describe('StemSeparationWorkerClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards worker model-load progress while loading a model by URL', async () => {
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', vi.fn(function WorkerMock() {
      return worker;
    }));
    const client = new StemSeparationWorkerClient();
    const onProgress = vi.fn();

    const load = client.loadModelFromUrl(createModel(), 'https://example.test/model.onnx', { onProgress });
    await Promise.resolve();

    worker.emit({
      type: 'model-load-progress',
      modelId: 'test-stem-model',
      phase: 'loading-model',
      progress: 0.42,
      message: 'Loading test model',
    });
    worker.emit({
      type: 'model-ready',
      modelId: 'test-stem-model',
      backend: 'wasm',
    });

    await expect(load).resolves.toEqual({ modelId: 'test-stem-model', backend: 'wasm' });
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'loading-model',
      progress: 0.42,
      message: 'Loading test model',
    });
  });
});
