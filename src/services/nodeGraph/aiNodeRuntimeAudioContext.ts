import type {
  AudioEffectInstance,
  MasterAudioState,
} from "../../types/audio";
import type { TimelineClip, TimelineTrack } from "../../types/timeline";
import {
  buildAudioRepairSuggestionsFromRefs,
  type AudioRepairSuggestion,
} from '../audio/audioRepairSuggestions';
import {
  countAudioAnalysisRefs,
  createAudioAnalysisNamespace,
  getEffectiveAudioAnalysisRefs,
  mergeAudioAnalysisNamespaces,
  type AINodeRuntimeAudioAnalysisNamespace,
} from './aiNodeRuntimeAudioAnalysisSignals';

const MAX_RUNTIME_AUDIO_REPAIR_SUGGESTIONS = 6;

interface AINodeRuntimeWaveformSummary {
  sampleCount: number;
  peak: number;
  rms: number;
  min: number;
  max: number;
  preview: number[];
}

interface AINodeRuntimeAudioEffectSummary {
  id: string;
  descriptorId: string;
  enabled: boolean;
  params: Record<string, string | number | boolean>;
}

interface AINodeRuntimeClipAudioRoutingContext {
  muted: boolean;
  soloSafe: boolean;
  sourceAudioRevisionId?: string;
  editStackCount: number;
  spectralLayerCount: number;
  effectStack: AINodeRuntimeAudioEffectSummary[];
}

interface AINodeRuntimeTrackAudioRoutingContext {
  trackId: string;
  name?: string;
  muted: boolean;
  solo: boolean;
  volumeDb: number;
  pan: number;
  meterMode?: string;
  sendCount: number;
  effectStack: AINodeRuntimeAudioEffectSummary[];
}

interface AINodeRuntimeMasterAudioRoutingContext {
  volumeDb: number;
  limiterEnabled: boolean;
  truePeakCeilingDb: number;
  targetLufs?: number;
  effectStack: AINodeRuntimeAudioEffectSummary[];
}

interface AINodeRuntimeAudioMetadataSignal {
  clipId: string;
  linkedClipId?: string;
  sourceType?: string;
  mediaFileId?: string;
  sourceAudioRevisionId?: string;
  trackId?: string;
  duration: number;
  inPoint: number;
  outPoint: number;
  waveformSampleCount: number;
  editStackCount: number;
  spectralLayerCount: number;
  sourceArtifactCount: number;
  processedArtifactCount: number;
  effectiveArtifactCount: number;
  hasProcessedAnalysis: boolean;
}

export interface AINodeRuntimeAudioContext {
  source: {
    clipId: string;
    linkedClipId?: string;
    mediaFileId?: string;
    sourceAudioRevisionId?: string;
    duration: number;
    inPoint: number;
    outPoint: number;
  };
  waveform?: AINodeRuntimeWaveformSummary;
  routing: {
    clip: AINodeRuntimeClipAudioRoutingContext;
    track?: AINodeRuntimeTrackAudioRoutingContext;
    master: AINodeRuntimeMasterAudioRoutingContext;
  };
  analysis: {
    source: AINodeRuntimeAudioAnalysisNamespace;
    processed: AINodeRuntimeAudioAnalysisNamespace;
    effective: AINodeRuntimeAudioAnalysisNamespace;
  };
  metadata: AINodeRuntimeAudioMetadataSignal;
  repairSuggestions: AudioRepairSuggestion[];
}

export interface AINodeRuntimeAudioOptions {
  track?: TimelineTrack;
  linkedClip?: TimelineClip | null;
  linkedTrack?: TimelineTrack | null;
  masterAudioState?: MasterAudioState;
}

