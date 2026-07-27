import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineRange,
} from '../../../../types/agentTimeline/manifest';
import type {
  AudioMeasurementInput,
  AudioMeasurementWindow,
  PersistedSilenceRange,
  PersistedTransientRange,
  QualityAudioDerivationCoverage,
} from '../../../../types/agentTimeline/qualityAudioDerivations';
import {
  clamp01,
  clipRange,
  coverageSummary,
  eventTime,
  provenance,
  stableEventId,
  type DerivationContext,
} from './derivationPrimitives';

type AudioEvent = Extract<AgentTimelineEvent, { type: 'audio-activity' }>;
type QualityEvent = Extract<AgentTimelineEvent, { type: 'quality-issue' }>;

interface AudioDerivation {
  events: Array<AudioEvent | QualityEvent>;
  coverage: Pick<
    Record<'loudness' | 'peak' | 'clipping' | 'quiet' | 'silence' | 'transient', QualityAudioDerivationCoverage>,
    'loudness' | 'peak' | 'clipping' | 'quiet' | 'silence' | 'transient'
  >;
}

interface AudioCandidate {
  range: AgentTimelineRange;
  measurement: number;
  confidence: number;
}

function validWindow(
  window: AudioMeasurementWindow,
  bounds: AgentTimelineRange,
): { window: AudioMeasurementWindow; range: AgentTimelineRange } | undefined {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) return undefined;
  const range = clipRange(window, bounds);
  return range ? { window, range } : undefined;
}

function mergeCandidates(
  candidates: readonly AudioCandidate[],
  maxGap: number,
  mode: 'min' | 'max',
): readonly AudioCandidate[] {
  const merged: AudioCandidate[] = [];
  for (const candidate of candidates.toSorted((left, right) =>
    left.range.start - right.range.start || left.range.end - right.range.end)) {
    const previous = merged.at(-1);
    if (previous && candidate.range.start <= previous.range.end + maxGap) {
      previous.range.end = Math.max(previous.range.end, candidate.range.end);
      previous.measurement = mode === 'min'
        ? Math.min(previous.measurement, candidate.measurement)
        : Math.max(previous.measurement, candidate.measurement);
      previous.confidence = Math.min(previous.confidence, candidate.confidence);
    } else {
      merged.push({ ...candidate, range: { ...candidate.range } });
    }
  }
  return merged;
}

function measurementEvent(
  context: DerivationContext,
  input: AudioMeasurementInput,
  window: AudioMeasurementWindow,
  range: AgentTimelineRange,
): AudioEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([
      context.sourceId,
      'audio-measurement',
      range.start,
      range.end,
      window.loudnessDb ?? 'none',
      window.peakDb ?? 'none',
      window.activity ?? 'unknown',
    ]),
    type: 'audio-activity',
    time: eventTime(context, range),
    confidence: clamp01(window.confidence, 0.9),
    provenance: provenance(input.provenance),
    data: {
      activity: window.activity ?? 'unknown',
      ...(Number.isFinite(window.loudnessDb) ? { loudnessDb: window.loudnessDb } : {}),
      ...(Number.isFinite(window.peakDb) ? { peakDb: window.peakDb } : {}),
    },
  };
}

function qualityEvent(
  context: DerivationContext,
  input: AudioMeasurementInput,
  issue: 'clipping' | 'quiet' | 'silence',
  candidate: AudioCandidate,
  threshold: number,
): QualityEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([
      context.sourceId,
      issue,
      candidate.range.start,
      candidate.range.end,
      candidate.measurement,
      threshold,
    ]),
    type: 'quality-issue',
    time: eventTime(context, candidate.range),
    confidence: clamp01(candidate.confidence, 0.85),
    provenance: provenance(input.provenance),
    data: {
      issue,
      severity: issue === 'clipping' ? 'critical' : 'warning',
      measurement: candidate.measurement,
      threshold,
      unit: issue === 'clipping' ? 'dbfs-peak' : 'dbfs-rms',
    },
  };
}

function silenceEvent(
  context: DerivationContext,
  input: AudioMeasurementInput,
  silence: PersistedSilenceRange,
  range: AgentTimelineRange,
): AudioEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([context.sourceId, 'silence', range.start, range.end, silence.rmsDb]),
    type: 'audio-activity',
    time: eventTime(context, range),
    confidence: clamp01(silence.confidence, 0.9),
    provenance: provenance(input.provenance),
    data: { activity: 'silence', loudnessDb: silence.rmsDb },
  };
}

function transientEvent(
  context: DerivationContext,
  input: AudioMeasurementInput,
  transient: PersistedTransientRange,
  range: AgentTimelineRange,
): AudioEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([
      context.sourceId,
      'transient',
      range.start,
      range.end,
      transient.peakDb,
      transient.crestDb ?? 'none',
    ]),
    type: 'audio-activity',
    time: eventTime(context, range),
    confidence: clamp01(transient.confidence, 0.85),
    provenance: provenance(input.provenance),
    data: { activity: 'transient', peakDb: transient.peakDb, loudnessDb: transient.rmsDb },
  };
}

