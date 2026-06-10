import type { MediaFileAudioAnalysisRefs } from "../../types/audio";
import type { TimelineClip } from "../../types/timeline";
import {
  createAudioArtifactSignal,
  type AINodeRuntimeAudioArtifactSignal,
} from './aiNodeRuntimeAudioArtifactSignals';

const MAX_RUNTIME_AUDIO_SPECTROGRAM_REFS = 16;

export interface AINodeRuntimeAudioAnalysisNamespace {
  waveform?: AINodeRuntimeAudioArtifactSignal;
  processedWaveform?: AINodeRuntimeAudioArtifactSignal;
  spectrogramTileSets: AINodeRuntimeAudioArtifactSignal[];
  spectrogramTileSetCount: number;
  omittedSpectrogramTileSetCount: number;
  loudness?: AINodeRuntimeAudioArtifactSignal;
  beats?: AINodeRuntimeAudioArtifactSignal;
  onsets?: AINodeRuntimeAudioArtifactSignal;
  phaseCorrelation?: AINodeRuntimeAudioArtifactSignal;
  transcriptTiming?: AINodeRuntimeAudioArtifactSignal;
  frequencyBands?: AINodeRuntimeAudioArtifactSignal;
  frequencySummary?: AINodeRuntimeAudioArtifactSignal;
}

export function createAudioAnalysisNamespace(
  refs: MediaFileAudioAnalysisRefs | undefined,
  provenance: 'source' | 'processed',
): AINodeRuntimeAudioAnalysisNamespace {
  const spectrogramTileSetIds = refs?.spectrogramTileSetIds ?? [];
  const boundedSpectrogramTileSetIds = spectrogramTileSetIds.slice(0, MAX_RUNTIME_AUDIO_SPECTROGRAM_REFS);
  const frequencySummary = createAudioArtifactSignal(refs?.frequencySummaryId, 'frequency-summary', provenance);

  return {
    waveform: createAudioArtifactSignal(refs?.waveformPyramidId, 'waveform-pyramid', provenance),
    processedWaveform: createAudioArtifactSignal(
      refs?.processedWaveformPyramidId,
      'processed-waveform-pyramid',
      provenance,
    ),
    spectrogramTileSets: boundedSpectrogramTileSetIds
      .map((artifactId) => createAudioArtifactSignal(artifactId, 'spectrogram-tiles', provenance))
      .filter((signal): signal is AINodeRuntimeAudioArtifactSignal => Boolean(signal)),
    spectrogramTileSetCount: spectrogramTileSetIds.length,
    omittedSpectrogramTileSetCount: Math.max(
      0,
      spectrogramTileSetIds.length - boundedSpectrogramTileSetIds.length,
    ),
    loudness: createAudioArtifactSignal(refs?.loudnessEnvelopeId, 'loudness-envelope', provenance),
    beats: createAudioArtifactSignal(refs?.beatGridId, 'beat-grid', provenance),
    onsets: createAudioArtifactSignal(refs?.onsetMapId, 'onset-map', provenance),
    phaseCorrelation: createAudioArtifactSignal(refs?.phaseCorrelationId, 'phase-correlation', provenance),
    transcriptTiming: createAudioArtifactSignal(refs?.transcriptTimingId, 'transcript-timing', provenance),
    frequencyBands: frequencySummary,
    frequencySummary,
  };
}

function firstNonEmptyRefs<T>(preferred: T[] | undefined, fallback: T[] | undefined): T[] | undefined {
  return preferred && preferred.length > 0 ? preferred : fallback;
}

export function getEffectiveAudioAnalysisRefs(clip: TimelineClip): MediaFileAudioAnalysisRefs | undefined {
  const source = clip.audioState?.sourceAnalysisRefs;
  const processed = clip.audioState?.processedAnalysisRefs;
  if (!source && !processed) {
    return undefined;
  }

  return {
    waveformPyramidId: processed?.processedWaveformPyramidId ??
      processed?.waveformPyramidId ??
      source?.waveformPyramidId,
    processedWaveformPyramidId: processed?.processedWaveformPyramidId ?? source?.processedWaveformPyramidId,
    spectrogramTileSetIds: firstNonEmptyRefs(processed?.spectrogramTileSetIds, source?.spectrogramTileSetIds),
    loudnessEnvelopeId: processed?.loudnessEnvelopeId ?? source?.loudnessEnvelopeId,
    beatGridId: processed?.beatGridId ?? source?.beatGridId,
    onsetMapId: processed?.onsetMapId ?? source?.onsetMapId,
    phaseCorrelationId: processed?.phaseCorrelationId ?? source?.phaseCorrelationId,
    transcriptTimingId: processed?.transcriptTimingId ?? source?.transcriptTimingId,
    frequencySummaryId: processed?.frequencySummaryId ?? source?.frequencySummaryId,
  };
}

export function mergeAudioAnalysisNamespaces(
  source: AINodeRuntimeAudioAnalysisNamespace,
  processed: AINodeRuntimeAudioAnalysisNamespace,
): AINodeRuntimeAudioAnalysisNamespace {
  const spectrogramSource = processed.spectrogramTileSets.length > 0 ? processed : source;

  return {
    waveform: processed.processedWaveform ?? processed.waveform ?? source.waveform,
    processedWaveform: processed.processedWaveform ?? source.processedWaveform,
    spectrogramTileSets: spectrogramSource.spectrogramTileSets,
    spectrogramTileSetCount: spectrogramSource.spectrogramTileSetCount,
    omittedSpectrogramTileSetCount: spectrogramSource.omittedSpectrogramTileSetCount,
    loudness: processed.loudness ?? source.loudness,
    beats: processed.beats ?? source.beats,
    onsets: processed.onsets ?? source.onsets,
    phaseCorrelation: processed.phaseCorrelation ?? source.phaseCorrelation,
    transcriptTiming: processed.transcriptTiming ?? source.transcriptTiming,
    frequencyBands: processed.frequencyBands ?? source.frequencyBands,
    frequencySummary: processed.frequencySummary ?? source.frequencySummary,
  };
}

export function countAudioAnalysisRefs(refs: MediaFileAudioAnalysisRefs | undefined): number {
  if (!refs) {
    return 0;
  }

  return [
    refs.waveformPyramidId,
    refs.processedWaveformPyramidId,
    refs.loudnessEnvelopeId,
    refs.beatGridId,
    refs.onsetMapId,
    refs.phaseCorrelationId,
    refs.transcriptTimingId,
    refs.frequencySummaryId,
  ].filter(Boolean).length + (refs.spectrogramTileSetIds?.length ?? 0);
}
