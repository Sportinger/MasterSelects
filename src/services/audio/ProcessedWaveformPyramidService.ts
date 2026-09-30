import { sha256ArrayBuffer } from '../../artifacts';
import type {
  Keyframe,
  TimelineClip,
} from '../../types';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import { AudioEffectRenderer, type EffectRenderProgress } from '../../engine/audio/AudioEffectRenderer';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { TimeStretchProcessor, type TimeStretchProgress } from '../../engine/audio/TimeStretchProcessor';
import { Logger } from '../logger';
import { generateSourceWaveformPreview } from './sourceWaveformPreview';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from './ClipAudioRenderService';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type { AudioAnalysisArtifact } from './audioArtifactTypes';
import {
  createCurrentAudioArtifactStore,
  primeTimelineWaveformPyramidCache,
} from './timelineWaveformPyramidCache';
import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import {
  createProcessedClipAudioStateHash,
} from './processedWaveformEligibility';
import {
  WaveformPyramidGenerator,
  type WaveformPyramidGenerationProgress,
  type WaveformPyramidGenerationResult,
} from './WaveformPyramidGenerator';

export {
  clipRequiresProcessedWaveformPyramid,
  collectProcessedAnalysisClipAudioEffectInstances,
  collectRenderableClipAudioEditOperations,
  collectRenderableClipAudioEffectInstances,
  createProcessedClipAudioIdentityInput,
  createProcessedClipAudioStateHash,
} from './processedWaveformEligibility';

const log = Logger.create('ProcessedWaveformPyramid');

const DEFAULT_LEGACY_SAMPLES_PER_SECOND = 50;
const PROCESSED_WAVEFORM_DECODER_ID = 'masterselects.processed-audio-graph';
const PROCESSED_WAVEFORM_DECODER_VERSION = '1.0.0';

export type ProcessedWaveformGenerationPhase =
  | 'preparing'
  | 'stem-mix'
  | 'trimming'
  | 'edit-stack'
  | 'spectral-layers'
  | 'reversing'
  | 'muting'
  | 'speed'
  | 'effects'
  | 'waveform'
  | 'complete';

export interface ProcessedWaveformGenerationProgress {
  phase: ProcessedWaveformGenerationPhase;
  percent: number;
  message?: string;
  waveform?: WaveformPyramidGenerationProgress;
  speed?: TimeStretchProgress;
  effects?: EffectRenderProgress;
}

export interface ProcessedWaveformPyramidResult {
  clipAudioStateHash: string;
  waveform: number[];
  pyramid: TimelineWaveformPyramid;
  audioAnalysisRefs: MediaFileAudioAnalysisRefs;
  generated: WaveformPyramidGenerationResult;
  artifact: AudioAnalysisArtifact;
}

export interface GenerateProcessedWaveformPyramidRequest {
  clip: TimelineClip;
  sourceBuffer: AudioBuffer;
  sourceFingerprint: string;
  mediaFileId?: string;
  keyframes?: readonly Keyframe[];
  trackGraphIdentity?: string | null;
  masterGraphIdentity?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: ProcessedWaveformGenerationProgress) => void;
}

export interface ProcessedWaveformPyramidServiceOptions {
  artifactStore?: AudioArtifactStore;
  waveformGenerator?: WaveformPyramidGenerator;
  effectRenderer?: Pick<AudioEffectRenderer, 'renderEffectInstances'>;
  timeStretchProcessor?: Pick<TimeStretchProcessor, 'processConstantSpeed' | 'processWithKeyframes'>;
  extractor?: Pick<AudioExtractor, 'trimBuffer'>;
}

export async function createFileAudioSourceFingerprint(file: File): Promise<string> {
  return `sha256:${await sha256ArrayBuffer(await file.arrayBuffer())}`;
}

function emitProgress(
  onProgress: ((progress: ProcessedWaveformGenerationProgress) => void) | undefined,
  progress: ProcessedWaveformGenerationProgress,
): void {
  onProgress?.(progress);
}

async function generateLegacyWaveformFromBuffer(audioBuffer: AudioBuffer, signal?: AbortSignal): Promise<number[]> {
  const preview = await generateSourceWaveformPreview({
    sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration, length: audioBuffer.length,
    numberOfChannels: 1,
    copyFromChannel: (destination, _channel, offset) => audioBuffer.copyFromChannel(destination, 0, offset),
  }, DEFAULT_LEGACY_SAMPLES_PER_SECOND, undefined, 10000, signal);
  return preview.waveform;
}

