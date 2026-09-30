import { sha256ArrayBuffer } from '../../artifacts';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import { Logger } from '../logger';
import type { AudioArtifactStore } from './AudioArtifactStore';
import { AudioDecodeService } from './AudioDecodeService';
import { readLongPcmWavInfo, readLongWavFingerprintBytes } from './longPcmWav';
import { buildPeakDecimatedAudioBuffer } from './longWavPeaksClient';

/** Share of the 0–70 preview progress range spent streaming a long WAV. */
const LONG_WAV_READ_PROGRESS = 60;
import { generateSourceWaveformPreview } from './sourceWaveformPreview';
import { sourceWaveformAnalysisCacheForFile, rememberSourceWaveformAnalysis, getSourceWaveformProjectScope } from './sourceWaveformAnalysisCache';
import { findSavedSourceWaveform, previewSavedSourceWaveform } from './sourceWaveformPersistence';
import { runBackgroundSourceWaveform } from './sourceWaveformJobQueue';
import type { AudioChannelLayout } from './audioArtifactTypes';
import { isAudioAnalysisArtifactStaleForInput } from './audioAnalysisManifestKeys';
import {
  WaveformPyramidGenerator,
  createWaveformPyramidAnalyzerVersion,
  type WaveformPyramidGenerationProgress,
} from './WaveformPyramidGenerator';
import type { WaveformPyramidManifest } from './waveformPyramidManifest';
import { createCurrentAudioArtifactStore } from './currentAudioArtifactStore';
import { readTimelineWaveformPyramid, primeTimelineWaveformPyramidCache } from './timelineWaveformPyramidLoading';
export { createCurrentAudioArtifactStore } from './currentAudioArtifactStore';
export { primeTimelineWaveformPyramidCache, getCachedTimelineWaveformPyramid, evictTimelineWaveformPyramidRefs,
  readTimelineWaveformPyramid, loadTimelineWaveformPyramid, loadTimelineWaveformPyramidArtifact } from './timelineWaveformPyramidLoading';

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
  reuseCompleted?: boolean;
  reusePersisted?: boolean;
  includePartialPreview?: boolean;
  background?: boolean;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, partialWaveform: number[]) => void;
  onPyramidProgress?: (progress: WaveformPyramidGenerationProgress) => void;
}

const DEFAULT_LEGACY_SAMPLES_PER_SECOND = 50;
const DEFAULT_PYRAMID_TIMEOUT_MS = 120_000;
export const SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND = 160;
export const SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES = 32000;
const SOURCE_WAVEFORM_PREVIEW_PROGRESS_MAX = 20;
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

const jobsByProject: WeakMap<object, Map<string, ActiveTimelineWaveformAnalysisJob>> =
  import.meta.hot?.data?.waveformJobs ?? new WeakMap();
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.waveformJobs = jobsByProject; });
  import.meta.hot.accept();
}
const log = Logger.create('TimelineWaveformPyramid');

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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Audio waveform generation cancelled', 'AbortError');
  }
}

