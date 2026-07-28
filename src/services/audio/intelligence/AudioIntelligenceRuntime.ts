import { Logger } from '../../logger';
import {
  RuntimeJobClient,
  RuntimeJobClientError,
  type RuntimeWorkerOutboundMessage,
  type RuntimeWorkerTransport,
} from '../../../runtime/worker';
import {
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AUDIO_INTELLIGENCE_ALIGNMENT_HANDLER_ID,
  AUDIO_INTELLIGENCE_INIT_HANDLER_ID,
  AUDIO_INTELLIGENCE_LOAD_PCM_HANDLER_ID,
  AUDIO_INTELLIGENCE_PROSODY_HANDLER_ID,
  AUDIO_INTELLIGENCE_PROVIDER_ID,
  AUDIO_INTELLIGENCE_RELEASE_PCM_HANDLER_ID,
  AUDIO_INTELLIGENCE_ROOM_TONE_HANDLER_ID,
  AUDIO_INTELLIGENCE_SPEECH_MARKERS_HANDLER_ID,
  AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
  AudioIntelligenceError,
  type AudioIntelligenceAlignmentJobInput,
  type AudioIntelligenceAlignmentJobOutput,
  type AudioIntelligenceInitJobInput,
  type AudioIntelligenceInitJobOutput,
  type AudioIntelligenceLoadPcmJobInput,
  type AudioIntelligenceLoadPcmJobOutput,
  type AudioIntelligenceProsodyJobInput,
  type AudioIntelligenceProsodyJobOutput,
  type AudioIntelligenceReleasePcmJobInput,
  type AudioIntelligenceReleasePcmJobOutput,
  type AudioIntelligenceRoomToneJobInput,
  type AudioIntelligenceRoomToneJobOutput,
  type AudioIntelligenceSpeechMarkersJobInput,
  type AudioIntelligenceSpeechMarkersJobOutput,
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

interface PrepareFlight {
  promise: Promise<void>;
  controller: AbortController;
  waiterCount: number;
  progressListeners: Set<NonNullable<PrepareOptions['onProgress']>>;
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

export interface RunAudioIntelligenceJobOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioIntelligenceStageProgress) => void;
}

export type RunVadOptions = RunAudioIntelligenceJobOptions;

export class AudioIntelligenceRuntime {
  private worker: Worker | null = null;
  private client: RuntimeJobClient | null = null;
  private prepareFlight: PrepareFlight | null = null;
  private generation = 0;
  private ready = false;

  async prepare(options: PrepareOptions = {}): Promise<void> {
    throwIfAborted(options.signal);
    if (this.ready && this.client) return;
    let flight = this.prepareFlight;
    if (!flight) {
      const generation = this.generation;
      const controller = new AbortController();
      flight = {
        promise: Promise.resolve(),
        controller,
        waiterCount: 0,
        progressListeners: new Set(),
      };
      const currentFlight = flight;
      flight.promise = this.prepareInternal({
        signal: controller.signal,
        onProgress: (progress) => {
          for (const listener of currentFlight.progressListeners) listener(progress);
        },
      }, generation).finally(() => {
        if (this.prepareFlight === currentFlight) this.prepareFlight = null;
      });
      this.prepareFlight = flight;
    }
    return this.waitForPrepare(flight, options);
  }

  // Direct PCM is retained for backwards compatibility. Composite runs load it
  // once and pass the returned token to VAD and every subsequent feature.
  async runVad(
    pcmOrToken: Float32Array | string,
    config: VoiceActivityConfig,
    options: RunVadOptions = {},
  ): Promise<AudioIntelligenceVadJobOutput> {
    const input: AudioIntelligenceVadJobInput = {
      ...(typeof pcmOrToken === 'string' ? { token: pcmOrToken } : { pcm: pcmOrToken }),
      sampleRate: AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
      offsetSeconds: 0,
      config,
    };
    return this.runWorkerJob(
      AUDIO_INTELLIGENCE_VAD_HANDLER_ID,
      input,
      options,
      'vad',
      typeof pcmOrToken === 'string' ? [] : [pcmOrToken.buffer],
    );
  }

