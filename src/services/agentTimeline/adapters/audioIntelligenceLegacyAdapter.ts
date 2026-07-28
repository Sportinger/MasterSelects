import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineProvenance,
  type AgentTimelineRange,
  type SpeechMarkerEventData,
} from '../../../types/agentTimeline/manifest';
import type { LegacyArtifactShardView } from '../../../types/agentTimeline/legacyAdapters';
import type {
  AudioClassificationFeatureWindow,
  AudioClassificationTranscriptRange,
} from '../../../types/agentTimeline/audioClassification';
import type {
  AudioMeasurementWindow,
  PersistedSilenceRange,
  PersistedTransientRange,
} from '../../../types/agentTimeline/qualityAudioDerivations';
import type {
  AudioIntelligenceArtifactSource,
  AudioIntelligencePayloads,
  DecodedLoudnessCurve,
} from '../artifacts/audioIntelligencePayloadLoader';
import { deriveAudioClassifications } from '../derivations/audioClassification/deriveAudioClassifications';
import { deriveQualityAudioEvents } from '../derivations/qualityAudio/deriveQualityAudioEvents';
import { clipRange, eventTime, stableEventId } from '../derivations/qualityAudio/derivationPrimitives';
import {
  clampConfidence,
  createLegacyView,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';

const ADAPTER_ANALYZER_ID = 'audio-intelligence-legacy-adapter';
const ADAPTER_ANALYZER_VERSION = '1.0.0';
const TRANSIENT_WIDTH_SECONDS = 0.05;
const PAUSE_MIN_SECONDS = 1;

export interface AudioIntelligenceLegacyViews {
  audioView?: LegacyArtifactShardView;
  speechMarkerView?: LegacyArtifactShardView;
}

function artifactProvenance(source: AudioIntelligenceArtifactSource): AgentTimelineProvenance {
  return {
    kind: 'analyzer',
    analyzerId: source.analyzerId,
    analyzerVersion: source.analyzerVersion,
    modelId: source.modelId,
    modelVersion: source.modelVersion,
    artifactRef: source.artifactRef,
  };
}

function adapterProvenance(request: LegacyAdapterRequest): AgentTimelineProvenance {
  return {
    kind: 'analyzer',
    analyzerId: ADAPTER_ANALYZER_ID,
    analyzerVersion: ADAPTER_ANALYZER_VERSION,
    artifactRef: request.artifactRef,
  };
}

function sources(payloads: AudioIntelligencePayloads): AudioIntelligenceArtifactSource[] {
  return [
    payloads.loudness?.source,
    payloads.onsets?.source,
    payloads.voiceActivity?.source,
    payloads.speechMarkers?.source,
  ].filter((source): source is AudioIntelligenceArtifactSource => source !== undefined);
}

function uniqueProvenance(items: readonly AgentTimelineProvenance[]): AgentTimelineProvenance[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventWithProvenance(
  event: AgentTimelineEvent,
  artifacts: readonly AgentTimelineProvenance[],
  adapter: AgentTimelineProvenance,
): AgentTimelineEvent {
  const classifier = event.provenance.filter((item) =>
    item.kind === 'analyzer' && item.analyzerId === 'persisted-audio-heuristic');
  return {
    ...event,
    confidence: clampConfidence(event.confidence),
    provenance: uniqueProvenance([...artifacts, ...classifier, adapter]),
  };
}

function curve(payloads: AudioIntelligencePayloads, peak: boolean): DecodedLoudnessCurve | undefined {
  const metrics = peak
    ? ['sample-peak-dbfs', 'true-peak-dbtp']
    : ['rms-dbfs', 'short-term-lufs', 'momentary-lufs'];
  return metrics.flatMap((metric) => {
    const selected = payloads.loudness?.curves.find((item) => item.metric === metric);
    return selected ? [selected] : [];
  })[0];
}

function peakForRange(
  range: AgentTimelineRange,
  peakCurve: DecodedLoudnessCurve | undefined,
): number | undefined {
  const values = peakCurve?.windows
    .filter((window) => window.start < range.end && window.end > range.start)
    .map((window) => window.valueDb)
    .filter(Number.isFinite) ?? [];
  return values.length > 0 ? Math.max(...values) : undefined;
}

function measurements(payloads: AudioIntelligencePayloads): AudioMeasurementWindow[] {
  const loudness = curve(payloads, false);
  const peak = curve(payloads, true);
  if (!loudness) return [];
  return loudness.windows.map((window) => ({
    start: window.start,
    end: window.end,
    loudnessDb: window.valueDb,
    peakDb: peakForRange(window, peak),
  }));
}

function mergedSpeechRanges(
  payloads: AudioIntelligencePayloads,
  bounds: AgentTimelineRange,
): AudioClassificationTranscriptRange[] {
  const ordered = (payloads.voiceActivity?.segments ?? [])
    .flatMap((segment) => {
      const clipped = clipRange(segment, bounds);
      return clipped ? [{ ...clipped, confidence: clampConfidence(segment.confidence) }] : [];
    })
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AudioClassificationTranscriptRange[] = [];
  for (const segment of ordered) {
    const previous = merged.at(-1);
    if (previous && segment.start <= previous.end) {
      previous.end = Math.max(previous.end, segment.end);
      previous.confidence = Math.min(previous.confidence ?? 0, segment.confidence ?? 0);
    } else merged.push({ ...segment });
  }
  return merged;
}

function nonSpeechRanges(
  speech: readonly AudioClassificationTranscriptRange[],
  bounds: AgentTimelineRange,
): AgentTimelineRange[] {
  const gaps: AgentTimelineRange[] = [];
  let cursor = bounds.start;
  for (const segment of speech) {
    if (cursor < segment.start) gaps.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < bounds.end) gaps.push({ start: cursor, end: bounds.end });
  return gaps;
}

function averageLoudness(
  range: AgentTimelineRange,
  windows: readonly AudioMeasurementWindow[],
): number {
  const values = windows
    .filter((window) => window.start < range.end && window.end > range.start)
    .map((window) => window.loudnessDb)
    .filter((value): value is number => Number.isFinite(value));
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : -100;
}

function silenceRanges(
  payloads: AudioIntelligencePayloads,
  speech: readonly AudioClassificationTranscriptRange[],
  bounds: AgentTimelineRange,
  windows: readonly AudioMeasurementWindow[],
): PersistedSilenceRange[] | undefined {
  if (!payloads.voiceActivity) return undefined;
  return nonSpeechRanges(speech, bounds).map((range) => ({
    ...range,
    rmsDb: averageLoudness(range, windows),
    confidence: 0.9,
  }));
}

function transientRanges(
  payloads: AudioIntelligencePayloads,
  bounds: AgentTimelineRange,
  windows: readonly AudioMeasurementWindow[],
): PersistedTransientRange[] | undefined {
  if (!payloads.onsets) return undefined;
  const peak = curve(payloads, true);
  return payloads.onsets.events.flatMap((onset) => {
    const range = clipRange({
      start: onset.time,
      end: onset.time + TRANSIENT_WIDTH_SECONDS,
    }, bounds);
    if (!range) return [];
    return [{
      ...range,
      peakDb: peakForRange(range, peak) ?? 0,
      rmsDb: averageLoudness(range, windows),
      strength: onset.strength,
      confidence: clampConfidence(onset.confidence),
    }];
  });
}

function featureWindows(
  windows: readonly AudioMeasurementWindow[],
  payloads: AudioIntelligencePayloads,
): AudioClassificationFeatureWindow[] {
  return windows.map((window) => {
    const duration = window.end - window.start;
    const onsetCount = payloads.onsets?.events.filter((event) =>
      event.time >= window.start && event.time < window.end).length;
    return {
      start: window.start,
      end: window.end,
      loudnessDb: window.loudnessDb,
      peakDb: window.peakDb,
      ...(onsetCount !== undefined && duration > 0 ? { onsetRateHz: onsetCount / duration } : {}),
    };
  });
}

function detectorCoverage(
  payloads: AudioIntelligencePayloads,
  request: LegacyAdapterRequest,
): AgentTimelineRange[] {
  const ends = [
    payloads.loudness?.manifest.duration,
    payloads.onsets?.manifest.duration,
    payloads.voiceActivity?.manifest.duration,
  ].filter((duration): duration is number => typeof duration === 'number'
      && Number.isFinite(duration) && duration > 0)
    .map((duration) => Math.min(request.queryRange.end, duration));
  if (ends.length === 0) return [];
  const end = Math.min(...ends);
  return end > request.queryRange.start ? [{ start: request.queryRange.start, end }] : [];
}

function markerData(type: string, text?: string, wordId?: string): SpeechMarkerEventData {
  const marker: SpeechMarkerEventData['marker'] = type === 'breath'
    ? 'breath'
    : type === 'filler'
      ? 'filler'
      : type === 'long-pause'
        ? 'pause'
        : 'disfluency';
  return {
    marker,
    ...(text ? { text } : {}),
    ...(wordId ? { wordId } : {}),
  };
}

function speechMarkerEvents(
  payloads: AudioIntelligencePayloads,
  request: LegacyAdapterRequest,
  provenance: readonly AgentTimelineProvenance[],
): AgentTimelineEvent[] {
  const context = {
    sourceId: request.artifactRef ?? 'audio-intelligence',
    timeDomain: 'source' as const,
    range: request.queryRange,
    thresholds: {} as never,
  };
  const events: AgentTimelineEvent[] = (payloads.speechMarkers?.markers ?? []).flatMap((marker) => {
    const range = clipRange(marker, request.queryRange);
    if (!range) return [];
    const data = markerData(marker.type, marker.text, marker.wordIds?.[0]);
    return [{
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: stableEventId([data.marker, marker.start, marker.end]),
      type: 'speech-marker',
      time: eventTime(context, range),
      confidence: clampConfidence(marker.confidence),
      provenance: [...provenance],
      data,
    }];
  });
  const speech = mergedSpeechRanges(payloads, request.queryRange);
  const interiorGaps = speech.slice(0, -1).flatMap((segment, index) => {
    const next = speech[index + 1];
    return next && next.start - segment.end >= PAUSE_MIN_SECONDS
      ? [{ start: segment.end, end: next.start }]
      : [];
  });
  for (const gap of interiorGaps) {
    const occupied = events.some((event) =>
      event.time.temporalKind === 'interval'
      && event.time.start < gap.end
      && event.time.end > gap.start);
    if (occupied) continue;
    events.push({
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: stableEventId(['pause', gap.start, gap.end]),
      type: 'speech-marker',
      time: eventTime(context, gap),
      confidence: 0.9,
      provenance: [...provenance],
      data: { marker: 'pause' },
    });
  }
  return events;
}

export function adaptAudioIntelligenceArtifacts(
  payloads: AudioIntelligencePayloads,
  request: LegacyAdapterRequest,
): AudioIntelligenceLegacyViews {
  const artifactSources = sources(payloads);
  const artifactRefs = artifactSources.map((source) => source.artifactRef);
  const artifactProvenances = artifactSources.map(artifactProvenance);
  const adapter = adapterProvenance(request);
  const allProvenance = uniqueProvenance([...artifactProvenances, adapter]);
  const windowMeasurements = measurements(payloads);
  const speech = mergedSpeechRanges(payloads, request.queryRange);
  const silence = silenceRanges(payloads, speech, request.queryRange, windowMeasurements);
  const transients = transientRanges(payloads, request.queryRange, windowMeasurements);
  const coverage = detectorCoverage(payloads, request);
  const hasAudio = payloads.loudness !== undefined
    || payloads.onsets !== undefined
    || payloads.voiceActivity !== undefined;
  const qualityAudioEvents = hasAudio ? deriveQualityAudioEvents({
    sourceId: request.artifactRef ?? 'audio-intelligence',
    timeDomain: 'source',
    range: request.queryRange,
    audio: {
      measurements: windowMeasurements,
      silenceRanges: silence,
      transientRanges: transients,
      coverage,
      provenance: {
        analyzerId: 'audio-intelligence-artifacts',
        analyzerVersion: ADAPTER_ANALYZER_VERSION,
        artifactRefs,
      },
    },
  }).events : [];
  const classificationEvents = windowMeasurements.length > 0 ? deriveAudioClassifications({
    sourceId: request.artifactRef ?? 'audio-intelligence',
    timeDomain: 'source',
    range: request.queryRange,
    features: featureWindows(windowMeasurements, payloads),
    transcript: speech,
    provenance: {
      analyzerId: 'audio-intelligence-artifacts',
      analyzerVersion: ADAPTER_ANALYZER_VERSION,
      artifactRefs,
    },
  }).events : [];
  const audioEvents = [...qualityAudioEvents, ...classificationEvents]
    .map((event) => eventWithProvenance(event, artifactProvenances, adapter));
  const markerEvents = speechMarkerEvents(payloads, request, allProvenance);
  const speechCoverage = [
    payloads.speechMarkers?.manifest.duration,
    payloads.voiceActivity?.manifest.duration,
  ].filter((duration): duration is number => typeof duration === 'number'
      && Number.isFinite(duration) && duration > 0)
    .flatMap((duration) => {
      const clipped = clipRange({ start: 0, end: duration }, request.queryRange);
      return clipped ? [clipped] : [];
    });
  return {
    ...(hasAudio ? {
      audioView: createLegacyView({
        channel: 'audio',
        request,
        sourcePresent: true,
        coverage,
        provenance: allProvenance,
        artifactRefs,
        events: audioEvents,
      }),
    } : {}),
    ...(payloads.speechMarkers || payloads.voiceActivity ? {
      speechMarkerView: createLegacyView({
        channel: 'speech',
        request,
        sourcePresent: true,
        coverage: speechCoverage,
        provenance: allProvenance,
        artifactRefs,
        events: markerEvents,
      }),
    } : {}),
  };
}
