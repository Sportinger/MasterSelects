import { blobToArrayBuffer, sha256ArrayBuffer } from '../../artifacts';
import { projectFileService } from '../projectFileService';
import { artifactService } from '../project/domains/ArtifactService';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import { Logger } from '../logger';
import { AudioArtifactStore } from './AudioArtifactStore';
import { AudioDecodeService } from './AudioDecodeService';
import type { AudioAnalysisArtifact, AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';
import { isAudioAnalysisArtifactStaleForInput } from './audioAnalysisManifestKeys';
import {
  WaveformPyramidGenerator,
  createWaveformPyramidAnalyzerVersion,
  type WaveformPyramidGenerationProgress,
} from './WaveformPyramidGenerator';
import {
  decodeWaveformPyramidPackedPayload,
  decodeWaveformStatPayload,
  type WaveformPyramidManifest,
  type WaveformStatistic,
} from './waveformPyramidManifest';

export interface TimelineWaveformAnalysisResult {
  waveform: number[];
  waveformChannels?: number[][];
  pyramid?: TimelineWaveformPyramid;
  audioAnalysisRefs?: MediaFileAudioAnalysisRefs;
}

export interface GenerateTimelineWaveformAnalysisOptions {
  mediaFileId?: string;
  clipAudioStateHash?: string;
  includePyramid?: boolean;
  pyramidTimeoutMs?: number;
  samplesPerSecond?: number;
  maxPreviewSamples?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, partialWaveform: number[]) => void;
  onPyramidProgress?: (progress: WaveformPyramidGenerationProgress) => void;
}

const DEFAULT_LEGACY_SAMPLES_PER_SECOND = 50;
const DEFAULT_PYRAMID_TIMEOUT_MS = 120_000;
export const SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND = 160;
export const SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES = 32000;
const SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX = 20;
const timelineWaveformPyramidCache = new Map<string, TimelineWaveformPyramid>();
interface TimelineWaveformAnalysisProgressListener {
  onProgress?: GenerateTimelineWaveformAnalysisOptions['onProgress'];
  onPyramidProgress?: GenerateTimelineWaveformAnalysisOptions['onPyramidProgress'];
}

interface ActiveTimelineWaveformAnalysisJob {
  promise: Promise<TimelineWaveformAnalysisResult>;
  listeners: Set<TimelineWaveformAnalysisProgressListener>;
  previewProgress?: number;
  previewWaveform?: number[];
  pyramidProgress?: WaveformPyramidGenerationProgress;
}

const activeTimelineWaveformAnalysisJobs = new Map<string, ActiveTimelineWaveformAnalysisJob>();
const log = Logger.create('TimelineWaveformPyramid');

interface LegacyWaveformPreview {
  waveform: number[];
  waveformChannels?: number[][];
}

function getProjectHandle(): FileSystemDirectoryHandle | null {
  return (
    projectFileService as typeof projectFileService & {
      getProjectHandle?: () => FileSystemDirectoryHandle | null;
    }
  ).getProjectHandle?.() ?? null;
}

function describeSourceWaveformChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) {
    return { kind: 'mono', channelCount, labels: ['M'] };
  }

  if (channelCount === 2) {
    return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  }

  if (channelCount > 2 && channelCount <= 8) {
    return { kind: 'surround', channelCount };
  }

  if (channelCount > 8) {
    return { kind: 'discrete', channelCount };
  }

  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

export function createCurrentAudioArtifactStore(): AudioArtifactStore {
  const projectHandle = getProjectHandle();
  return new AudioArtifactStore(
    projectHandle
      ? artifactService.createStore(projectHandle)
      : artifactService.createIndexedDBStore(),
  );
}

function clampAbs01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.abs(value)));
}

