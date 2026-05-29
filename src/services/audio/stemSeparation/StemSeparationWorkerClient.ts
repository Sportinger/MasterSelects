import type {
  StemModelCatalogEntry,
  StemModelFileBuffer,
  StemSeparationWorkerBackendPreference,
  StemSeparationBackend,
  StemSeparationInput,
  StemSeparationWorkerRequest,
  StemSeparationWorkerResponse,
  StemSeparationWorkerStemResult,
} from './types';

const MODEL_LOAD_IDLE_TIMEOUT_MS = 180_000;

export interface StemSeparationWorkerLoadResult {
  modelId: string;
  backend: StemSeparationBackend;
}

export interface StemSeparationWorkerProgress {
  phase: string;
  progress: number;
  message?: string;
}

export interface StemSeparationWorkerClientLike {
  loadModel: (
    model: StemModelCatalogEntry,
    modelBuffers: StemModelFileBuffer[],
    options?: StemSeparationWorkerModelLoadOptions,
  ) => Promise<StemSeparationWorkerLoadResult>;
  loadModelFromUrl: (
    model: StemModelCatalogEntry,
    modelUrl: string,
    options?: StemSeparationWorkerModelLoadOptions,
  ) => Promise<StemSeparationWorkerLoadResult>;
  separate: (
    jobId: string,
    input: StemSeparationInput,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: StemSeparationWorkerProgress) => void;
    },
  ) => Promise<StemSeparationWorkerStemResult[]>;
  cancel: (jobId: string) => void;
  dispose: () => void;
}

export interface StemSeparationWorkerModelLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: StemSeparationWorkerProgress) => void;
  backendPreference?: StemSeparationWorkerBackendPreference;
  idleTimeoutMs?: number;
}

interface PendingModelLoad {
  modelId: string;
  resolve: (result: StemSeparationWorkerLoadResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: StemSeparationWorkerProgress) => void;
  resetIdleTimeout: () => void;
  clearIdleTimeout: () => void;
}

interface PendingSeparation {
  resolve: (stems: StemSeparationWorkerStemResult[]) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: StemSeparationWorkerProgress) => void;
}

function createAbortError(message = 'Stem separation was cancelled.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function errorFromMessage(message: string): Error {
  return new Error(message);
}

function getSignalAbortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : createAbortError();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw getSignalAbortError(signal);
  }
}

function createTransferListForInput(input: StemSeparationInput): Transferable[] {
  return input.channels
    .map(channel => channel.buffer)
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}

export class StemSeparationWorkerClient implements StemSeparationWorkerClientLike {
  private worker: Worker | null = null;
  private pendingModelLoad: PendingModelLoad | null = null;
  private readonly pendingSeparations = new Map<string, PendingSeparation>();
  private loadedModelId: string | null = null;
  private loadedBackend: StemSeparationBackend | null = null;

  async loadModel(
    model: StemModelCatalogEntry,
    modelBuffers: StemModelFileBuffer[],
    options: StemSeparationWorkerModelLoadOptions = {},
  ): Promise<StemSeparationWorkerLoadResult> {
    return this.postModelLoadRequest(model, {
      type: 'load-model',
      modelId: model.id,
      modelBuffers,
      backendPreference: options.backendPreference,
    }, {
      signal: options.signal,
      transfer: modelBuffers.map(file => file.buffer),
      onProgress: options.onProgress,
      idleTimeoutMs: options.idleTimeoutMs,
    });
  }

  async loadModelFromUrl(
    model: StemModelCatalogEntry,
    modelUrl: string,
    options: StemSeparationWorkerModelLoadOptions = {},
  ): Promise<StemSeparationWorkerLoadResult> {
    return this.postModelLoadRequest(model, {
      type: 'load-model-url',
      modelId: model.id,
      modelUrl,
      backendPreference: options.backendPreference,
    }, {
      signal: options.signal,
      transfer: [],
      onProgress: options.onProgress,
      idleTimeoutMs: options.idleTimeoutMs,
    });
  }

