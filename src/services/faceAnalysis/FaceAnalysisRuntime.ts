import { Logger } from '../logger';
import type { FaceAnalysisBackend } from '../../types/clipMetadata';
import { FACE_ANALYSIS_MODEL_VERSION, FACE_MODEL_CATALOG, type FaceModelCatalogEntry } from './modelCatalog';
import type {
  FaceModelLoadProgress,
  FaceRuntimeDetection,
  FaceWorkerRequest,
  FaceWorkerResponse,
} from './types';

const log = Logger.create('FaceAnalysisRuntime');
const CACHE_NAME = `masterselects-face-models-${FACE_ANALYSIS_MODEL_VERSION}`;
const FRAME_TIMEOUT_MS = 60_000;
const MODEL_INIT_TIMEOUT_MS = 180_000;

interface PendingFrame {
  resolve: (detections: FaceRuntimeDetection[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PrepareOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FaceModelLoadProgress) => void;
}

function abortError(message = 'Face analysis was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): ArrayBuffer {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

async function validateModelBuffer(
  model: FaceModelCatalogEntry,
  buffer: ArrayBuffer,
): Promise<void> {
  if (buffer.byteLength !== model.sizeBytes) {
    throw new Error(
      `${model.displayName} has an invalid size (${buffer.byteLength} instead of ${model.sizeBytes} bytes).`,
    );
  }
  const actualHash = await sha256(buffer);
  if (actualHash !== model.sha256) {
    throw new Error(`${model.displayName} failed its SHA-256 integrity check.`);
  }
}

async function readResponseWithProgress(
  response: Response,
  model: FaceModelCatalogEntry,
  completedBytes: number,
  totalBytes: number,
  onProgress?: PrepareOptions['onProgress'],
): Promise<ArrayBuffer> {
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloadedBytes += value.byteLength;
      onProgress?.({
        progress: Math.min(0.9, (completedBytes + downloadedBytes) / totalBytes),
        message: `Downloading ${model.displayName}: ${Math.round(downloadedBytes / 1_000_000)} MB / ${Math.round(model.sizeBytes / 1_000_000)} MB`,
      });
    }
  } finally {
    reader.releaseLock();
  }
  return concatChunks(chunks, downloadedBytes);
}

async function loadModelBuffer(
  model: FaceModelCatalogEntry,
  completedBytes: number,
  totalBytes: number,
  options: PrepareOptions,
): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  const cache = 'caches' in globalThis ? await caches.open(CACHE_NAME) : null;
  const cached = await cache?.match(model.url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    try {
      await validateModelBuffer(model, buffer);
      options.onProgress?.({
        progress: Math.min(0.9, (completedBytes + model.sizeBytes) / totalBytes),
        message: `Loaded cached ${model.displayName}.`,
      });
      return buffer;
    } catch (error) {
      log.warn('Discarding invalid cached face model', { modelId: model.id, error: errorMessage(error) });
      await cache?.delete(model.url);
    }
  }

  let response: Response;
  try {
    response = await fetch(model.url, {
      cache: 'no-store',
      signal: options.signal,
      credentials: 'omit',
    });
  } catch (error) {
    throw new Error(`Could not download ${model.displayName}: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Could not download ${model.displayName}: HTTP ${response.status}.`);
  }
  const buffer = await readResponseWithProgress(
    response,
    model,
    completedBytes,
    totalBytes,
    options.onProgress,
  );
  throwIfAborted(options.signal);
  await validateModelBuffer(model, buffer);
  if (cache) {
    try {
      await cache.put(model.url, new Response(buffer.slice(0), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buffer.byteLength),
          'X-MasterSelects-SHA256': model.sha256,
        },
      }));
    } catch (error) {
      log.warn('Face model cache write failed; continuing with the downloaded model', error);
    }
  }
  return buffer;
}

export class FaceAnalysisRuntime {
  private worker: Worker | null = null;
  private backend: FaceAnalysisBackend | null = null;
  private preparePromise: Promise<FaceAnalysisBackend> | null = null;
  private pendingInitialize: {
    resolve: (backend: FaceAnalysisBackend) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    cleanup: () => void;
  } | null = null;
  private readonly pendingFrames = new Map<string, PendingFrame>();
  private requestIndex = 0;

  async prepare(options: PrepareOptions = {}): Promise<FaceAnalysisBackend> {
    if (this.backend) return this.backend;
    if (this.preparePromise) return this.preparePromise;

    this.preparePromise = this.prepareInternal(options).finally(() => {
      if (!this.backend) this.preparePromise = null;
    });
    return this.preparePromise;
  }

