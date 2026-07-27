import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineProvenance,
} from '../../../../types/agentTimeline/manifest';
import {
  AUDIO_CLASSIFICATION_SCHEMA_VERSION,
  type AudioClassificationClassifier,
  type AudioClassificationDerivationOptions,
  type AudioClassificationDerivationResult,
  type AudioClassificationInput,
  type AudioClassificationSpan,
} from '../../../../types/agentTimeline/audioClassification';
import { persistedAudioHeuristicClassifier } from './heuristicAudioClassifier';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function stableEventId(parts: readonly (string | number)[]): string {
  const value = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `audio-class-${(hash >>> 0).toString(36).padStart(7, '0')}`;
}

function assertInput(input: AudioClassificationInput, mergeGapSeconds: number): void {
  if (!input.sourceId.trim()) throw new TypeError('sourceId is required');
  if (!Number.isFinite(input.range.start) || !Number.isFinite(input.range.end)
    || input.range.start < 0 || input.range.end <= input.range.start) {
    throw new RangeError('Classification range must be a non-negative half-open interval');
  }
  if (input.timeDomain === 'source' && input.stateHash !== undefined) {
    throw new TypeError('Source-time classifications must not carry a timeline stateHash');
  }
  if (input.timeDomain !== 'source' && !input.stateHash) {
    throw new TypeError('Rendered-time classifications require a stateHash');
  }
  if (!Number.isFinite(mergeGapSeconds) || mergeGapSeconds < 0) {
    throw new RangeError('mergeGapSeconds must be finite and non-negative');
  }
}

function clipSpan(span: AudioClassificationSpan, input: AudioClassificationInput): AudioClassificationSpan | undefined {
  if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) return undefined;
  const start = Math.max(input.range.start, span.start);
  const end = Math.min(input.range.end, span.end);
  return end > start ? { start, end, label: span.label, confidence: clamp01(span.confidence) } : undefined;
}

/** Merges only same-label adjacent/nearby samples into explicit half-open spans. */
export function mergeAudioClassificationSpans(
  spans: readonly AudioClassificationSpan[],
  mergeGapSeconds = 0,
): AudioClassificationSpan[] {
  const merged: AudioClassificationSpan[] = [];
  for (const span of spans.toSorted((left, right) => left.start - right.start || left.end - right.end || left.label.localeCompare(right.label))) {
    const previous = merged.at(-1);
    if (previous && previous.label === span.label && span.start <= previous.end + mergeGapSeconds) {
      previous.end = Math.max(previous.end, span.end);
      previous.confidence = Math.min(previous.confidence, span.confidence);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function eventProvenance(
  input: AudioClassificationInput,
  classifier: AudioClassificationClassifier,
): AgentTimelineProvenance[] {
  const artifactRefs = [...new Set(input.provenance.artifactRefs ?? [])].toSorted();
  const source = artifactRefs.length === 0 ? [{
    kind: 'analyzer' as const,
    analyzerId: input.provenance.analyzerId,
    analyzerVersion: input.provenance.analyzerVersion,
  }] : artifactRefs.map(artifactRef => ({
    kind: 'analyzer' as const,
    analyzerId: input.provenance.analyzerId,
    analyzerVersion: input.provenance.analyzerVersion,
    artifactRef,
  }));
  return [...source, {
    kind: 'analyzer',
    analyzerId: classifier.metadata.id,
    analyzerVersion: classifier.metadata.version,
    ...(classifier.metadata.modelId ? { modelId: classifier.metadata.modelId } : {}),
    ...(classifier.metadata.modelVersion ? { modelVersion: classifier.metadata.modelVersion } : {}),
  }];
}

/**
 * Converts persisted feature summaries into audio events. The supplied classifier
 * is pure and injected; this function deliberately performs no decode, fetch, or model load.
 */
export function deriveAudioClassifications(
  input: AudioClassificationInput,
  options: AudioClassificationDerivationOptions = {},
): AudioClassificationDerivationResult {
  const classifier = options.classifier ?? persistedAudioHeuristicClassifier;
  const mergeGapSeconds = options.mergeGapSeconds ?? 0;
  assertInput(input, mergeGapSeconds);
  const spans = mergeAudioClassificationSpans(
    classifier.classify(input).flatMap(span => {
      const clipped = clipSpan(span, input);
      return clipped ? [clipped] : [];
    }),
    mergeGapSeconds,
  );
  const provenance = eventProvenance(input, classifier);
  const events = spans.map(span => ({
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableEventId([input.sourceId, classifier.metadata.id, classifier.metadata.version, span.label, span.start, span.end]),
    type: 'audio-activity' as const,
    time: {
      temporalKind: 'interval' as const,
      timeDomain: input.timeDomain,
      start: span.start,
      end: span.end,
      ...(input.stateHash ? { stateHash: input.stateHash } : {}),
    },
    confidence: span.confidence,
    provenance,
    data: { activity: span.label },
  }));
  return {
    schemaVersion: AUDIO_CLASSIFICATION_SCHEMA_VERSION,
    sourceId: input.sourceId,
    timeDomain: input.timeDomain,
    stateHash: input.stateHash,
    range: { ...input.range },
    classifier: classifier.metadata,
    spans,
    events,
  };
}
