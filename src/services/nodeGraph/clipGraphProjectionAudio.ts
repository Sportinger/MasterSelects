import type {
  AudioAnalysisArtifactKind,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
} from './clipGraphProjectionDomain';
import { outputPort } from './clipGraphProjectionGraph';
import type { NodeGraphPort, NodeGraphPortMetadata, NodeGraphSignalType } from './types';

const MAX_PROJECTED_SPECTRUM_PORTS = 16;

interface ResolvedAudioAnalysisRef {
  artifactId: string;
  artifactKind: AudioAnalysisArtifactKind;
  provenance: 'source' | 'processed';
  index?: number;
}

export function hasAnyAudioAnalysisRef(refs: MediaFileAudioAnalysisRefs | undefined): boolean {
  return Boolean(
    refs?.waveformPyramidId ||
    refs?.processedWaveformPyramidId ||
    refs?.spectrogramTileSetIds?.length ||
    refs?.loudnessEnvelopeId ||
    refs?.beatGridId ||
    refs?.onsetMapId ||
    refs?.phaseCorrelationId ||
    refs?.transcriptTimingId ||
    refs?.frequencySummaryId,
  );
}

export function isAudioSourceClip(clip: TimelineClip | undefined | null): clip is TimelineClip {
  return !!clip && (
    clip.source?.type === 'audio' ||
    clip.source?.type === 'video' ||
    clip.file?.type?.startsWith('audio/') === true ||
    (clip.waveform?.length ?? 0) > 0 ||
    hasAnyAudioAnalysisRef(clip.audioState?.sourceAnalysisRefs) ||
    hasAnyAudioAnalysisRef(clip.audioState?.processedAnalysisRefs)
  );
}

export function resolveLinkedAudioClip(clip: TimelineClip, linkedClip?: TimelineClip | null): TimelineClip | undefined {
  if (linkedClip?.source?.type === 'audio') {
    return linkedClip;
  }
  if (clip.source?.type === 'audio') {
    return clip;
  }
  if (isAudioSourceClip(clip)) {
    return clip;
  }
  return isAudioSourceClip(linkedClip) ? linkedClip : undefined;
}

export function hasAudioAnalysisSurface(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio' ||
    clip.source?.type === 'video' ||
    clip.file?.type?.startsWith('audio/') === true ||
    (clip.waveform?.length ?? 0) > 0 ||
    hasAnyAudioAnalysisRef(clip.audioState?.sourceAnalysisRefs) ||
    hasAnyAudioAnalysisRef(clip.audioState?.processedAnalysisRefs);
}

function firstResolvedRef(
  processedRef: ResolvedAudioAnalysisRef | undefined,
  sourceRef: ResolvedAudioAnalysisRef | undefined,
): ResolvedAudioAnalysisRef | undefined {
  return processedRef ?? sourceRef;
}

function resolveAudioRef(
  provenance: 'source' | 'processed',
  artifactId: string | undefined,
  artifactKind: AudioAnalysisArtifactKind,
  index?: number,
): ResolvedAudioAnalysisRef | undefined {
  if (!artifactId) {
    return undefined;
  }

  return { artifactId, artifactKind, provenance, ...(index !== undefined ? { index } : {}) };
}