  async loadPcm(
    pcm: Float32Array,
    sampleRate = AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
    offsetSeconds = 0,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceLoadPcmJobOutput> {
    return this.runWorkerJob<AudioIntelligenceLoadPcmJobInput, AudioIntelligenceLoadPcmJobOutput>(
      AUDIO_INTELLIGENCE_LOAD_PCM_HANDLER_ID,
      {
        pcm,
        sampleRate,
        offsetSeconds,
      },
      options,
      undefined,
      [pcm.buffer],
    );
  }

  async releasePcm(
    token: string,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceReleasePcmJobOutput> {
    return this.runWorkerJob<
      AudioIntelligenceReleasePcmJobInput,
      AudioIntelligenceReleasePcmJobOutput
    >(AUDIO_INTELLIGENCE_RELEASE_PCM_HANDLER_ID, { token }, options);
  }

  async runAlignment(
    input: AudioIntelligenceAlignmentJobInput,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceAlignmentJobOutput> {
    return this.runWorkerJob(AUDIO_INTELLIGENCE_ALIGNMENT_HANDLER_ID, input, options, 'alignment');
  }

  async runSpeechMarkers(
    input: AudioIntelligenceSpeechMarkersJobInput,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceSpeechMarkersJobOutput> {
    return this.runWorkerJob(
      AUDIO_INTELLIGENCE_SPEECH_MARKERS_HANDLER_ID,
      input,
      options,
      'speech-markers',
    );
  }

  async runProsody(
    input: AudioIntelligenceProsodyJobInput,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceProsodyJobOutput> {
    return this.runWorkerJob(AUDIO_INTELLIGENCE_PROSODY_HANDLER_ID, input, options, 'prosody');
  }

  async runRoomTone(
    input: AudioIntelligenceRoomToneJobInput,
    options: RunAudioIntelligenceJobOptions = {},
  ): Promise<AudioIntelligenceRoomToneJobOutput> {
    return this.runWorkerJob(AUDIO_INTELLIGENCE_ROOM_TONE_HANDLER_ID, input, options, 'room-tone');
  }

  private async runWorkerJob<Input, Output>(
    handlerId: string,
    input: Input,
    options: RunAudioIntelligenceJobOptions,
    feature?: AudioIntelligenceStageProgress['feature'],
    transfer: Transferable[] = [],
  ): Promise<Output> {
    throwIfAborted(options.signal);
    await this.prepare(options);
    throwIfAborted(options.signal);
    const client = this.client;
    if (!client) {
      throw new AudioIntelligenceError('Audio intelligence worker is unavailable.', {
        code: 'worker-unavailable',
      });
    }
    const handle = client.runJob<Input, Output>({
      providerId: AUDIO_INTELLIGENCE_PROVIDER_ID,
      handlerId,
      input,
    }, {
      transfer,
      signal: options.signal,
      onEvent: (event: RuntimeWorkerOutboundMessage) => {
        if (event.type !== 'runtime.job.progress') return;
        options.onProgress?.({
          stage: event.progress.stage ?? handlerId,
          progress: event.progress.value,
          feature,
          message: event.progress.message,
        });
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
    this.generation += 1;
    this.prepareFlight?.controller.abort();
    this.prepareFlight = null;
    this.client?.dispose();
    this.client = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private waitForPrepare(flight: PrepareFlight, options: PrepareOptions): Promise<void> {
    flight.waiterCount += 1;
    const progressListener = options.onProgress
      ? (progress: AudioIntelligenceStageProgress) => options.onProgress?.(progress)
      : null;
    if (progressListener) flight.progressListeners.add(progressListener);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        if (progressListener) flight.progressListeners.delete(progressListener);
        flight.waiterCount -= 1;
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        if (flight.waiterCount === 0) flight.controller.abort();
        try {
          throwIfAborted(options.signal);
        } catch (error) {
          reject(error);
        }
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      flight.promise.then(
        () => {
          if (finish()) resolve();
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  private async prepareInternal(options: PrepareOptions, generation: number): Promise<void> {
    const model = requireAudioIntelligenceModel('silero-vad');
    options.onProgress?.({ stage: 'model', progress: 0, message: `Preparing ${model.displayName}.` });
    const buffer = await loadModelBuffer(model, options);
    throwIfAborted(options.signal);
    if (generation !== this.generation) {
      throw abortError('Audio intelligence prepare was superseded by disposal.');
    }

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
      if (generation === this.generation) {
        this.dispose();
      } else {
        this.disposeClientIfCurrent(client);
      }
      if (error instanceof RuntimeJobClientError && error.status === 'cancelled') {
        throw abortError(error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (generation !== this.generation) {
      this.disposeClientIfCurrent(client);
      throw abortError('Audio intelligence prepare was superseded by disposal.');
    }
    this.ready = true;
    options.onProgress?.({ stage: 'worker', progress: 1, message: 'Silero VAD ready.' });
  }

  private disposeClientIfCurrent(client: RuntimeJobClient): void {
    if (this.client !== client) return;
    client.dispose();
    this.client = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
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
  if (import.meta.hot.data?.audioIntelligenceRuntime) {
    instance = import.meta.hot.data.audioIntelligenceRuntime as AudioIntelligenceRuntime;
  }
  import.meta.hot.dispose((data) => {
    if (data) data.audioIntelligenceRuntime = instance;
  });
}

export function getAudioIntelligenceRuntime(): AudioIntelligenceRuntime {
  instance ??= new AudioIntelligenceRuntime();
  return instance;
}