function generateLegacyWaveformPreviewFromBuffer(
  audioBuffer: AudioBuffer,
  samplesPerSecond: number,
  onProgress?: (progress: number, partialWaveform: number[]) => void,
  maxSamples = 10000,
): LegacyWaveformPreview {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleCount = Math.max(200, Math.min(Math.max(200, maxSamples), Math.floor(audioBuffer.duration * samplesPerSecond)));
  const channelSamples: number[][] = Array.from({ length: channelCount }, () => []);
  const aggregateSamples: number[] = new Array(sampleCount).fill(0);
  let runningMax = 0;
  let completedSamples = 0;
  const totalSamples = Math.max(1, sampleCount * channelCount);
  const progressStep = Math.max(1, Math.floor(totalSamples / 20));

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    const blockSize = Math.max(1, Math.floor(channelData.length / sampleCount));
    const samples = channelSamples[channelIndex];

    for (let index = 0; index < sampleCount; index += 1) {
      const start = index * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
      }

      samples.push(peak);
      aggregateSamples[index] = Math.max(aggregateSamples[index] ?? 0, peak);
      runningMax = Math.max(runningMax, peak);
      completedSamples += 1;

      if (onProgress && (completedSamples % progressStep === 0 || completedSamples === totalSamples)) {
        const progress = Math.round((completedSamples / totalSamples) * 70);
        const normalizedPartial = runningMax > 0
          ? aggregateSamples.map((sample) => sample / runningMax)
          : aggregateSamples;
        onProgress(progress, normalizedPartial);
      }
    }
  }

  const max = Math.max(0, ...aggregateSamples);
  if (max <= 0) {
    return {
      waveform: aggregateSamples,
      ...(channelCount > 1 ? { waveformChannels: channelSamples } : {}),
    };
  }

  return {
    waveform: aggregateSamples.map((sample) => clampAbs01(sample / max)),
    ...(channelCount > 1
      ? { waveformChannels: channelSamples.map((samples) => samples.map((sample) => clampAbs01(sample / max))) }
      : {}),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Audio waveform generation cancelled', 'AbortError');
  }
}

function abortSignalPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Audio waveform generation cancelled', 'AbortError'));
      return;
    }

    signal.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('Audio waveform generation cancelled', 'AbortError'));
    }, { once: true });
  });
}

export function mapSourceWaveformPreviewProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const normalizedPreview = Math.max(0, Math.min(70, progress)) / 70;
  return Math.round(normalizedPreview * SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX);
}

export function mapSourceWaveformPyramidProgress(progress: WaveformPyramidGenerationProgress): number {
  if (progress.phase === 'complete') return 99;
  if (progress.phase === 'queued') return SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX;

  const normalizedPyramid = Math.max(0, Math.min(100, progress.percent)) / 100;
  const mapped = SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX
    + normalizedPyramid * (99 - SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX);
  return Math.max(SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX, Math.min(99, Math.round(mapped)));
}

function getTimelineWaveformAnalysisJobKey(
  file: File,
  options: GenerateTimelineWaveformAnalysisOptions,
): string {
  return [
    options.includePyramid === false ? 'preview' : 'pyramid',
    options.mediaFileId ?? 'no-media-id',
    options.clipAudioStateHash ?? 'source',
    file.name,
    file.size,
    file.lastModified,
    options.samplesPerSecond ?? DEFAULT_LEGACY_SAMPLES_PER_SECOND,
    options.maxPreviewSamples ?? 'default',
  ].join(':');
}

function replayTimelineWaveformAnalysisProgress(
  activeJob: ActiveTimelineWaveformAnalysisJob,
  listener: TimelineWaveformAnalysisProgressListener,
): void {
  if (activeJob.previewProgress !== undefined && activeJob.previewWaveform) {
    listener.onProgress?.(activeJob.previewProgress, activeJob.previewWaveform);
  }
  if (activeJob.pyramidProgress) {
    listener.onPyramidProgress?.(activeJob.pyramidProgress);
  }
}

function addTimelineWaveformAnalysisListener(
  activeJob: ActiveTimelineWaveformAnalysisJob,
  options: GenerateTimelineWaveformAnalysisOptions,
): () => void {
  const listener: TimelineWaveformAnalysisProgressListener = {
    onProgress: options.onProgress,
    onPyramidProgress: options.onPyramidProgress,
  };

  if (!listener.onProgress && !listener.onPyramidProgress) {
    return () => undefined;
  }

  activeJob.listeners.add(listener);
  replayTimelineWaveformAnalysisProgress(activeJob, listener);
  return () => {
    activeJob.listeners.delete(listener);
  };
}

function createPyramidTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  let disposed = false;
  const timeout = globalThis.setTimeout(() => {
    if (!disposed && !controller.signal.aborted) {
      controller.abort(new DOMException('Audio waveform pyramid generation timed out', 'TimeoutError'));
    }
  }, Math.max(1000, timeoutMs));

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parent?.reason ?? new DOMException('Audio waveform generation cancelled', 'AbortError'));
    }
  };
  parent?.addEventListener('abort', abortFromParent, { once: true });

  return {
    signal: controller.signal,
    dispose: () => {
      disposed = true;
      globalThis.clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function decodeStatPayload(
  store: AudioArtifactStore,
  ref: AudioArtifactRef | undefined,
  statistic: WaveformStatistic,
): Promise<Float32Array> {
  if (!ref) {
    throw new Error(`Missing waveform ${statistic} payload ref.`);
  }

  const payload = await store.getPayload(ref.artifactId);
  if (!payload) {
    throw new Error(`Missing waveform ${statistic} payload: ${ref.artifactId}`);
  }

  const decoded = decodeWaveformStatPayload(await blobToArrayBuffer(payload));
  if (decoded.header.statistic !== statistic) {
    throw new Error(`Waveform payload statistic mismatch: expected ${statistic}, got ${decoded.header.statistic}`);
  }

  return decoded.values;
}

async function readPackedTimelineWaveformPyramid(
  manifest: WaveformPyramidManifest,
  store: AudioArtifactStore,
): Promise<TimelineWaveformPyramid | null> {
  if (!manifest.packedPayload) {
    return null;
  }

  const payload = await store.getPayload(manifest.packedPayload.artifactId);
  if (!payload) {
    throw new Error(`Missing packed waveform pyramid payload: ${manifest.packedPayload.artifactId}`);
  }

  const decoded = decodeWaveformPyramidPackedPayload(await blobToArrayBuffer(payload));
  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    levels: decoded.levels,
  };
}

export function primeTimelineWaveformPyramidCache(
  keys: Array<string | undefined>,
  pyramid: TimelineWaveformPyramid,
): void {
  for (const key of keys) {
    if (key) {
      timelineWaveformPyramidCache.set(key, pyramid);
    }
  }
}

export function getCachedTimelineWaveformPyramid(
  key: string | undefined,
): TimelineWaveformPyramid | null {
  return key ? timelineWaveformPyramidCache.get(key) ?? null : null;
}

export function evictTimelineWaveformPyramidRefs(
  keys: Iterable<string | undefined>,
): number {
  let removed = 0;
  for (const key of keys) {
    if (key && timelineWaveformPyramidCache.delete(key)) {
      removed += 1;
    }
  }
  return removed;
}

export async function readTimelineWaveformPyramid(
  manifest: WaveformPyramidManifest,
  store: AudioArtifactStore,
): Promise<TimelineWaveformPyramid> {
  const packed = await readPackedTimelineWaveformPyramid(manifest, store);
  if (packed) {
    return packed;
  }

  const levels = await Promise.all(manifest.levels.map(async (level) => ({
    samplesPerBucket: level.samplesPerBucket,
    bucketDuration: level.bucketDuration,
    bucketCount: level.bucketCount,
    channels: await Promise.all(level.channels.map(async (channel) => ({
      channelIndex: channel.channelIndex,
      min: await decodeStatPayload(store, channel.min, 'min'),
      max: await decodeStatPayload(store, channel.max, 'max'),
      rms: await decodeStatPayload(store, channel.rms, 'rms'),
      peak: await decodeStatPayload(store, channel.peak, 'peak'),
    }))),
  })));

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    levels,
  };
}

export async function loadTimelineWaveformPyramid(
  refId: string | undefined,
): Promise<TimelineWaveformPyramid | null> {
  const cached = getCachedTimelineWaveformPyramid(refId);
  if (cached || !refId) return cached;
  return (await loadTimelineWaveformPyramidArtifact(refId))?.pyramid ?? null;
}

