import { blobToArrayBuffer, sha256ArrayBuffer } from '../../artifacts';
import { projectFileService } from '../projectFileService';
import { artifactService } from '../project/domains/ArtifactService';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import { Logger } from '../logger';
import { AudioArtifactStore } from './AudioArtifactStore';
import type { AudioArtifactRef } from './audioArtifactTypes';
import {
  WaveformPyramidGenerator,
  type WaveformPyramidGenerationProgress,
} from './WaveformPyramidGenerator';
import {
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
const timelineWaveformPyramidCache = new Map<string, TimelineWaveformPyramid>();
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
  ref: AudioArtifactRef,
  statistic: WaveformStatistic,
): Promise<Float32Array> {
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

export async function readTimelineWaveformPyramid(
  manifest: WaveformPyramidManifest,
  store: AudioArtifactStore,
): Promise<TimelineWaveformPyramid> {
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

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  if (!artifact) return null;

  const manifest = artifact.metadata?.waveformManifest as WaveformPyramidManifest | undefined;
  if (!manifest) return null;

  const pyramid = await readTimelineWaveformPyramid(manifest, store);
  primeTimelineWaveformPyramidCache([refId, artifact.id, artifact.manifestRef.artifactId], pyramid);
  return pyramid;
}

export async function generateTimelineWaveformAnalysisForFile(
  file: File,
  options: GenerateTimelineWaveformAnalysisOptions = {},
): Promise<TimelineWaveformAnalysisResult> {
  const audioContext = new AudioContext();
  throwIfAborted(options.signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(options.signal);

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    throwIfAborted(options.signal);
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
      const store = createCurrentAudioArtifactStore();
      const generator = new WaveformPyramidGenerator({ artifactStore: store });
      const pyramidSignal = createPyramidTimeoutSignal(
        options.signal,
        options.pyramidTimeoutMs ?? DEFAULT_PYRAMID_TIMEOUT_MS,
      );
      const generation = generator.generate({
        mediaFileId,
        sourceFingerprint: `sha256:${hash}`,
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
  } finally {
    await audioContext.close();
  }
}
