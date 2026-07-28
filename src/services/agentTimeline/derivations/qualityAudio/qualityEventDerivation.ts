import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineRange,
} from '../../../../types/agentTimeline/manifest';
import type {
  QualityAudioDerivationCoverage,
  QualityMeasurementInput,
  QualityMeasurementSample,
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

type QualityEvent = Extract<AgentTimelineEvent, { type: 'quality-issue' }>;

interface SampleWindow {
  sample: QualityMeasurementSample;
  range: AgentTimelineRange;
}

interface IssueCandidate {
  range: AgentTimelineRange;
  measurement: number;
  confidence: number;
}

interface QualityDerivation {
  events: QualityEvent[];
  coverage: Pick<
    Record<'black' | 'exposure' | 'focus' | 'freeze', QualityAudioDerivationCoverage>,
    'black' | 'exposure' | 'focus' | 'freeze'
  >;
}

function sampleWindows(
  input: QualityMeasurementInput,
  context: DerivationContext,
): readonly SampleWindow[] {
  const samples = input.samples
    .filter(sample => Number.isFinite(sample.time))
    .toSorted((left, right) => left.time - right.time);
  return samples.flatMap((sample, index) => {
    const nextTime = samples[index + 1]?.time;
    const naturalEnd = sample.time + context.thresholds.qualitySampleDuration;
    const end = Number.isFinite(nextTime) ? Math.min(naturalEnd, nextTime as number) : naturalEnd;
    const range = clipRange({ start: sample.time, end }, context.range);
    return range ? [{ sample, range }] : [];
  });
}

function mergeCandidates(
  candidates: readonly IssueCandidate[],
  maxGap: number,
  measurementMode: 'min' | 'max',
): readonly IssueCandidate[] {
  const merged: IssueCandidate[] = [];
  for (const candidate of candidates.toSorted((left, right) =>
    left.range.start - right.range.start || left.range.end - right.range.end)) {
    const previous = merged.at(-1);
    if (previous && candidate.range.start <= previous.range.end + maxGap) {
      previous.range.end = Math.max(previous.range.end, candidate.range.end);
      previous.measurement = measurementMode === 'min'
        ? Math.min(previous.measurement, candidate.measurement)
        : Math.max(previous.measurement, candidate.measurement);
      previous.confidence = Math.min(previous.confidence, candidate.confidence);
    } else {
      merged.push({ ...candidate, range: { ...candidate.range } });
    }
  }
  return merged;
}

function issueEvent(
  context: DerivationContext,
  input: QualityMeasurementInput,
  kind: 'black' | 'exposure' | 'focus' | 'freeze',
  candidate: IssueCandidate,
  threshold: number,
  unit: string,
  severity: 'warning' | 'critical',
): QualityEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([
      context.sourceId,
      kind,
      candidate.range.start,
      candidate.range.end,
      candidate.measurement,
      threshold,
      unit,
    ]),
    type: 'quality-issue',
    time: eventTime(context, candidate.range),
    confidence: clamp01(candidate.confidence, 0.75),
    provenance: provenance(input.provenance),
    data: {
      issue: kind,
      severity,
      measurement: candidate.measurement,
      threshold,
      unit,
    },
  };
}

function metricCandidates(
  windows: readonly SampleWindow[],
  select: (sample: QualityMeasurementSample) => number | undefined,
  matches: (value: number) => boolean,
  context: DerivationContext,
  mode: 'min' | 'max',
): readonly IssueCandidate[] {
  return mergeCandidates(windows.flatMap(({ sample, range }) => {
    const value = select(sample);
    return Number.isFinite(value) && matches(value as number)
      ? [{
          range,
          measurement: value as number,
          confidence: clamp01(sample.confidence, 0.75),
        }]
      : [];
  }), context.thresholds.qualityMergeGap, mode)
    .filter(candidate =>
      candidate.range.end - candidate.range.start >= context.thresholds.qualityMinIssueDuration);
}

function metricCoverage(
  windows: readonly SampleWindow[],
  select: (sample: QualityMeasurementSample) => number | undefined,
): AgentTimelineRange[] {
  return windows.flatMap(window => Number.isFinite(select(window.sample)) ? [window.range] : []);
}