function detectorCoverage(
  input: AudioMeasurementInput,
  ranges: readonly AgentTimelineRange[],
): readonly AgentTimelineRange[] {
  return input.coverage && input.coverage.length > 0 ? input.coverage : ranges;
}

export function deriveAudioEvents(
  input: AudioMeasurementInput | undefined,
  context: DerivationContext,
): AudioDerivation {
  if (!input) {
    const missing = (kind: 'loudness' | 'peak' | 'clipping' | 'quiet' | 'silence' | 'transient') =>
      coverageSummary(kind, context.range, [], 'missing', 'No persisted audio measurements are available.');
    return {
      events: [],
      coverage: {
        loudness: missing('loudness'),
        peak: missing('peak'),
        clipping: missing('clipping'),
        quiet: missing('quiet'),
        silence: missing('silence'),
        transient: missing('transient'),
      },
    };
  }

  const windows = (input.measurements ?? [])
    .flatMap(window => {
      const valid = validWindow(window, context.range);
      return valid ? [valid] : [];
    })
    .toSorted((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  const loudnessCoverage = windows.flatMap(item =>
    Number.isFinite(item.window.loudnessDb) ? [item.range] : []);
  const peakCoverage = windows.flatMap(item =>
    Number.isFinite(item.window.peakDb) ? [item.range] : []);
  const clipping = mergeCandidates(windows.flatMap(({ window, range }) =>
    Number.isFinite(window.peakDb) && (window.peakDb as number) >= context.thresholds.clippingPeakDb
      ? [{
          range,
          measurement: window.peakDb as number,
          confidence: clamp01(window.confidence, 0.9),
        }]
      : []), context.thresholds.audioMergeGap, 'max');
  const quiet = mergeCandidates(windows.flatMap(({ window, range }) =>
    Number.isFinite(window.loudnessDb) && (window.loudnessDb as number) <= context.thresholds.quietLoudnessDb
      ? [{
          range,
          measurement: window.loudnessDb as number,
          confidence: clamp01(window.confidence, 0.85),
        }]
      : []), context.thresholds.audioMergeGap, 'min')
    .filter(candidate =>
      candidate.range.end - candidate.range.start >= context.thresholds.quietMinDuration);

  const silences = (input.silenceRanges ?? []).flatMap(silence => {
    const range = clipRange(silence, context.range);
    return range ? [{ silence, range }] : [];
  }).toSorted((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  const transients = (input.transientRanges ?? []).flatMap(transient => {
    const range = clipRange(transient, context.range);
    return range ? [{ transient, range }] : [];
  }).toSorted((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  const longSilences: AudioCandidate[] = silences
    .filter(item => item.range.end - item.range.start >= context.thresholds.unexpectedSilenceMinDuration)
    .map(({ silence, range }) => ({
      range,
      measurement: silence.rmsDb,
      confidence: clamp01(silence.confidence, 0.9),
    }));

  const events: Array<AudioEvent | QualityEvent> = [
    ...windows
      .filter(({ window }) =>
        Number.isFinite(window.loudnessDb) ||
        Number.isFinite(window.peakDb) ||
        window.activity !== undefined)
      .map(({ window, range }) => measurementEvent(context, input, window, range)),
    ...clipping.map(candidate => qualityEvent(
      context, input, 'clipping', candidate, context.thresholds.clippingPeakDb,
    )),
    ...quiet.map(candidate => qualityEvent(
      context, input, 'quiet', candidate, context.thresholds.quietLoudnessDb,
    )),
    ...silences.map(({ silence, range }) => silenceEvent(context, input, silence, range)),
    ...longSilences.map(candidate => qualityEvent(
      context, input, 'silence', candidate, context.thresholds.quietLoudnessDb,
    )),
    ...transients.map(({ transient, range }) => transientEvent(context, input, transient, range)),
  ];

  const silenceCoverage = input.silenceRanges === undefined
    ? []
    : detectorCoverage(input, silences.map(item => item.range));
  const transientCoverage = input.transientRanges === undefined
    ? []
    : detectorCoverage(input, transients.map(item => item.range));
  return {
    events,
    coverage: {
      loudness: coverageSummary('loudness', context.range, loudnessCoverage, 'unknown', 'No persisted loudness windows are available.'),
      peak: coverageSummary('peak', context.range, peakCoverage, 'unknown', 'No persisted peak windows are available.'),
      clipping: coverageSummary('clipping', context.range, peakCoverage, 'unknown', 'Clipping requires persisted peak windows.'),
      quiet: coverageSummary('quiet', context.range, loudnessCoverage, 'unknown', 'Quiet detection requires persisted loudness windows.'),
      silence: coverageSummary(
        'silence',
        context.range,
        silenceCoverage,
        'unknown',
        input.silenceRanges === undefined
          ? 'Silence detection has not produced a persisted result.'
          : 'Silence results exist, but their evaluated coverage is unknown.',
      ),
      transient: coverageSummary(
        'transient',
        context.range,
        transientCoverage,
        'unknown',
        input.transientRanges === undefined
          ? 'Transient detection has not produced a persisted result.'
          : 'Transient results exist, but their evaluated coverage is unknown.',
      ),
    },
  };
}
