export const OCCURRENCE_MAPPING_SCHEMA_VERSION = 1 as const;

export interface HalfOpenTimeRange {
  /** Inclusive start in seconds. */
  start: number;
  /** Exclusive end in seconds. */
  end: number;
}

/** Ordered extent; equal endpoints are valid for a held source point. */
export interface TimeExtent {
  start: number;
  end: number;
}

export type OccurrenceMappingDirection = 'forward' | 'reverse' | 'hold';

/**
 * One analytically mappable part of a flattened occurrence.
 *
 * Rates are source-seconds per composition-second. Different start/end rates
 * describe a linear speed ramp; equal rates describe constant speed.
 */
export interface OccurrenceMappingPieceInput {
  compositionStart: number;
  compositionEnd: number;
  sourceStart: number;
  sourceRateStart: number;
  sourceRateEnd?: number;
}

export interface SourceOccurrenceMappingInput {
  sourceId: string;
  clipId: string;
  /** Root composition first, nested composition containing the clip last. */
  compositionPath: readonly string[];
  /** Half-open source trim applied before pieces enter the index. */
  sourceRange: HalfOpenTimeRange;
  pieces: readonly OccurrenceMappingPieceInput[];
  /** Optional stable discriminator for otherwise identical occurrences. */
  occurrenceKey?: string;
}

export interface BuildOccurrenceMappingIndexInput {
  /** Hash of the complete timeline state from which inputs were flattened. */
  stateHash: string;
  occurrences: readonly SourceOccurrenceMappingInput[];
}

export interface OccurrenceMappingSegment {
  mappingSegmentId: string;
  occurrenceId: string;
  sourceId: string;
  clipId: string;
  compositionPath: readonly string[];
  compositionRange: HalfOpenTimeRange;
  /** Ascending source extent; a hold has equal endpoints. */
  sourceRange: TimeExtent;
  /** Actual source value at compositionRange.start/end. */
  sourceStart: number;
  sourceEnd: number;
  sourceRateStart: number;
  sourceRateEnd: number;
  direction: OccurrenceMappingDirection;
}

export interface SourceOccurrenceMapping {
  occurrenceId: string;
  sourceId: string;
  clipId: string;
  compositionPath: readonly string[];
  sourceRange: HalfOpenTimeRange;
  mappingSegmentIds: readonly string[];
}

/**
 * Fully serializable lookup artifact. Query functions consume the prebuilt
 * segment-ID tables and never reconstruct/invert the timeline by sampling.
 */
export interface OccurrenceMappingIndex {
  schemaVersion: typeof OCCURRENCE_MAPPING_SCHEMA_VERSION;
  stateHash: string;
  occurrences: readonly SourceOccurrenceMapping[];
  segments: readonly OccurrenceMappingSegment[];
  segmentsById: Readonly<Record<string, OccurrenceMappingSegment>>;
  segmentIdsBySource: Readonly<Record<string, readonly string[]>>;
  segmentIdsByCompositionPath: Readonly<Record<string, readonly string[]>>;
}

export interface OccurrenceProjectionReference {
  occurrenceId: string;
  mappingSegmentId: string;
  sourceId: string;
  clipId: string;
  compositionPath: readonly string[];
  direction: OccurrenceMappingDirection;
}

export interface ProjectedSourcePoint extends OccurrenceProjectionReference {
  kind: 'point' | 'hold';
  sourceTime: number;
  localSpeed: number;
  /** Present for regular playback pieces. */
  compositionTime?: number;
  /** Present for a speed-0 piece: the source point persists for this range. */
  compositionRange?: HalfOpenTimeRange;
}

export interface ProjectedRegularSourceInterval extends OccurrenceProjectionReference {
  kind: 'interval';
  sourceRange: HalfOpenTimeRange;
  compositionRange: HalfOpenTimeRange;
  sourceRateStart: number;
  sourceRateEnd: number;
}

export interface ProjectedHeldSourceInterval extends OccurrenceProjectionReference {
  kind: 'hold';
  sourceTime: number;
  compositionRange: HalfOpenTimeRange;
  sourceRateStart: 0;
  sourceRateEnd: 0;
}

export type ProjectedSourceInterval =
  | ProjectedRegularSourceInterval
  | ProjectedHeldSourceInterval;

export interface ProjectedCompositionPoint extends OccurrenceProjectionReference {
  compositionTime: number;
  sourceTime: number;
  localSpeed: number;
  isHold: boolean;
}

export interface ProjectedCompositionInterval extends OccurrenceProjectionReference {
  kind: 'interval' | 'hold';
  compositionRange: HalfOpenTimeRange;
  /** Present for a non-hold mapping. */
  sourceRange?: HalfOpenTimeRange;
  /** Present when the composition interval freezes one source point. */
  sourceTime?: number;
  sourceStart: number;
  sourceEnd: number;
  sourceRateStart: number;
  sourceRateEnd: number;
}

export interface SourceProjectionQuery {
  sourceId: string;
  /** Optional exact nested-composition path filter. */
  compositionPath?: readonly string[];
}

export interface SourcePointProjectionQuery extends SourceProjectionQuery {
  sourceTime: number;
}

export interface SourceIntervalProjectionQuery extends SourceProjectionQuery {
  sourceRange: HalfOpenTimeRange;
}

export interface CompositionProjectionQuery {
  /** Exact path used to select a prebuilt composition-path index. */
  compositionPath: readonly string[];
  sourceId?: string;
}

export interface CompositionPointProjectionQuery extends CompositionProjectionQuery {
  compositionTime: number;
}

export interface CompositionIntervalProjectionQuery extends CompositionProjectionQuery {
  compositionRange: HalfOpenTimeRange;
}