export class ProcessedWaveformPyramidService {
  private readonly artifactStore: AudioArtifactStore;
  private readonly waveformGenerator: WaveformPyramidGenerator;
  private readonly clipAudioRenderer: ClipAudioRenderService;

  constructor(options: ProcessedWaveformPyramidServiceOptions = {}) {
    this.artifactStore = options.artifactStore ?? createCurrentAudioArtifactStore();
    this.waveformGenerator = options.waveformGenerator ?? new WaveformPyramidGenerator({
      artifactStore: this.artifactStore,
    });
    this.clipAudioRenderer = new ClipAudioRenderService({
      effectRenderer: options.effectRenderer ?? new AudioEffectRenderer(),
      timeStretchProcessor: options.timeStretchProcessor ?? new TimeStretchProcessor(),
      extractor: options.extractor ?? audioExtractor,
    });
  }

  async generate(
    request: GenerateProcessedWaveformPyramidRequest,
  ): Promise<ProcessedWaveformPyramidResult> {
    const {
      clip,
      sourceBuffer,
      sourceFingerprint,
      keyframes = [],
      trackGraphIdentity,
      masterGraphIdentity,
      signal,
      onProgress,
    } = request;
    const mediaFileId = request.mediaFileId ?? clip.mediaFileId ?? clip.source?.mediaFileId ?? clip.id;
    const clipAudioStateHash = createProcessedClipAudioStateHash(clip, {
      keyframes,
      trackGraphIdentity,
      masterGraphIdentity,
    });

    emitProgress(onProgress, {
      phase: 'preparing',
      percent: 0,
      message: 'Preparing processed waveform render',
    });

    const processedAudio = await this.clipAudioRenderer.render({
      clip,
      sourceBuffer,
      keyframes,
      effectMode: 'analysis-shape',
      onProgress: progress => this.emitClipAudioProgress(onProgress, progress),
    });
    const processedBuffer = processedAudio.buffer;

    emitProgress(onProgress, {
      phase: 'waveform',
      percent: 70,
      message: 'Generating processed waveform pyramid',
    });

    const generated = await this.waveformGenerator.generate({
      kind: 'processed-waveform-pyramid',
      mediaFileId,
      sourceFingerprint,
      buffer: processedBuffer,
      clipAudioStateHash,
      decoderId: PROCESSED_WAVEFORM_DECODER_ID,
      decoderVersion: PROCESSED_WAVEFORM_DECODER_VERSION,
      metadata: {
        sourceClipId: clip.id,
        sourceClipName: clip.name,
        sourceInPoint: clip.inPoint,
        sourceOutPoint: clip.outPoint,
        timelineDuration: clip.duration,
        timelineSpeed: clip.speed ?? 1,
        reversed: clip.reversed === true,
        preservesPitch: clip.preservesPitch !== false,
      },
    }, {
      signal,
      onProgress: waveform => emitProgress(onProgress, {
        phase: 'waveform',
        percent: 70 + Math.round(waveform.percent * 0.28),
        waveform,
        message: waveform.message,
      }),
    });
    const pyramid = generated.pyramid;

    primeTimelineWaveformPyramidCache([
      generated.artifact.id,
      generated.artifact.manifestRef.artifactId,
      generated.analysisRef.artifactId,
    ], pyramid);

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Processed waveform pyramid ready',
    });

    log.debug('Processed waveform pyramid generated', {
      clipId: clip.id,
      mediaFileId,
      clipAudioStateHash,
      artifactId: generated.artifact.id,
    });

    return {
      clipAudioStateHash,
      waveform: await generateLegacyWaveformFromBuffer(processedBuffer, signal),
      pyramid,
      audioAnalysisRefs: {
        processedWaveformPyramidId: generated.artifact.manifestRef.artifactId,
      },
      generated,
      artifact: generated.artifact,
    };
  }

  private emitClipAudioProgress(
    onProgress?: (progress: ProcessedWaveformGenerationProgress) => void,
    progress?: ClipAudioRenderProgress,
  ): void {
    if (!progress) return;
    emitProgress(onProgress, {
      ...progress,
      phase: progress.phase,
      percent: Math.min(69, Math.round(progress.percent * 0.69)),
    });
  }
}