function freezeCandidates(
  windows: readonly SampleWindow[],
  context: DerivationContext,
): { candidates: readonly IssueCandidate[]; coverage: readonly AgentTimelineRange[] } {
  const candidates: IssueCandidate[] = [];
  const coverage: AgentTimelineRange[] = [];
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    const hashComparable = Boolean(previous.sample.frameHash && current.sample.frameHash);
    const differenceAvailable = Number.isFinite(current.sample.frameDifference);
    if (!hashComparable && !differenceAvailable) continue;
    const range = clipRange({
      start: previous.sample.time,
      end: current.range.end,
    }, context.range);
    if (!range) continue;
    coverage.push(range);
    const difference = differenceAvailable
      ? Math.max(0, current.sample.frameDifference as number)
      : previous.sample.frameHash === current.sample.frameHash ? 0 : 1;
    if (difference <= context.thresholds.frameDifferenceMax) {
      candidates.push({
        range,
        measurement: difference,
        confidence: Math.min(
          clamp01(previous.sample.confidence, 0.8),
          clamp01(current.sample.confidence, 0.8),
        ),
      });
    }
  }
  return {
    candidates: mergeCandidates(candidates, context.thresholds.qualityMergeGap, 'max')
      .filter(candidate =>
        candidate.range.end - candidate.range.start >= context.thresholds.freezeMinDuration),
    coverage,
  };
}

export function deriveQualityEvents(
  input: QualityMeasurementInput | undefined,
  context: DerivationContext,
): QualityDerivation {
  if (!input) {
    const missing = (kind: 'black' | 'exposure' | 'focus' | 'freeze') =>
      coverageSummary(kind, context.range, [], 'missing', 'No persisted quality measurements are available.');
    return {
      events: [],
      coverage: {
        black: missing('black'),
        exposure: missing('exposure'),
        focus: missing('focus'),
        freeze: missing('freeze'),
      },
    };
  }
  const windows = sampleWindows(input, context);
  const brightnessCoverage = input.coverage && windows.length > 0 &&
    windows.every(window => Number.isFinite(window.sample.brightness))
    ? input.coverage
    : metricCoverage(windows, sample => sample.brightness);
  const focusCoverage = input.coverage && windows.length > 0 &&
    windows.every(window => Number.isFinite(window.sample.focus))
    ? input.coverage
    : metricCoverage(windows, sample => sample.focus);
  const black = metricCandidates(
    windows,
    sample => sample.brightness,
    value => value <= context.thresholds.blackBrightnessMax,
    context,
    'min',
  );
  const underexposed = metricCandidates(
    windows,
    sample => sample.brightness,
    value => value > context.thresholds.blackBrightnessMax &&
      value <= context.thresholds.underexposedBrightnessMax,
    context,
    'min',
  );
  const overexposed = metricCandidates(
    windows,
    sample => sample.brightness,
    value => value >= context.thresholds.overexposedBrightnessMin,
    context,
    'max',
  );
  const focus = metricCandidates(
    windows,
    sample => sample.focus,
    value => value < context.thresholds.focusMin,
    context,
    'min',
  );
  const freeze = freezeCandidates(windows, context);
  const freezeCoverage = input.coverage && windows.length > 1 &&
    windows.slice(1).every((window, index) =>
      Boolean(windows[index].sample.frameHash && window.sample.frameHash) ||
      Number.isFinite(window.sample.frameDifference))
    ? input.coverage
    : freeze.coverage;
  const events: QualityEvent[] = [
    ...black.map(candidate => issueEvent(
      context, input, 'black', candidate, context.thresholds.blackBrightnessMax,
      'normalized-brightness', candidate.measurement <= context.thresholds.blackBrightnessMax / 2 ? 'critical' : 'warning',
    )),
    ...underexposed.map(candidate => issueEvent(
      context, input, 'exposure', candidate, context.thresholds.underexposedBrightnessMax,
      'normalized-brightness-under', 'warning',
    )),
    ...overexposed.map(candidate => issueEvent(
      context, input, 'exposure', candidate, context.thresholds.overexposedBrightnessMin,
      'normalized-brightness-over', 'warning',
    )),
    ...focus.map(candidate => issueEvent(
      context, input, 'focus', candidate, context.thresholds.focusMin,
      'normalized-focus', 'warning',
    )),
    ...freeze.candidates.map(candidate => issueEvent(
      context, input, 'freeze', candidate, context.thresholds.frameDifferenceMax,
      'normalized-frame-difference', 'warning',
    )),
  ];
  return {
    events,
    coverage: {
      black: coverageSummary('black', context.range, brightnessCoverage, 'unknown', 'Brightness values are absent.'),
      exposure: coverageSummary('exposure', context.range, brightnessCoverage, 'unknown', 'Brightness values are absent.'),
      focus: coverageSummary('focus', context.range, focusCoverage, 'unknown', 'Focus values are absent.'),
      freeze: coverageSummary('freeze', context.range, freezeCoverage, 'unknown', 'No comparable frame hashes or differences are available.'),
    },
  };
}
