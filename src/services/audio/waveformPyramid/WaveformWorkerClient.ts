import type { WaveformWorkerRequest, WaveformWorkerResponse, WaveformWorkerResult } from './waveformWorkerProtocol';
import type { TimelineWaveformPyramid } from '../../../components/timeline/utils/waveformLod';
import type { ClipAudioEditOperation } from '../../../types/audio';
import type { DerivedWaveformClipRange } from './derivedPyramidMath';
import { runWaveformCacheWork } from '../sourceWaveformJobQueue';

interface AnalysisOptions {
  previewSamples?: number;
  bucketSizes?: readonly number[];
  signal?: AbortSignal;
  onPreviewProgress?: (percent: number, waveform: number[]) => void;
  includePartialPreview?: boolean;
  onAnalysisProgress?: (progress: Extract<WaveformWorkerResponse, { type: 'analysis-progress' }>) => void;
  timeoutMs?: number;
}

export interface WaveformPcmSource {
  sampleRate: number; duration: number; length: number; numberOfChannels: number;
  copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, offset: number): void;
}

// Jobs own their workers and terminate them when they settle. Preserve the
// runtime registry through HMR so old jobs retain the same lifecycle owner.
const activeWorkers: Set<Worker> = import.meta.hot?.data?.activeWorkers ?? new Set();
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.activeWorkers = activeWorkers; });
  import.meta.hot.accept();
}

function cancellation(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Waveform analysis cancelled', 'AbortError');
}
function yieldForUi(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
}

/** Pull bounded PCM blocks into a dedicated worker. Never clone an entire
 * multihour AudioBuffer or detach its playback channel buffers.
 */
export function analyzeWaveformInWorker(buffer: WaveformPcmSource, options: AnalysisOptions = {}): Promise<WaveformWorkerResult> {
  return runWaveformWorker({ type: 'start', sampleRate: buffer.sampleRate, duration: buffer.duration,
    length: buffer.length, channelCount: buffer.numberOfChannels,
    previewSamples: options.previewSamples, bucketSizes: [...(options.bucketSizes ?? [])],
    reportPreviewProgress: Boolean(options.onPreviewProgress),
    includePartialPreview: options.includePartialPreview !== false,
  }, options, buffer);
}

export async function decodeWaveformPayloadInWorker(bytes: ArrayBuffer): Promise<WaveformWorkerResult['levels']> {
  return (await runWaveformCacheWork(() => runWaveformWorker({ type: 'decode-payload', bytes }, { timeoutMs: 15_000 }))).levels;
}

export async function deriveWaveformPyramidInWorker(pyramid: TimelineWaveformPyramid, clip: DerivedWaveformClipRange,
  operations: ClipAudioEditOperation[], signal?: AbortSignal): Promise<{ pyramid: TimelineWaveformPyramid; packedPayload?: ArrayBuffer }> {
  const result = await runWaveformWorker({ type: 'derive-pyramid', sampleRate: pyramid.sampleRate, duration: pyramid.duration,
    levels: pyramid.levels.map(({ channels, ...level }) => ({ ...level, channelIndexes: channels.map(channel => channel.channelIndex) })),
    clip, operations,
  }, { signal }, undefined, pyramid);
  if (result.sampleRate === undefined || result.duration === undefined) throw new Error('Derived waveform metadata is missing');
  return { pyramid: { sampleRate: result.sampleRate, duration: result.duration, levels: result.levels }, packedPayload: result.packedPayload };
}

function runWaveformWorker(request: WaveformWorkerRequest, options: AnalysisOptions, buffer?: WaveformPcmSource,
  pyramid?: TimelineWaveformPyramid): Promise<WaveformWorkerResult> {
  if (options.signal?.aborted) return Promise.reject(cancellation(options.signal));
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Waveform analysis requires a Worker'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../workers/waveformAnalysis.worker.ts', import.meta.url), { type: 'module', name: 'waveform-analysis' });
    activeWorkers.add(worker);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      activeWorkers.delete(worker);
    };
    const fail = (error: unknown) => { if (!settled) { cleanup(); reject(error); } };
    const abort = () => fail(cancellation(options.signal));
    if (options.timeoutMs) timeout = setTimeout(() => fail(new DOMException('Waveform worker timed out', 'TimeoutError')), options.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => fail(new Error(event.message || 'Waveform worker failed'));
    worker.onmessageerror = () => fail(new Error('Invalid waveform worker response'));
    worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === 'read-pyramid') {
        void (async () => {
          await yieldForUi();
          if (settled) return;
          const values = pyramid?.levels[message.levelIndex]?.channels[message.channelIndex]?.[message.statistic];
          if (!values) throw new Error('Waveform worker requested an unavailable pyramid channel');
          const samples = new Float32Array(message.length);
          if (values instanceof Float32Array) samples.set(values.subarray(message.offset, message.offset + message.length));
          else for (let index = 0; index < samples.length; index++) samples[index] = values[message.offset + index];
          worker.postMessage({ type: 'pyramid-chunk', levelIndex: message.levelIndex, channelIndex: message.channelIndex,
            statistic: message.statistic, offset: message.offset, samples } satisfies WaveformWorkerRequest, [samples.buffer]);
        })().catch(fail);
      } else if (message.type === 'read') {
        void (async () => {
          await yieldForUi();
          if (settled) return;
          if (!buffer) throw new Error('Waveform worker requested PCM while loading a payload');
          const samples = new Float32Array(message.length);
          buffer.copyFromChannel(samples, message.channelIndex, message.offset);
          worker.postMessage({ type: 'chunk', channelIndex: message.channelIndex, offset: message.offset, samples } satisfies WaveformWorkerRequest, [samples.buffer]);
        })().catch(fail);
      } else if (message.type === 'error') {
        fail(new Error(message.message));
      } else if (message.type === 'complete') {
        cleanup();
        resolve(message.result);
      } else {
        try {
          if (message.type === 'preview-progress') options.onPreviewProgress?.(message.percent, message.waveform);
          else options.onAnalysisProgress?.(message);
        } catch (error) { fail(error); }
      }
    };
    try {
      worker.postMessage(request, request.type === 'decode-payload' ? [request.bytes] : []);
    } catch (error) { fail(error); }
  });
}
