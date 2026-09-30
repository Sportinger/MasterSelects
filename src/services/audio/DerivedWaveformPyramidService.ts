import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type { AudioAnalysisArtifact } from './audioArtifactTypes';
import { previewSavedSourceWaveform } from './sourceWaveformPersistence';
import { isDerivableEditOperation } from './waveformPyramid/derivedPyramidMath';
import { deriveWaveformPyramidInWorker } from './waveformPyramid/WaveformWorkerClient';
import { runBackgroundWaveformDerivation } from './sourceWaveformJobQueue';
import {
  createCurrentAudioArtifactStore,
  primeTimelineWaveformPyramidCache,
} from './timelineWaveformPyramidCache';
import {
  collectProcessedAnalysisClipAudioEffectInstances,
  collectRenderableClipAudioEditOperations,
  createProcessedClipAudioStateHash,
} from './processedWaveformEligibility';
import {
  WaveformPyramidGenerator,
  type WaveformPyramidGenerationProgress,
  type WaveformPyramidGenerationResult,
} from './WaveformPyramidGenerator';

const DERIVED_PROCESSED_WAVEFORM_GENERATOR_VERSION = 'masterselects.derived-processed-waveform-pyramid@1.0.0';
const DERIVED_PROCESSED_WAVEFORM_DECODER_ID = 'masterselects.derived-waveform-pyramid';
const DERIVED_PROCESSED_WAVEFORM_DECODER_VERSION = '1.0.0';

export type DerivedProcessedWaveformGenerationPhase =
  | 'preparing'
  | 'deriving'
  | 'storing'
  | 'complete';

export interface DerivedProcessedWaveformGenerationProgress {
  phase: DerivedProcessedWaveformGenerationPhase;
  percent: number;
  message?: string;
  waveform?: WaveformPyramidGenerationProgress;
}

export interface DerivedProcessedWaveformPyramidRequest {
  clip: TimelineClip;
  sourcePyramid: TimelineWaveformPyramid;
  sourceFingerprint: string;
  mediaFileId?: string;
  keyframes?: readonly Keyframe[];
  signal?: AbortSignal;
  onProgress?: (progress: DerivedProcessedWaveformGenerationProgress) => void;
}

export interface DerivedProcessedWaveformPyramidResult {
  clipAudioStateHash: string;
  waveform: number[];
  pyramid: TimelineWaveformPyramid;
  audioAnalysisRefs: MediaFileAudioAnalysisRefs;
  generated: WaveformPyramidGenerationResult;
  artifact: AudioAnalysisArtifact;
}

export interface DerivedProcessedWaveformPyramidServiceOptions {
  artifactStore?: AudioArtifactStore;
  waveformGenerator?: WaveformPyramidGenerator;
}

function emitProgress(
  onProgress: ((progress: DerivedProcessedWaveformGenerationProgress) => void) | undefined,
  progress: DerivedProcessedWaveformGenerationProgress,
): void {
  onProgress?.(progress);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Derived processed waveform generation cancelled.', 'AbortError');
  }
}

function hasEnabledSpectralLayer(clip: TimelineClip): boolean {
  return (clip.audioState?.spectralLayers ?? []).some(layer => layer.enabled !== false);
}

function hasSpeedProcessing(clip: TimelineClip, keyframes: readonly Keyframe[]): boolean {
  return Math.abs((clip.speed ?? 1) - 1) > 0.001 ||
    keyframes.some(keyframe => keyframe.property === 'speed');
}

export function canDeriveProcessedWaveformPyramid(
  clip: TimelineClip,
  keyframes: readonly Keyframe[] = [],
): boolean {
  if (hasSpeedProcessing(clip, keyframes)) return false;
  if (hasEnabledSpectralLayer(clip)) return false;
  if (collectProcessedAnalysisClipAudioEffectInstances(clip, keyframes).length > 0) return false;
  return collectRenderableClipAudioEditOperations(clip).every(isDerivableEditOperation);
}

export class DerivedProcessedWaveformPyramidService {
  private readonly artifactStore: AudioArtifactStore;
  private readonly waveformGenerator: WaveformPyramidGenerator;

  constructor(options: DerivedProcessedWaveformPyramidServiceOptions = {}) {
    this.artifactStore = options.artifactStore ?? createCurrentAudioArtifactStore();
    this.waveformGenerator = options.waveformGenerator ?? new WaveformPyramidGenerator({
      artifactStore: this.artifactStore,
      analyzerVersion: DERIVED_PROCESSED_WAVEFORM_GENERATOR_VERSION,
    });
  }

  async generate(
    request: DerivedProcessedWaveformPyramidRequest,
  ): Promise<DerivedProcessedWaveformPyramidResult> {
    const {
      clip,
      sourcePyramid,
      sourceFingerprint,
      keyframes = [],
      signal,
      onProgress,
    } = request;
    const mediaFileId = request.mediaFileId ?? clip.mediaFileId ?? clip.source?.mediaFileId ?? clip.id;
    const clipAudioStateHash = createProcessedClipAudioStateHash(clip, { keyframes });

    emitProgress(onProgress, {
      phase: 'preparing',
      percent: 0,
      message: 'Preparing derived processed waveform',
    });
    throwIfAborted(signal);

    if (!canDeriveProcessedWaveformPyramid(clip, keyframes)) {
      throw new Error('Clip audio state is not eligible for derived processed waveform generation.');
    }

    const derived = await runBackgroundWaveformDerivation(() => deriveWaveformPyramidInWorker(sourcePyramid, {
      inPoint: clip.inPoint, outPoint: clip.outPoint, duration: clip.duration, reversed: clip.reversed,
    }, collectRenderableClipAudioEditOperations(clip), signal), signal);
    const pyramid = derived.pyramid;
    emitProgress(onProgress, {
      phase: 'deriving',
      percent: 62,
      message: 'Derived processed waveform from source pyramid',
    });
    throwIfAborted(signal);

    const generated = await this.waveformGenerator.storePyramid({
      kind: 'processed-waveform-pyramid',
      mediaFileId,
      sourceFingerprint,
      pyramid,
      packedPayload: derived.packedPayload,
      clipAudioStateHash,
      decoderId: DERIVED_PROCESSED_WAVEFORM_DECODER_ID,
      decoderVersion: DERIVED_PROCESSED_WAVEFORM_DECODER_VERSION,
      metadata: {
        sourceClipId: clip.id,
        sourceClipName: clip.name,
        sourceInPoint: clip.inPoint,
        sourceOutPoint: clip.outPoint,
        timelineDuration: clip.duration,
        timelineSpeed: clip.speed ?? 1,
        reversed: clip.reversed === true,
        preservesPitch: clip.preservesPitch !== false,
        derivedFromSourcePyramid: true,
      },
    }, {
      signal,
      onProgress: waveform => emitProgress(onProgress, {
        phase: waveform.phase === 'complete' ? 'complete' : 'storing',
        percent: 62 + Math.round(waveform.percent * 0.38),
        waveform,
        message: waveform.message,
      }),
    });

    primeTimelineWaveformPyramidCache([
      generated.artifact.id,
      generated.artifact.manifestRef.artifactId,
      generated.analysisRef.artifactId,
    ], pyramid);

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Derived processed waveform ready',
    });

    return {
      clipAudioStateHash,
      waveform: (await previewSavedSourceWaveform(pyramid, { samplesPerSecond: 50, signal })).waveform,
      pyramid,
      audioAnalysisRefs: {
        processedWaveformPyramidId: generated.artifact.manifestRef.artifactId,
      },
      generated,
      artifact: generated.artifact,
    };
  }
}