function resolveAudioRefs(clip: TimelineClip): {
  waveform?: ResolvedAudioAnalysisRef;
  spectrum: ResolvedAudioAnalysisRef[];
  loudness?: ResolvedAudioAnalysisRef;
  beats?: ResolvedAudioAnalysisRef;
  onsets?: ResolvedAudioAnalysisRef;
  phaseCorrelation?: ResolvedAudioAnalysisRef;
  transcriptTiming?: ResolvedAudioAnalysisRef;
  frequencySummary?: ResolvedAudioAnalysisRef;
} {
  const source = clip.audioState?.sourceAnalysisRefs;
  const processed = clip.audioState?.processedAnalysisRefs;
  const processedSpectrum = (processed?.spectrogramTileSetIds ?? [])
    .slice(0, MAX_PROJECTED_SPECTRUM_PORTS)
    .map((artifactId, index) => resolveAudioRef('processed', artifactId, 'spectrogram-tiles', index))
    .filter((ref): ref is ResolvedAudioAnalysisRef => Boolean(ref));
  const sourceSpectrum = (source?.spectrogramTileSetIds ?? [])
    .slice(0, MAX_PROJECTED_SPECTRUM_PORTS)
    .map((artifactId, index) => resolveAudioRef('source', artifactId, 'spectrogram-tiles', index))
    .filter((ref): ref is ResolvedAudioAnalysisRef => Boolean(ref));

  return {
    waveform: firstResolvedRef(
      resolveAudioRef('processed', processed?.processedWaveformPyramidId, 'processed-waveform-pyramid') ??
        resolveAudioRef('processed', processed?.waveformPyramidId, 'waveform-pyramid'),
      resolveAudioRef('source', source?.waveformPyramidId, 'waveform-pyramid'),
    ),
    spectrum: processedSpectrum.length > 0 ? processedSpectrum : sourceSpectrum,
    loudness: firstResolvedRef(
      resolveAudioRef('processed', processed?.loudnessEnvelopeId, 'loudness-envelope'),
      resolveAudioRef('source', source?.loudnessEnvelopeId, 'loudness-envelope'),
    ),
    beats: firstResolvedRef(
      resolveAudioRef('processed', processed?.beatGridId, 'beat-grid'),
      resolveAudioRef('source', source?.beatGridId, 'beat-grid'),
    ),
    onsets: firstResolvedRef(
      resolveAudioRef('processed', processed?.onsetMapId, 'onset-map'),
      resolveAudioRef('source', source?.onsetMapId, 'onset-map'),
    ),
    phaseCorrelation: firstResolvedRef(
      resolveAudioRef('processed', processed?.phaseCorrelationId, 'phase-correlation'),
      resolveAudioRef('source', source?.phaseCorrelationId, 'phase-correlation'),
    ),
    transcriptTiming: firstResolvedRef(
      resolveAudioRef('processed', processed?.transcriptTimingId, 'transcript-timing'),
      resolveAudioRef('source', source?.transcriptTimingId, 'transcript-timing'),
    ),
    frequencySummary: firstResolvedRef(
      resolveAudioRef('processed', processed?.frequencySummaryId, 'frequency-summary'),
      resolveAudioRef('source', source?.frequencySummaryId, 'frequency-summary'),
    ),
  };
}

function audioArtifactPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  semanticKind: NonNullable<NodeGraphPortMetadata['semanticKind']>,
  ref: ResolvedAudioAnalysisRef | undefined,
  artifactKind: AudioAnalysisArtifactKind,
  targetClipId: string,
): NodeGraphPort {
  return outputPort(id, label, type, {
    semanticKind,
    targetClipId,
    signalRefId: ref?.artifactId,
    artifactId: ref?.artifactId,
    artifactProvenance: ref?.provenance,
    artifactIndex: ref?.index,
    available: Boolean(ref?.artifactId),
    stale: false,
    previewable: true,
    generateAction: {
      type: 'generate-audio-analysis',
      artifactKind,
      label,
    },
  });
}

function audioMetadataPort(clip: TimelineClip): NodeGraphPort {
  const signalRefId = clip.audioState?.sourceAudioRevisionId ?? clip.mediaFileId ?? clip.source?.mediaFileId;
  return outputPort('audio-metadata', 'audio metadata', 'metadata', {
    semanticKind: 'audio-metadata',
    targetClipId: clip.id,
    signalRefId,
    available: true,
    stale: false,
    previewable: false,
  });
}