  private async postModelLoadRequest(
    model: StemModelCatalogEntry,
    message: Extract<StemSeparationWorkerRequest, { type: 'load-model' | 'load-model-url' }>,
    options: {
      signal?: AbortSignal;
      transfer: Transferable[];
      onProgress?: (progress: StemSeparationWorkerProgress) => void;
      idleTimeoutMs?: number;
    },
  ): Promise<StemSeparationWorkerLoadResult> {
    throwIfAborted(options.signal);
    const requestedBackend = message.backendPreference;
    const loadedBackendMatchesRequest = !requestedBackend ||
      requestedBackend === 'auto' ||
      requestedBackend === this.loadedBackend;
    if (this.loadedModelId === model.id && this.loadedBackend && loadedBackendMatchesRequest) {
      return { modelId: model.id, backend: this.loadedBackend };
    }

    await this.ensureWorker();

    return new Promise((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let abort: (() => void) | null = null;
      const clearIdleTimeout = () => {
        if (!idleTimer) return;
        clearTimeout(idleTimer);
        idleTimer = null;
      };
      const removeAbortListener = () => {
        if (abort) {
          options.signal?.removeEventListener('abort', abort);
        }
      };
      const resetIdleTimeout = () => {
        clearIdleTimeout();
        const timeoutMs = options.idleTimeoutMs ?? MODEL_LOAD_IDLE_TIMEOUT_MS;
        idleTimer = setTimeout(() => {
          removeAbortListener();
          this.pendingModelLoad = null;
          this.dispose();
          const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
          reject(errorFromMessage(
            `Stem model runtime did not respond for ${timeoutSeconds}s while loading ${model.label}.`,
          ));
        }, timeoutMs);
      };
      abort = () => {
        clearIdleTimeout();
        this.pendingModelLoad = null;
        this.dispose();
        reject(getSignalAbortError(options.signal));
      };
      options.signal?.addEventListener('abort', abort, { once: true });

      this.pendingModelLoad = {
        modelId: model.id,
        onProgress: options.onProgress,
        resolve: (result) => {
          removeAbortListener();
          clearIdleTimeout();
          resolve(result);
        },
        reject: (error) => {
          removeAbortListener();
          clearIdleTimeout();
          reject(error);
        },
        resetIdleTimeout,
        clearIdleTimeout,
      };
      resetIdleTimeout();
      try {
        this.worker?.postMessage(message, {
          transfer: options.transfer,
        });
      } catch (error) {
        const pending = this.pendingModelLoad;
        this.pendingModelLoad = null;
        pending?.reject(error instanceof Error ? error : errorFromMessage(String(error)));
      }
    });
  }

  async separate(
    jobId: string,
    input: StemSeparationInput,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: StemSeparationWorkerProgress) => void;
    } = {},
  ): Promise<StemSeparationWorkerStemResult[]> {
    throwIfAborted(options.signal);
    await this.ensureWorker();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        this.pendingSeparations.delete(jobId);
        options.signal?.removeEventListener('abort', abort);
        callback();
      };
      const abort = () => {
        this.cancel(jobId);
        finish(() => reject(getSignalAbortError(options.signal)));
      };
      options.signal?.addEventListener('abort', abort, { once: true });

      this.pendingSeparations.set(jobId, {
        onProgress: options.onProgress,
        resolve: (stems) => finish(() => resolve(stems)),
        reject: (error) => finish(() => reject(error)),
      });

      const message: StemSeparationWorkerRequest = {
        type: 'separate',
        jobId,
        input,
      };
      this.worker?.postMessage(message, {
        transfer: createTransferListForInput(input),
      });
    });
  }

  cancel(jobId: string): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'cancel', jobId } satisfies StemSeparationWorkerRequest);
  }

  dispose(): void {
    try {
      this.worker?.postMessage({ type: 'dispose-model' } satisfies StemSeparationWorkerRequest);
    } catch {
      // Ignore disposal races with terminated workers.
    }
    this.worker?.terminate();
    this.worker = null;
    this.pendingModelLoad?.reject(createAbortError('Stem separation worker was disposed.'));
    this.pendingModelLoad = null;
    for (const pending of this.pendingSeparations.values()) {
      pending.reject(createAbortError('Stem separation worker was disposed.'));
    }
    this.pendingSeparations.clear();
    this.loadedModelId = null;
    this.loadedBackend = null;
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker) return;

    this.worker = new Worker(new URL('./stemSeparationWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<StemSeparationWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.rejectAll(errorFromMessage(event.message || 'Stem separation worker failed.'));
      this.dispose();
    };
    this.worker.onmessageerror = () => {
      this.rejectAll(errorFromMessage('Stem separation worker message could not be deserialized.'));
      this.dispose();
    };
  }

  private handleMessage(message: StemSeparationWorkerResponse): void {
    switch (message.type) {
      case 'model-ready':
        this.loadedModelId = message.modelId;
        this.loadedBackend = message.backend;
        if (this.pendingModelLoad?.modelId === message.modelId) {
          const pending = this.pendingModelLoad;
          this.pendingModelLoad = null;
          pending.resolve({ modelId: message.modelId, backend: message.backend });
        }
        break;

      case 'model-load-progress':
        if (this.pendingModelLoad?.modelId === message.modelId) {
          this.pendingModelLoad.resetIdleTimeout();
          this.pendingModelLoad.onProgress?.({
            phase: message.phase,
            progress: message.progress,
            message: message.message,
          });
        }
        break;

      case 'progress':
        this.pendingSeparations.get(message.jobId)?.onProgress?.({
          phase: message.phase,
          progress: message.progress,
          message: message.message,
        });
        break;

      case 'result':
        this.pendingSeparations.get(message.jobId)?.resolve(message.stems);
        break;

      case 'cancelled':
        this.pendingSeparations.get(message.jobId)?.reject(createAbortError());
        break;

      case 'error':
        if (message.jobId) {
          this.pendingSeparations.get(message.jobId)?.reject(errorFromMessage(message.error));
        } else {
          this.pendingModelLoad?.reject(errorFromMessage(message.error));
          this.pendingModelLoad = null;
        }
        break;

      default:
        break;
    }
  }

  private rejectAll(error: Error): void {
    this.pendingModelLoad?.reject(error);
    this.pendingModelLoad = null;
    for (const pending of this.pendingSeparations.values()) {
      pending.reject(error);
    }
    this.pendingSeparations.clear();
  }
}
