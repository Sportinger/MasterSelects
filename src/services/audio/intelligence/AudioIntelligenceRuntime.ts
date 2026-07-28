import { Logger } from '../../logger';
import {
  RuntimeJobClient,
  RuntimeJobClientError,
  type RuntimeWorkerOutboundMessage,
  type RuntimeWorkerTransport,
} from '../../../runtime/worker';
import {
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
  AUDIO_INTELLIGENCE_PROVIDER_ID,
  AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
  AudioIntelligenceError,
  type AudioIntelligenceInitJobInput,
  type AudioIntelligenceInitJobOutput,
  type AudioIntelligenceStageProgress,
  type AudioIntelligenceVadJobInput,
  type AudioIntelligenceVadJobOutput,
} from './audioIntelligenceTypes';
import {
  AUDIO_INTELLIGENCE_MODEL_CACHE_VERSION,
  isModelHashPinned,
  requireAudioIntelligenceModel,
  type AudioIntelligenceModelCatalogEntry,
} from './audioIntelligenceModelCatalog';
import type { VoiceActivityConfig } from './audioIntelligencePayloadTypes';

const log = Logger.create('AudioIntelligence');
const CACHE_NAME = `masterselects-audio-intel-models-${AUDIO_INTELLIGENCE_MODEL_CACHE_VERSION}`;
// Model download has its own progress path; once the bytes reached the worker,
// taking longer than a minute to open the session is a failed runtime start.
const MODEL_INIT_TIMEOUT_MS = 60_000;

interface PrepareOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioIntelligenceStageProgress) => void;
}

function abortError(message = 'Audio intelligence was cancelled.'): AudioIntelligenceError {
  return new AudioIntelligenceError(message, { code: 'cancelled' });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

async function validateModelBuffer(
  model: AudioIntelligenceModelCatalogEntry,
  buffer: ArrayBuffer,
): Promise<void> {
  if (buffer.byteLength !== model.sizeBytes) {
    throw new AudioIntelligenceError(
      `${model.displayName} has an invalid size (${buffer.byteLength} instead of ${model.sizeBytes} bytes).`,
      { code: 'model-unavailable' },
    );
  }
  if (!isModelHashPinned(model)) {
    log.warn('Model hash is not pinned; skipping SHA-256 verification', { modelId: model.id });
    return;
  }
  const actualHash = await sha256(buffer);
  if (actualHash !== model.sha256) {
    throw new AudioIntelligenceError(
      `${model.displayName} failed its SHA-256 integrity check.`,
      { code: 'model-unavailable' },
    );
  }
}

async function loadModelBuffer(
  model: AudioIntelligenceModelCatalogEntry,
  options: PrepareOptions,
): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  const cache = 'caches' in globalThis ? await caches.open(CACHE_NAME) : null;
  const cached = await cache?.match(model.url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    try {
      await validateModelBuffer(model, buffer);
      options.onProgress?.({ stage: 'model', progress: 0.6, message: `Loaded cached ${model.displayName}.` });
      return buffer;
    } catch (error) {
      log.warn('Discarding invalid cached audio intelligence model', {
        modelId: model.id,
        error: errorMessage(error),
      });
      await cache?.delete(model.url);
    }
  }

  options.onProgress?.({ stage: 'model', progress: 0.1, message: `Downloading ${model.displayName}.` });
  let response: Response;
  try {
    response = await fetch(model.url, {
      cache: 'no-store',
      signal: options.signal,
      credentials: 'omit',
    });
  } catch (error) {
    throwIfAborted(options.signal);
    throw new AudioIntelligenceError(
      `Could not download ${model.displayName}: ${errorMessage(error)}`,
      { code: 'model-unavailable', cause: error },
    );
  }
  if (!response.ok) {
    throw new AudioIntelligenceError(
      `Could not download ${model.displayName}: HTTP ${response.status}.`,
      { code: 'model-unavailable' },
    );
  }
  const buffer = await response.arrayBuffer();
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
      log.warn('Audio intelligence model cache write failed; continuing with the downloaded model', error);
    }
  }
  options.onProgress?.({ stage: 'model', progress: 0.6, message: `Downloaded ${model.displayName}.` });
  return buffer;
}

export interface RunVadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioIntelligenceStageProgress) => void;
}