export async function loadTimelineWaveformPyramidArtifact(
  refId: string | undefined,
): Promise<{
  pyramid: TimelineWaveformPyramid;
  artifact: AudioAnalysisArtifact;
} | null> {
  const cached = getCachedTimelineWaveformPyramid(refId);
  if (!refId) return null;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  if (!artifact) return null;

  const manifest = artifact.metadata?.waveformManifest as WaveformPyramidManifest | undefined;
  if (!manifest) return null;

  const pyramid = cached ?? await readTimelineWaveformPyramid(manifest, store);
  primeTimelineWaveformPyramidCache([refId, artifact.id, artifact.manifestRef.artifactId], pyramid);
  return { pyramid, artifact };
}

export async function generateTimelineWaveformAnalysisForFile(
  file: File,
  options: GenerateTimelineWaveformAnalysisOptions = {},
): Promise<TimelineWaveformAnalysisResult> {
  const jobKey = getTimelineWaveformAnalysisJobKey(file, options);
  const activeJob = activeTimelineWaveformAnalysisJobs.get(jobKey);
  if (activeJob) {
    const disposeListener = addTimelineWaveformAnalysisListener(activeJob, options);
    const result = await (options.signal
      ? Promise.race([activeJob.promise, abortSignalPromise(options.signal)])
      : activeJob.promise).finally(disposeListener);
    options.onProgress?.(100, result.waveform);
    return result;
  }

  const nextJob: ActiveTimelineWaveformAnalysisJob = {
    promise: Promise.resolve({ waveform: [] }),
    listeners: new Set(),
  };
  addTimelineWaveformAnalysisListener(nextJob, options);

  const wrappedOptions: GenerateTimelineWaveformAnalysisOptions = {
    ...options,
    onProgress: (progress, partialWaveform) => {
      nextJob.previewProgress = progress;
      nextJob.previewWaveform = partialWaveform;
      nextJob.listeners.forEach(listener => listener.onProgress?.(progress, partialWaveform));
    },
    onPyramidProgress: (progress) => {
      nextJob.pyramidProgress = progress;
      nextJob.listeners.forEach(listener => listener.onPyramidProgress?.(progress));
    },
  };

  nextJob.promise = generateTimelineWaveformAnalysisForFileUncached(file, wrappedOptions)
    .finally(() => {
      activeTimelineWaveformAnalysisJobs.delete(jobKey);
      nextJob.listeners.clear();
    });
  activeTimelineWaveformAnalysisJobs.set(jobKey, nextJob);
  return nextJob.promise;
}

async function findReusableSourceWaveformPyramid(input: {
  store: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
}): Promise<{
  pyramid: TimelineWaveformPyramid;
  audioAnalysisRefs: MediaFileAudioAnalysisRefs;
} | null> {
  const analyzerVersion = createWaveformPyramidAnalyzerVersion();
  const candidates = await input.store.listAnalysisArtifacts(input.mediaFileId, 'waveform-pyramid');
  const expectedInput = {
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    kind: 'waveform-pyramid' as const,
    analyzerVersion,
    channelLayout: input.channelLayout,
    sampleRate: input.sampleRate,
    duration: input.duration,
    clipAudioStateHash: input.clipAudioStateHash,
  };
  const artifact = candidates.find(candidate => (
    !isAudioAnalysisArtifactStaleForInput(candidate, expectedInput)
    && Boolean(candidate.metadata?.waveformManifest)
  ));

  const manifest = artifact?.metadata?.waveformManifest as WaveformPyramidManifest | undefined;
  if (!artifact || !manifest) return null;

  const pyramid = await readTimelineWaveformPyramid(manifest, input.store);
  primeTimelineWaveformPyramidCache([
    artifact.id,
    artifact.manifestRef.artifactId,
  ], pyramid);

  return {
    pyramid,
    audioAnalysisRefs: {
      waveformPyramidId: artifact.manifestRef.artifactId,
    },
  };
}