function assertCurrentAnalysis(options: GenerateTimelineWaveformAnalysisOptions): void {
  throwIfAborted(options.signal);
  if (options.isCurrent?.() === false) throw new DOMException('Waveform source is no longer active', 'AbortError');
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
    file.type,
    options.reusePersisted === false ? 'regenerate' : 'reuse',
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
  if (parent?.aborted) abortFromParent();

  return {
    signal: controller.signal,
    dispose: () => {
      disposed = true;
      globalThis.clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

export async function generateTimelineWaveformAnalysisForFile(
  file: File,
  options: GenerateTimelineWaveformAnalysisOptions = {},
): Promise<TimelineWaveformAnalysisResult> {
  const jobKey = getTimelineWaveformAnalysisJobKey(file, options);
  assertCurrentAnalysis(options);
  const scope = getSourceWaveformProjectScope();
  const activeTimelineWaveformAnalysisJobs = jobsByProject.get(scope) ?? new Map<string, ActiveTimelineWaveformAnalysisJob>();
  if (!jobsByProject.has(scope)) {
    jobsByProject.set(scope, activeTimelineWaveformAnalysisJobs);
  }
  const completedResults = sourceWaveformAnalysisCacheForFile(file, options.mediaFileId);
  const completed = options.reuseCompleted !== false ? completedResults.get(jobKey) : undefined;
  if (completed) {
    options.onProgress?.(100, completed.waveform);
    return completed;
  }
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
    isCurrent: () => getSourceWaveformProjectScope() === scope && options.isCurrent?.() !== false,
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
    .then(result => {
      // A pyramid failure must remain retryable, rather than caching fallback
      // previews as completed analysis forever.
      if (result.pyramid || options.includePyramid === false) rememberSourceWaveformAnalysis(completedResults, jobKey, result);
      return result;
    })
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
  assertCurrentAnalysis(options);
  if (options.reusePersisted !== false && options.mediaFileId) {
    const store = createCurrentAudioArtifactStore();
    const saved = await findSavedSourceWaveform(file, options.mediaFileId, options.clipAudioStateHash, store);
    assertCurrentAnalysis(options);
    if (saved) {
      try {
        const pyramid = await readTimelineWaveformPyramid(saved.manifest, store);
        const preview = await previewSavedSourceWaveform(pyramid, {
          samplesPerSecond: options.samplesPerSecond ?? DEFAULT_LEGACY_SAMPLES_PER_SECOND,
          maxSamples: options.maxPreviewSamples, signal: options.signal,
        });
        assertCurrentAnalysis(options);
        primeTimelineWaveformPyramidCache([saved.artifact.id, saved.artifact.manifestRef.artifactId], pyramid);
        options.onProgress?.(100, preview.waveform);
        return { ...preview, ...(options.includePyramid === false ? {} : {
          pyramid, audioAnalysisRefs: { waveformPyramidId: saved.artifact.manifestRef.artifactId },
        }) };
      } catch (error) {
        assertCurrentAnalysis(options);
        log.debug('Saved waveform payload unavailable; regenerating source waveform', error);
      }
    }
  }
  const work = () => decodeTimelineWaveformAnalysisForFile(file, options);
  return options.background !== false ? runBackgroundSourceWaveform(work, options.signal) : work();
}

async function decodeTimelineWaveformAnalysisForFile(file: File, options: GenerateTimelineWaveformAnalysisOptions): Promise<TimelineWaveformAnalysisResult> {
  assertCurrentAnalysis(options);
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
    assertCurrentAnalysis(options);
    // Hour-long PCM stems: streamed peak decimation in a worker instead of a multi-GB whole-file decode.
    const longWav = await readLongPcmWavInfo(file);
    if (longWav) {
      const peaks = await buildPeakDecimatedAudioBuffer(file, longWav, {
        signal: options.signal,
        onProgress: (fraction, preview) => options.onProgress?.(Math.round(fraction * LONG_WAV_READ_PROGRESS), preview),
      });
      // Reading dominated; the analysis of the small peak source fills the rest of the preview range.
      return await generateTimelineWaveformAnalysisFromBuffer(file, await readLongWavFingerprintBytes(file), peaks, {
        ...options,
        onProgress: options.onProgress && ((progress, partial) => options.onProgress!(
          progress >= 100 ? 100 : LONG_WAV_READ_PROGRESS + Math.round((Math.min(70, progress) / 70) * (70 - LONG_WAV_READ_PROGRESS)),
          partial,
        )),
      });
    }
    const arrayBuffer = await file.arrayBuffer();
    assertCurrentAnalysis(options);

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeService.decodeAudioBuffer(
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
    } catch (decodeError) {
      const { readIsobmffMetadata } = await import('../mediaMetadata/isobmffMetadata');
      const { MediaAudioRangeReader } = await import('../../engine/audio/exportPipeline/MediaAudioRangeReader');
      const duration = (await readIsobmffMetadata(file))?.duration;
      if (!duration || duration <= 0) throw decodeError;
      const reader = new MediaAudioRangeReader(file);
      try {
        audioBuffer = await reader.read(0, duration);
      } catch {
        throw decodeError;
      } finally {
        reader.dispose();
      }
    }
    assertCurrentAnalysis(options);
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
  const preview = await generateSourceWaveformPreview(
    audioBuffer,
    options.samplesPerSecond ?? DEFAULT_LEGACY_SAMPLES_PER_SECOND,
    options.onProgress,
    options.maxPreviewSamples,
    options.signal,
    options.includePartialPreview !== false,
  );
  assertCurrentAnalysis(options);
  if (options.includePyramid === false) {
    options.onProgress?.(100, preview.waveform);
    return preview;
  }

  try {
    const hash = await sha256ArrayBuffer(arrayBuffer);
    assertCurrentAnalysis(options);
    const mediaFileId = options.mediaFileId ?? `file:${file.name}:${file.size}:${file.lastModified}`;
    const sourceFingerprint = `sha256:${hash}`;
    const store = createCurrentAudioArtifactStore();
    const reusable = options.reusePersisted !== false ? await findReusableSourceWaveformPyramid({
      store,
      mediaFileId,
      sourceFingerprint,
      clipAudioStateHash: options.clipAudioStateHash,
      sampleRate: audioBuffer.sampleRate,
      channelLayout: describeSourceWaveformChannelLayout(audioBuffer.numberOfChannels),
      duration: audioBuffer.duration,
    }) : null;
    assertCurrentAnalysis(options);
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
      onProgress: progress => { assertCurrentAnalysis(options); options.onPyramidProgress?.(progress); },
    });
    generation.catch(() => undefined);
    const generated = await Promise.race([
      generation,
      abortSignalPromise(pyramidSignal.signal),
    ]).finally(() => {
      pyramidSignal.dispose();
    });

    const pyramid = generated.pyramid;
    assertCurrentAnalysis(options);

    primeTimelineWaveformPyramidCache([
      generated.artifact.id,
      generated.artifact.manifestRef.artifactId,
      generated.analysisRef.artifactId,
      generated.manifest.packedPayload?.artifactId,
    ], pyramid);

    return {
      ...preview,
      pyramid,
      audioAnalysisRefs: {
        waveformPyramidId: generated.artifact.manifestRef.artifactId,
      },
    };
  } catch (error) {
    assertCurrentAnalysis(options);
    log.warn('Waveform pyramid generation failed; using legacy waveform fallback.', error);
    return preview;
  }
}