  async analyzeFrame(
    imageData: ImageData,
    signal?: AbortSignal,
  ): Promise<FaceRuntimeDetection[]> {
    throwIfAborted(signal);
    await this.prepare({ signal });
    throwIfAborted(signal);
    if (!this.worker) throw new Error('Face analysis worker is unavailable.');

    const requestId = `face-frame-${++this.requestIndex}`;
    const rgba = imageData.data.slice().buffer;
    return new Promise<FaceRuntimeDetection[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingFrames.delete(requestId);
        reject(new Error('YuNet + SFace inference timed out.'));
      }, FRAME_TIMEOUT_MS);
      const onAbort = () => {
        const pending = this.pendingFrames.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingFrames.delete(requestId);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingFrames.set(requestId, {
        resolve: (detections) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(detections);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        timeout,
      });
      this.worker?.postMessage({
        type: 'analyze-frame',
        requestId,
        rgba,
        width: imageData.width,
        height: imageData.height,
      } satisfies FaceWorkerRequest, { transfer: [rgba] });
    });
  }

  getBackend(): FaceAnalysisBackend | null {
    return this.backend;
  }

  dispose(): void {
    try {
      this.worker?.postMessage({ type: 'dispose' } satisfies FaceWorkerRequest);
    } catch {
      // Worker may already be gone.
    }
    this.worker?.terminate();
    this.worker = null;
    this.backend = null;
    this.preparePromise = null;
    const error = abortError('Face analysis runtime was disposed.');
    if (this.pendingInitialize) {
      clearTimeout(this.pendingInitialize.timeout);
      this.pendingInitialize.cleanup();
      this.pendingInitialize.reject(error);
    }
    this.pendingInitialize = null;
    for (const pending of this.pendingFrames.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingFrames.clear();
  }

  private async prepareInternal(options: PrepareOptions): Promise<FaceAnalysisBackend> {
    options.onProgress?.({ progress: 0, message: 'Preparing YuNet + SFace models.' });
    const totalBytes = FACE_MODEL_CATALOG.reduce((sum, model) => sum + model.sizeBytes, 0);
    const buffers: ArrayBuffer[] = [];
    let completedBytes = 0;
    for (const model of FACE_MODEL_CATALOG) {
      const buffer = await loadModelBuffer(model, completedBytes, totalBytes, options);
      buffers.push(buffer);
      completedBytes += model.sizeBytes;
    }
    throwIfAborted(options.signal);
    options.onProgress?.({ progress: 0.92, message: 'Opening YuNet + SFace in ONNX Runtime.' });
    this.ensureWorker();

    const backend = await new Promise<FaceAnalysisBackend>((resolve, reject) => {
      const onAbort = () => this.failWorker(abortError());
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => {
        this.failWorker(new Error('YuNet + SFace model initialization timed out.'));
      }, MODEL_INIT_TIMEOUT_MS);
      this.pendingInitialize = {
        resolve,
        reject,
        timeout,
        cleanup: () => options.signal?.removeEventListener('abort', onAbort),
      };
      this.worker?.postMessage({
        type: 'initialize',
        yunetBuffer: buffers[0]!,
        sfaceBuffer: buffers[1]!,
        preferWebGpu: true,
      } satisfies FaceWorkerRequest, { transfer: buffers });
    });
    options.onProgress?.({ progress: 1, message: `YuNet + SFace ready (${backend}).` });
    return backend;
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('./faceAnalysisWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FaceWorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      this.failWorker(new Error(event.message || 'YuNet + SFace worker crashed.'));
    };
    this.worker.onmessageerror = () => {
      this.failWorker(new Error('YuNet + SFace worker returned an unreadable message.'));
    };
  }

  private handleMessage(message: FaceWorkerResponse): void {
    if (message.type === 'ready') {
      this.backend = message.backend;
      if (this.pendingInitialize) {
        clearTimeout(this.pendingInitialize.timeout);
        this.pendingInitialize.cleanup();
        this.pendingInitialize.resolve(message.backend);
      }
      this.pendingInitialize = null;
      return;
    }
    if (message.type === 'result') {
      const pending = this.pendingFrames.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingFrames.delete(message.requestId);
      pending.resolve(message.detections);
      return;
    }

    const error = new Error(`YuNet + SFace: ${message.error}`);
    if (message.requestId) {
      const pending = this.pendingFrames.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingFrames.delete(message.requestId);
      pending.reject(error);
      return;
    }
    if (this.pendingInitialize) {
      clearTimeout(this.pendingInitialize.timeout);
      this.pendingInitialize.cleanup();
      this.pendingInitialize.reject(error);
    }
    this.pendingInitialize = null;
  }

  private failWorker(error: Error): void {
    if (this.pendingInitialize) {
      clearTimeout(this.pendingInitialize.timeout);
      this.pendingInitialize.cleanup();
      this.pendingInitialize.reject(error);
    }
    this.pendingInitialize = null;
    for (const pending of this.pendingFrames.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingFrames.clear();
    this.worker?.terminate();
    this.worker = null;
    this.backend = null;
    this.preparePromise = null;
  }
}

let instance: FaceAnalysisRuntime | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  instance = import.meta.hot.data.faceAnalysisRuntime as FaceAnalysisRuntime | undefined ?? null;
  import.meta.hot.dispose((data) => {
    data.faceAnalysisRuntime = instance;
  });
}

export function getFaceAnalysisRuntime(): FaceAnalysisRuntime {
  instance ??= new FaceAnalysisRuntime();
  return instance;
}