export function appendAudioAnalysisPorts(outputs: NodeGraphPort[], clip: TimelineClip): void {
  const refs = resolveAudioRefs(clip);
  const targetClipId = clip.id;

  outputs.push(audioArtifactPort(
    'waveform',
    'waveform',
    'curve',
    'waveform',
    refs.waveform,
    refs.waveform?.artifactKind ?? 'waveform-pyramid',
    targetClipId,
  ));
  refs.spectrum.forEach((ref, index) => {
    outputs.push(audioArtifactPort(
      index === 0 ? 'spectrum' : `spectrum-${index + 1}`,
      index === 0 ? 'spectrum' : `spectrum ${index + 1}`,
      'texture',
      'spectrum',
      ref,
      'spectrogram-tiles',
      targetClipId,
    ));
  });
  if (refs.spectrum.length === 0) {
    outputs.push(audioArtifactPort('spectrum', 'spectrum', 'texture', 'spectrum', undefined, 'spectrogram-tiles', targetClipId));
  }
  outputs.push(audioArtifactPort('loudness', 'loudness', 'curve', 'loudness', refs.loudness, 'loudness-envelope', targetClipId));
  outputs.push(audioArtifactPort('beats', 'beats', 'event', 'beats', refs.beats, 'beat-grid', targetClipId));
  outputs.push(audioArtifactPort('onsets', 'onsets', 'event', 'onsets', refs.onsets, 'onset-map', targetClipId));
  outputs.push(audioArtifactPort('phase-correlation', 'phase correlation', 'curve', 'phase-correlation', refs.phaseCorrelation, 'phase-correlation', targetClipId));
  outputs.push(audioArtifactPort('transcript-timing', 'transcript timing', 'text', 'transcript', refs.transcriptTiming, 'transcript-timing', targetClipId));
  outputs.push(audioArtifactPort('frequency-bands', 'frequency bands', 'table', 'frequency-bands', refs.frequencySummary, 'frequency-summary', targetClipId));
  outputs.push(audioArtifactPort('frequency-summary', 'frequency summary', 'table', 'frequency-summary', refs.frequencySummary, 'frequency-summary', targetClipId));
  outputs.push(audioMetadataPort(clip));
}

export function summarizeAudioAnalysisOutputs(outputs: readonly NodeGraphPort[]): Record<string, string | number | boolean> {
  const artifactPorts = outputs.filter(port => port.metadata?.generateAction?.type === 'generate-audio-analysis');
  const total = artifactPorts.length;
  const available = artifactPorts.filter(port => port.metadata?.available === true).length;
  const stale = artifactPorts.filter(port => port.metadata?.stale === true).length;
  const processed = artifactPorts.filter(port => port.metadata?.artifactProvenance === 'processed').length;
  const source = artifactPorts.filter(port => port.metadata?.artifactProvenance === 'source').length;
  const missing = Math.max(0, total - available);

  return {
    status: total === 0 || available === 0 ? 'empty' : missing > 0 || stale > 0 ? 'partial' : 'ready',
    artifactPorts: total,
    availableArtifacts: available,
    missingArtifacts: missing,
    staleArtifacts: stale,
    processedArtifacts: processed,
    sourceArtifacts: source,
    progressPercent: total > 0 ? Math.round((available / total) * 100) : 0,
  };
}

export function isAudioAnalysisSemanticKind(kind: string | undefined): boolean {
  return kind === 'waveform' ||
    kind === 'spectrum' ||
    kind === 'frequency-bands' ||
    kind === 'loudness' ||
    kind === 'beats' ||
    kind === 'onsets' ||
    kind === 'phase-correlation' ||
    kind === 'transcript' ||
    kind === 'frequency-summary' ||
    kind === 'audio-metadata';
}

export function isAudioAnalysisSeededInput(port: NodeGraphPort | undefined): boolean {
  if (!port?.metadata) return false;
  return port.metadata.generateAction?.type === 'generate-audio-analysis' ||
    isAudioAnalysisSemanticKind(typeof port.metadata.semanticKind === 'string' ? port.metadata.semanticKind : undefined);
}