export class AudioIntelligenceRuntime {
  private worker: Worker | null = null;
  private client: RuntimeJobClient | null = null;
  private preparePromise: Promise<void> | null = null;
  private ready = false;

  async prepare(options: PrepareOptions = {}): Promise<void> {
    if (this.ready && this.client) return;
    if (this.preparePromise) return this.preparePromise;

    this.preparePromise = this.prepareInternal(options).finally(() => {
      if (!this.ready) this.preparePromise = null;
    });
    return this.preparePromise;
  }

  // Consumes (transfers) the pcm buffer; callers must pass a Float32Array they
  // own, never an AudioBuffer's live channel data.
  async runVad(
    pcm: Float32Array,
    config: VoiceActivityConfig,
    options: RunVadOptions = {},
  ): Promise<AudioIntelligenceVadJobOutput> {
    throwIfAborted(options.signal);
    await this.prepare(options);
    throwIfAborted(options.signal);
    const client = this.client;
    if (!client) {
      throw new AudioIntelligenceError('Audio intelligence worker is unavailable.', {
        code: 'worker-unavailable',
      });
    }

    const input: AudioIntelligenceVadJobInput = {
      pcm,
      sampleRate: AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
      offsetSeconds: 0,
      config,
    };
    const handle = client.runJob<AudioIntelligenceVadJobInput, AudioIntelligenceVadJobOutput>({
      providerId: AUDIO_INTELLIGENCE_PROVIDER_ID,
      handlerId: AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
      input,
    }, {
      transfer: [pcm.buffer],
      signal: options.signal,
      onEvent: (event: RuntimeWorkerOutboundMessage) => {
        if (event.type === 'runtime.job.progress') {
          options.onProgress?.({
            stage: event.progress.stage ?? 'vad',
            progress: event.progress.value,
            feature: 'vad',
            message: event.progress.message,
          });
        }
      },
    });

    try {
      const result = await handle.promise;
      return result.output;
    } catch (error) {
      if (error instanceof RuntimeJobClientError && error.status === 'cancelled') {
        throw abortError(error.message);
      }
      throw error;
    }
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.preparePromise = null;
  }

  private async prepareInternal(options: PrepareOptions): Promise<void> {
    const model = requireAudioIntelligenceModel('silero-vad');
    options.onProgress?.({ stage: 'model', progress: 0, message: `Preparing ${model.displayName}.` });
    const buffer = await loadModelBuffer(model, options);
    throwIfAborted(options.signal);

    options.onProgress?.({ stage: 'worker', progress: 0.8, message: 'Opening Silero VAD in ONNX Runtime.' });
    const client = this.ensureClient();
    const initInput: AudioIntelligenceInitJobInput = {
      modelId: model.id,
      modelVersion: model.version,
      modelBytes: buffer,
    };
    const handle = client.runJob<AudioIntelligenceInitJobInput, AudioIntelligenceInitJobOutput>({
      providerId: AUDIO_INTELLIGENCE_PROVIDER_ID,
      handlerId: AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
      input: initInput,
    }, {
      transfer: [buffer],
      signal: options.signal,
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        handle.promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new AudioIntelligenceError('Silero VAD model initialization timed out.', {
              code: 'worker-unavailable',
            }));
          }, MODEL_INIT_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.dispose();
      if (error instanceof RuntimeJobClientError && error.status === 'cancelled') {
        throw abortError(error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    this.ready = true;
    options.onProgress?.({ stage: 'worker', progress: 1, message: 'Silero VAD ready.' });
  }

  private ensureClient(): RuntimeJobClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('../../../workers/audioIntelligence.worker.ts', import.meta.url), {
      type: 'module',
      name: 'masterselects-audio-intelligence',
    });
    this.client = new RuntimeJobClient(this.worker as RuntimeWorkerTransport);
    return this.client;
  }
}

let instance: AudioIntelligenceRuntime | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  instance = import.meta.hot.data.audioIntelligenceRuntime as AudioIntelligenceRuntime | undefined ?? null;
  import.meta.hot.dispose((data) => {
    data.audioIntelligenceRuntime = instance;
  });
}

export function getAudioIntelligenceRuntime(): AudioIntelligenceRuntime {
  instance ??= new AudioIntelligenceRuntime();
  return instance;
}
