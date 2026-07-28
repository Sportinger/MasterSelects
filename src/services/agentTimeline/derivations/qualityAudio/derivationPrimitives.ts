import type {
  AgentTimelineProvenance,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from '../../../../types/agentTimeline/manifest';
import {
  QUALITY_AUDIO_DERIVATION_ANALYZER_VERSION,
  type DerivationCoverageStatus,
  type DerivationInputProvenance,
  type QualityAudioDerivationCoverage,
  type QualityAudioDerivationKind,
  type QualityAudioDerivationThresholds,
} from '../../../../types/agentTimeline/qualityAudioDerivations';

export const DEFAULT_QUALITY_AUDIO_THRESHOLDS: Readonly<QualityAudioDerivationThresholds> = Object.freeze({
  blackBrightnessMax: 0.03,
  underexposedBrightnessMax: 0.16,
  overexposedBrightnessMin: 0.94,
  focusMin: 0.28,
  frameDifferenceMax: 0.003,
  freezeMinDuration: 1.5,
  qualitySampleDuration: 0.5,
  qualityMergeGap: 0.05,
  qualityMinIssueDuration: 0.25,
  clippingPeakDb: -0.1,
  quietLoudnessDb: -48,
  quietMinDuration: 1,
  unexpectedSilenceMinDuration: 2,
  audioMergeGap: 0.08,
});

export interface DerivationContext {
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  range: AgentTimelineRange;
  thresholds: QualityAudioDerivationThresholds;
}

export function clamp01(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value as number)) : fallback;
}

export function stableEventId(parts: readonly (string | number)[]): string {
  const value = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `derived-${(hash >>> 0).toString(36).padStart(7, '0')}`;
}

export function eventTime(context: DerivationContext, range: AgentTimelineRange) {
  return {
    temporalKind: 'interval' as const,
    timeDomain: context.timeDomain,
    start: range.start,
    end: range.end,
    ...(context.stateHash ? { stateHash: context.stateHash } : {}),
  };
}

export function provenance(input: DerivationInputProvenance): AgentTimelineProvenance[] {
  const refs = [...new Set(input.artifactRefs ?? [])].toSorted();
  if (refs.length === 0) {
    return [{
      kind: 'analyzer',
      analyzerId: input.analyzerId,
      analyzerVersion: input.analyzerVersion || QUALITY_AUDIO_DERIVATION_ANALYZER_VERSION,
    }];
  }
  return refs.map(artifactRef => ({
    kind: 'analyzer' as const,
    analyzerId: input.analyzerId,
    analyzerVersion: input.analyzerVersion || QUALITY_AUDIO_DERIVATION_ANALYZER_VERSION,
    artifactRef,
  }));
}

export function clipRange(
  range: AgentTimelineRange,
  bounds: AgentTimelineRange,
): AgentTimelineRange | undefined {
  const start = Math.max(range.start, bounds.start);
  const end = Math.min(range.end, bounds.end);
  return end > start ? { start, end } : undefined;
}

export function mergeRanges(ranges: readonly AgentTimelineRange[]): AgentTimelineRange[] {
  const ordered = ranges
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function findMissing(
  bounds: AgentTimelineRange,
  coverage: readonly AgentTimelineRange[],
): AgentTimelineRange[] {
  const missing: AgentTimelineRange[] = [];
  let cursor = bounds.start;
  for (const item of mergeRanges(coverage.flatMap(range => {
    const clipped = clipRange(range, bounds);
    return clipped ? [clipped] : [];
  }))) {
    if (cursor < item.start) missing.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < bounds.end) missing.push({ start: cursor, end: bounds.end });
  return missing;
}

export function coverageSummary(
  kind: QualityAudioDerivationKind,
  bounds: AgentTimelineRange,
  coverage: readonly AgentTimelineRange[],
  emptyStatus: Extract<DerivationCoverageStatus, 'missing' | 'unknown'>,
  reason?: string,
): QualityAudioDerivationCoverage {
  const covered = mergeRanges(coverage.flatMap(range => {
    const clipped = clipRange(range, bounds);
    return clipped ? [clipped] : [];
  }));
  const missing = findMissing(bounds, covered);
  return {
    kind,
    status: covered.length === 0 ? emptyStatus : missing.length === 0 ? 'complete' : 'partial',
    covered,
    missing,
    ...(covered.length === 0 && reason ? { reason } : {}),
  };
}

function requireFinite(name: keyof QualityAudioDerivationThresholds, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

export function normalizeThresholds(
  input: Partial<QualityAudioDerivationThresholds> | undefined,
): QualityAudioDerivationThresholds {
  const thresholds = { ...DEFAULT_QUALITY_AUDIO_THRESHOLDS, ...input };
  for (const [name, value] of Object.entries(thresholds)) {
    requireFinite(name as keyof QualityAudioDerivationThresholds, value);
  }
  if (thresholds.blackBrightnessMax < 0 ||
      thresholds.underexposedBrightnessMax <= thresholds.blackBrightnessMax ||
      thresholds.overexposedBrightnessMin <= thresholds.underexposedBrightnessMax ||
      thresholds.overexposedBrightnessMin > 1) {
    throw new RangeError('Brightness thresholds must be ordered within 0..1');
  }
  if (thresholds.focusMin < 0 || thresholds.focusMin > 1 ||
      thresholds.frameDifferenceMax < 0 || thresholds.frameDifferenceMax > 1) {
    throw new RangeError('Focus and frame-difference thresholds must be within 0..1');
  }
  for (const field of [
    'freezeMinDuration',
    'qualitySampleDuration',
    'qualityMinIssueDuration',
    'quietMinDuration',
    'unexpectedSilenceMinDuration',
  ] as const) {
    if (thresholds[field] <= 0) throw new RangeError(`${field} must be positive`);
  }
  if (thresholds.qualityMergeGap < 0 || thresholds.audioMergeGap < 0) {
    throw new RangeError('Merge gaps must be non-negative');
  }
  return thresholds;
}