function sanitizeAudioEffectParams(
  params: AudioEffectInstance['params'] | undefined,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function summarizeAudioEffectStack(
  effects: readonly AudioEffectInstance[] | undefined,
): AINodeRuntimeAudioEffectSummary[] {
  return (effects ?? []).slice(0, 32).map(effect => ({
    id: effect.id,
    descriptorId: effect.descriptorId,
    enabled: effect.enabled !== false,
    params: sanitizeAudioEffectParams(effect.params),
  }));
}

function createRuntimeTrackAudioSignature(track?: TimelineTrack | null): Record<string, unknown> | null {
  return track ? {
      id: track.id,
      muted: track.audioState?.muted ?? track.muted === true,
      solo: track.audioState?.solo ?? track.solo === true,
      volumeDb: track.audioState?.volumeDb ?? 0,
      pan: track.audioState?.pan ?? 0,
      meterMode: track.audioState?.meterMode,
      sendCount: track.audioState?.sends?.length ?? 0,
      effectStack: summarizeAudioEffectStack(track.audioState?.effectStack),
    } : null;
}

export function createRuntimeAudioOptionsSignature(options: AINodeRuntimeAudioOptions = {}): string {
  const { track, linkedClip, linkedTrack, masterAudioState } = options;
  return JSON.stringify({
    track: createRuntimeTrackAudioSignature(track),
    linkedClip: linkedClip ? createRuntimeClipAudioSignature(linkedClip) : null,
    linkedTrack: createRuntimeTrackAudioSignature(linkedTrack),
    master: masterAudioState ? {
      volumeDb: masterAudioState.volumeDb,
      limiterEnabled: masterAudioState.limiterEnabled,
      truePeakCeilingDb: masterAudioState.truePeakCeilingDb,
      targetLufs: masterAudioState.targetLufs,
      effectStack: summarizeAudioEffectStack(masterAudioState.effectStack),
    } : null,
  });
}

export function createRuntimeClipAudioSignature(clip: TimelineClip): string {
  return JSON.stringify({
    id: clip.id,
    trackId: clip.trackId,
    sourceType: clip.source?.type,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    waveformSampleCount: clip.waveform?.length ?? 0,
    sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
    muted: clip.audioState?.muted === true,
    soloSafe: clip.audioState?.soloSafe === true,
    editStackCount: clip.audioState?.editStack?.length ?? 0,
    spectralLayerCount: clip.audioState?.spectralLayers?.length ?? 0,
    effectStack: summarizeAudioEffectStack(clip.audioState?.effectStack),
    sourceAnalysisRefs: clip.audioState?.sourceAnalysisRefs ?? null,
    processedAnalysisRefs: clip.audioState?.processedAnalysisRefs ?? null,
  });
}

function createAudioMetadataSignal(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  effectiveRefs: ReturnType<typeof getEffectiveAudioAnalysisRefs>,
): AINodeRuntimeAudioMetadataSignal {
  return {
    clipId: clip.id,
    linkedClipId: clip.linkedClipId,
    sourceType: clip.source?.type,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
    trackId: track?.id ?? clip.trackId,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    waveformSampleCount: clip.waveform?.length ?? 0,
    editStackCount: clip.audioState?.editStack?.length ?? 0,
    spectralLayerCount: clip.audioState?.spectralLayers?.length ?? 0,
    sourceArtifactCount: countAudioAnalysisRefs(clip.audioState?.sourceAnalysisRefs),
    processedArtifactCount: countAudioAnalysisRefs(clip.audioState?.processedAnalysisRefs),
    effectiveArtifactCount: countAudioAnalysisRefs(effectiveRefs),
    hasProcessedAnalysis: countAudioAnalysisRefs(clip.audioState?.processedAnalysisRefs) > 0,
  };
}

function summarizeWaveform(waveform: number[] | undefined): AINodeRuntimeWaveformSummary | undefined {
  if (!waveform || waveform.length === 0) {
    return undefined;
  }

  let peak = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let squareSum = 0;

  for (const value of waveform) {
    const sample = Number.isFinite(value) ? value : 0;
    peak = Math.max(peak, Math.abs(sample));
    min = Math.min(min, sample);
    max = Math.max(max, sample);
    squareSum += sample * sample;
  }

  const previewLength = Math.min(256, waveform.length);
  const preview = Array.from({ length: previewLength }, (_, index) => {
    const sourceIndex = Math.min(
      waveform.length - 1,
      Math.floor((index / Math.max(1, previewLength)) * waveform.length),
    );
    const sample = waveform[sourceIndex];
    return Number.isFinite(sample) ? sample : 0;
  });

  return {
    sampleCount: waveform.length,
    peak,
    rms: Math.sqrt(squareSum / waveform.length),
    min,
    max,
    preview,
  };
}

function createRuntimeAudioRoutingContext(
  clip: TimelineClip,
  track?: TimelineTrack,
  masterAudioState?: MasterAudioState,
): AINodeRuntimeAudioContext['routing'] {
  return {
    clip: {
      muted: clip.audioState?.muted === true,
      soloSafe: clip.audioState?.soloSafe === true,
      sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
      editStackCount: clip.audioState?.editStack?.length ?? 0,
      spectralLayerCount: clip.audioState?.spectralLayers?.length ?? 0,
      effectStack: summarizeAudioEffectStack(clip.audioState?.effectStack),
    },
    ...(track ? {
      track: {
        trackId: track.id,
        name: track.name,
        muted: track.audioState?.muted ?? track.muted === true,
        solo: track.audioState?.solo ?? track.solo === true,
        volumeDb: track.audioState?.volumeDb ?? 0,
        pan: track.audioState?.pan ?? 0,
        meterMode: track.audioState?.meterMode,
        sendCount: track.audioState?.sends?.length ?? 0,
        effectStack: summarizeAudioEffectStack(track.audioState?.effectStack),
      },
    } : {}),
    master: {
      volumeDb: masterAudioState?.volumeDb ?? 0,
      limiterEnabled: masterAudioState?.limiterEnabled ?? false,
      truePeakCeilingDb: masterAudioState?.truePeakCeilingDb ?? 0,
      targetLufs: masterAudioState?.targetLufs,
      effectStack: summarizeAudioEffectStack(masterAudioState?.effectStack),
    },
  };
}

function hasAudioAnalysis(namespace: AINodeRuntimeAudioAnalysisNamespace): boolean {
  return Boolean(
    namespace.waveform ||
    namespace.processedWaveform ||
    namespace.spectrogramTileSetCount > 0 ||
    namespace.loudness ||
    namespace.beats ||
    namespace.onsets ||
    namespace.phaseCorrelation ||
    namespace.transcriptTiming ||
    namespace.frequencyBands ||
    namespace.frequencySummary,
  );
}

export function createRuntimeAudioContext(
  clip: TimelineClip,
  track?: TimelineTrack,
  masterAudioState?: MasterAudioState,
): AINodeRuntimeAudioContext | undefined {
  const source = createAudioAnalysisNamespace(clip.audioState?.sourceAnalysisRefs, 'source');
  const processed = createAudioAnalysisNamespace(clip.audioState?.processedAnalysisRefs, 'processed');
  const effective = mergeAudioAnalysisNamespaces(source, processed);
  const effectiveRefs = getEffectiveAudioAnalysisRefs(clip);
  const repairSuggestions = buildAudioRepairSuggestionsFromRefs(effectiveRefs, {
    maxSuggestions: MAX_RUNTIME_AUDIO_REPAIR_SUGGESTIONS,
  });
  const waveform = summarizeWaveform(clip.waveform);
  const routing = createRuntimeAudioRoutingContext(clip, track, masterAudioState);
  const metadata = createAudioMetadataSignal(clip, track, effectiveRefs);
  const hasAudioSource = clip.source?.type === 'audio' ||
    clip.source?.type === 'video' ||
    clip.file?.type?.startsWith('audio/') ||
    Boolean(clip.audioState) ||
    Boolean(waveform) ||
    hasAudioAnalysis(effective);

  if (!hasAudioSource) {
    return undefined;
  }

  return {
    source: {
      clipId: clip.id,
      linkedClipId: clip.linkedClipId,
      mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
      sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
    },
    waveform,
    routing,
    analysis: {
      source,
      processed,
      effective,
    },
    metadata,
    repairSuggestions,
  };
}

function isRuntimeAudioClipCandidate(clip: TimelineClip | null | undefined): clip is TimelineClip {
  if (!clip) {
    return false;
  }

  return clip.source?.type === 'audio' ||
    clip.file?.type?.startsWith('audio/') === true ||
    Boolean(clip.audioState) ||
    Boolean(clip.waveform?.length);
}

export function resolveRuntimeAudioInput(
  clip: TimelineClip,
  audioOptions: AINodeRuntimeAudioOptions,
): { clip: TimelineClip; track?: TimelineTrack } {
  const linkedClip = audioOptions.linkedClip;
  if (isRuntimeAudioClipCandidate(linkedClip)) {
    return {
      clip: linkedClip,
      track: audioOptions.linkedTrack ?? audioOptions.track,
    };
  }

  return {
    clip,
    track: audioOptions.track,
  };
}