async function generateTimelineWaveformAnalysisForFileUncached(
  file: File,
  options: GenerateTimelineWaveformAnalysisOptions = {},
): Promise<TimelineWaveformAnalysisResult> {
  // One AudioContext per source waveform job, created synchronously when the
  // job starts: later callers join the active job and share this context,
  // and it is closed when the job settles (decode-service dispose below).
  const audioContext = new AudioContext();
  const decodeService = new AudioDecodeService({
    limits: {
      maxSourceBytes: Number.MAX_SAFE_INTEGER,
      maxDecodedPcmBytes: Number.MAX_SAFE_INTEGER,
    },
    createAudioContext: () => audioContext,
  });
  try {
    throwIfAborted(options.signal);
    const arrayBuffer = await file.arrayBuffer();
    throwIfAborted(options.signal);

    const audioBuffer = await decodeService.decodeAudioBuffer(
      {
        kind: 'array-buffer',
        arrayBuffer,
        name: file.name,
        mimeType: file.type || undefined,
      },
      {
        mediaFileId: options.mediaFileId ?? `file:${file.name}:${file.size}:${file.lastModified}`,
        sourceFingerprint: `file:${file.name}:${file.size}:${file.lastModified}`,
        clipAudioStateHash: options.clipAudioStateHash,
        signal: options.signal,
        metadata: {
          source: 'timeline-waveform-pyramid',
          sourceFileName: file.name,
          sourceFileSize: file.size,
          sourceLastModified: file.lastModified,
        },
      },
    );
    throwIfAborted(options.signal);
    return await generateTimelineWaveformAnalysisFromBuffer(file, arrayBuffer, audioBuffer, options);
  } finally {
    decodeService.dispose();
  }
}

async function generateTimelineWaveformAnalysisFromBuffer(
  file: File,
  arrayBuffer: ArrayBuffer,
  audioBuffer: AudioBuffer,
  options: GenerateTimelineWaveformAnalysisOptions,
): Promise<TimelineWaveformAnalysisResult> {
  const preview = generateLegacyWaveformPreviewFromBuffer(
    audioBuffer,
    options.samplesPerSecond ?? DEFAULT_LEGACY_SAMPLES_PER_SECOND,
    options.onProgress,
    options.maxPreviewSamples,
  );
  if (options.includePyramid === false) {
    options.onProgress?.(100, preview.waveform);
    return preview;
  }

  try {
    const hash = await sha256ArrayBuffer(arrayBuffer);
    throwIfAborted(options.signal);
    const mediaFileId = options.mediaFileId ?? `file:${file.name}:${file.size}:${file.lastModified}`;
    const sourceFingerprint = `sha256:${hash}`;
    const store = createCurrentAudioArtifactStore();
    const reusable = await findReusableSourceWaveformPyramid({
      store,
      mediaFileId,
      sourceFingerprint,
      clipAudioStateHash: options.clipAudioStateHash,
      sampleRate: audioBuffer.sampleRate,
      channelLayout: describeSourceWaveformChannelLayout(audioBuffer.numberOfChannels),
      duration: audioBuffer.duration,
    });
    if (reusable) {
      options.onProgress?.(100, preview.waveform);
      return {
        ...preview,
        pyramid: reusable.pyramid,
        audioAnalysisRefs: reusable.audioAnalysisRefs,
      };
    }

    const generator = new WaveformPyramidGenerator({ artifactStore: store });
    const pyramidSignal = createPyramidTimeoutSignal(
      options.signal,
      options.pyramidTimeoutMs ?? DEFAULT_PYRAMID_TIMEOUT_MS,
    );
    const generation = generator.generate({
      mediaFileId,
      sourceFingerprint,
      buffer: audioBuffer,
      clipAudioStateHash: options.clipAudioStateHash,
      decoderId: 'browser-audio-context',
      decoderVersion: '1.0.0',
      metadata: {
        sourceFileName: file.name,
        sourceFileSize: file.size,
        sourceLastModified: file.lastModified,
      },
    }, {
      signal: pyramidSignal.signal,
      onProgress: options.onPyramidProgress,
    });
    generation.catch(() => undefined);
    const generated = await Promise.race([
      generation,
      abortSignalPromise(pyramidSignal.signal),
    ]).finally(() => {
      pyramidSignal.dispose();
    });

    const pyramid = await readTimelineWaveformPyramid(generated.manifest, store);

    primeTimelineWaveformPyramidCache([
      generated.artifact.id,
      generated.artifact.manifestRef.artifactId,
      generated.analysisRef.artifactId,
    ], pyramid);

    return {
      ...preview,
      pyramid,
      audioAnalysisRefs: {
        waveformPyramidId: generated.artifact.manifestRef.artifactId,
      },
    };
  } catch (error) {
    log.warn('Waveform pyramid generation failed; using legacy waveform fallback.', error);
    return preview;
  }
}
