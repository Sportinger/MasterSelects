import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioArtifactRef } from '../audioArtifactTypes';
import {
  FREQUENCY_BAND_PAYLOAD_VERSION,
  PHASE_CORRELATION_PAYLOAD_VERSION,
  encodeFrequencyBandPayload,
  encodePhaseCorrelationPayload,
  frequencyBandsToFloat32,
  phaseCorrelationPointsToFloat32,
  type FrequencyBandSummary,
  type PhaseCorrelationPoint,
} from '../frequencyPhaseManifest';
import type {
  FrequencyPhaseAnalysisContext,
  NormalizedFrequencyPhaseParameters,
} from './frequencyPhaseAnalysisTypes';

export const FREQUENCY_BAND_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.frequency-bands';
export const PHASE_CORRELATION_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.phase-correlation';

export async function storeFrequencyPayload(input: {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  cacheKey: string;
  analyzerVersion: string;
  generatedAt: string;
  bands: readonly FrequencyBandSummary[];
  context: FrequencyPhaseAnalysisContext;
  now: () => string;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<AudioArtifactRef> {
  input.context.onProgress?.({
    jobId: input.context.jobId,
    mediaFileId: input.context.mediaFileId,
    sourceFingerprint: input.context.sourceFingerprint,
    frequencyCacheKey: input.context.frequencyCacheKey,
    phaseCacheKey: input.context.phaseCacheKey,
    phase: 'storing-payloads',
    percent: 82,
    timestamp: input.now(),
    message: 'Storing frequency band payload',
  });
  input.throwIfCancelled(input.context.signal, input.context.jobId);

  return input.artifactStore.putPayload(encodeFrequencyBandPayload({
    header: {
      schemaVersion: FREQUENCY_BAND_PAYLOAD_VERSION,
      bandCount: input.bands.length,
      valueLayout: 'band-major',
      valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32',
    },
    values: frequencyBandsToFloat32(input.bands),
  }), {
    mediaFileId: input.mediaFileId,
    kind: 'frequency-summary',
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    mimeType: FREQUENCY_BAND_PAYLOAD_MIME_TYPE,
    encoding: 'raw',
    analyzerVersion: input.analyzerVersion,
    createdAt: input.generatedAt,
    sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
    metadata: {
      cacheKey: input.cacheKey,
      bandCount: input.bands.length,
      valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32',
    },
  });
}

export async function storePhasePayload(input: {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  cacheKey: string;
  analyzerVersion: string;
  generatedAt: string;
  points: readonly PhaseCorrelationPoint[];
  parameters: NormalizedFrequencyPhaseParameters;
  context: FrequencyPhaseAnalysisContext;
  now: () => string;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<AudioArtifactRef> {
  input.context.onProgress?.({
    jobId: input.context.jobId,
    mediaFileId: input.context.mediaFileId,
    sourceFingerprint: input.context.sourceFingerprint,
    frequencyCacheKey: input.context.frequencyCacheKey,
    phaseCacheKey: input.context.phaseCacheKey,
    phase: 'storing-payloads',
    percent: 92,
    timestamp: input.now(),
    message: 'Storing phase correlation payload',
  });
  input.throwIfCancelled(input.context.signal, input.context.jobId);

  return input.artifactStore.putPayload(encodePhaseCorrelationPayload({
    header: {
      schemaVersion: PHASE_CORRELATION_PAYLOAD_VERSION,
      pointCount: input.points.length,
      windowDuration: input.parameters.phaseWindowDuration,
      hopDuration: input.parameters.phaseHopDuration,
      valueLayout: 'time-major',
      valueEncoding: 'time-correlation-midSideRatioDb-f32',
    },
    values: phaseCorrelationPointsToFloat32(input.points),
  }), {
    mediaFileId: input.mediaFileId,
    kind: 'phase-correlation',
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    mimeType: PHASE_CORRELATION_PAYLOAD_MIME_TYPE,
    encoding: 'raw',
    analyzerVersion: input.analyzerVersion,
    createdAt: input.generatedAt,
    sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
    metadata: {
      cacheKey: input.cacheKey,
      pointCount: input.points.length,
      valueEncoding: 'time-correlation-midSideRatioDb-f32',
    },
  });
}
