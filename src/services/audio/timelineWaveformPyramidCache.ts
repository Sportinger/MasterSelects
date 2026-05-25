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
  pyramid?: TimelineWaveformPyramid;
  audioAnalysisRefs?: MediaFileAudioAnalysisRefs;
}

export interface GenerateTimelineWaveformAnalysisOptions {
  mediaFileId?: string;
  clipAudioStateHash?: string;
  samplesPerSecond?: number;
  onProgress?: (progress: number, partialWaveform: number[]) => void;
  onPyramidProgress?: (progress: WaveformPyramidGenerationProgress) => void;
}

const DEFAULT_LEGACY_SAMPLES_PER_SECOND = 50;
const timelineWaveformPyramidCache = new Map<string, TimelineWaveformPyramid>();
const log = Logger.create('TimelineWaveformPyramid');

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

function generateLegacyWaveformFromBuffer(
  audioBuffer: AudioBuffer,
  samplesPerSecond: number,
  onProgress?: (progress: number, partialWaveform: number[]) => void,
): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const sampleCount = Math.max(200, Math.min(10000, Math.floor(audioBuffer.duration * samplesPerSecond)));
  const blockSize = Math.max(1, Math.floor(channelData.length / sampleCount));
  const samples: number[] = [];
  let runningMax = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * blockSize;
    const end = Math.min(start + blockSize, channelData.length);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
    }

    samples.push(peak);
    runningMax = Math.max(runningMax, peak);

    if (onProgress && (index % Math.max(1, Math.floor(sampleCount / 20)) === 0 || index === sampleCount - 1)) {
      const progress = Math.round(((index + 1) / sampleCount) * 70);
      const normalizedPartial = runningMax > 0
        ? samples.map((sample) => sample / runningMax)
        : samples;
      onProgress(progress, normalizedPartial);
    }
  }

  const max = Math.max(0, ...samples);
  return max > 0 ? samples.map((sample) => clampAbs01(sample / max)) : samples;
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
  const arrayBuffer = await file.arrayBuffer();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const waveform = generateLegacyWaveformFromBuffer(
      audioBuffer,
      options.samplesPerSecond ?? DEFAULT_LEGACY_SAMPLES_PER_SECOND,
      options.onProgress,
    );

    try {
      const hash = await sha256ArrayBuffer(arrayBuffer);
      const mediaFileId = options.mediaFileId ?? `file:${file.name}:${file.size}:${file.lastModified}`;
      const store = createCurrentAudioArtifactStore();
      const generator = new WaveformPyramidGenerator({ artifactStore: store });
      const generated = await generator.generate({
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
        onProgress: options.onPyramidProgress,
      });
      const pyramid = await readTimelineWaveformPyramid(generated.manifest, store);

      primeTimelineWaveformPyramidCache([
        generated.artifact.id,
        generated.artifact.manifestRef.artifactId,
        generated.analysisRef.artifactId,
      ], pyramid);

      return {
        waveform,
        pyramid,
        audioAnalysisRefs: {
          waveformPyramidId: generated.artifact.manifestRef.artifactId,
        },
      };
    } catch (error) {
      log.warn('Waveform pyramid generation failed; using legacy waveform fallback.', error);
      return { waveform };
    }
  } finally {
    await audioContext.close();
  }
}
