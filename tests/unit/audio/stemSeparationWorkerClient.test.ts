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
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(message: StemSeparationWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<StemSeparationWorkerResponse>);
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
  }
}

describe('StemSeparationWorkerClient', () => {
  afterEach(() => {
    vi.useRealTimers();
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

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'load-model-url',
        backendPreference: undefined,
      }),
      { transfer: [] },
    );

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

  it('forwards backend preference when requesting a model load', async () => {
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', vi.fn(function WorkerMock() {
      return worker;
    }));
    const client = new StemSeparationWorkerClient();

    const load = client.loadModelFromUrl(createModel(), 'https://example.test/model.onnx', {
      backendPreference: 'wasm',
    });
    await Promise.resolve();

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'load-model-url',
        backendPreference: 'wasm',
      }),
      { transfer: [] },
    );

    worker.emit({
      type: 'model-ready',
      modelId: 'test-stem-model',
      backend: 'wasm',
    });
    await expect(load).resolves.toEqual({ modelId: 'test-stem-model', backend: 'wasm' });
  });

  it('rejects pending model loads when the worker cannot deserialize a message', async () => {
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', vi.fn(function WorkerMock() {
      return worker;
    }));
    const client = new StemSeparationWorkerClient();

    const load = client.loadModelFromUrl(createModel(), 'https://example.test/model.onnx');
    await Promise.resolve();
    worker.emitMessageError();

    await expect(load).rejects.toThrow('Stem separation worker message could not be deserialized.');
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('times out silent model loads so the service can retry with a fresh worker', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', vi.fn(function WorkerMock() {
      return worker;
    }));
    const client = new StemSeparationWorkerClient();

    const load = client.loadModelFromUrl(createModel(), 'https://example.test/model.onnx', {
      idleTimeoutMs: 250,
    });
    await Promise.resolve();
    const rejection = expect(load).rejects.toThrow(
      'Stem model runtime did not respond for 1s while loading Test Stem Model.',
    );
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(worker.terminate).toHaveBeenCalled();
  });
});
