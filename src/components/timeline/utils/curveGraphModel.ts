import {
  describePropertyAuthoringDescriptor,
  propertyValueFromStorage,
  propertyValueToStorage,
} from '../../../services/properties/propertyAuthoring';
import type {
  AnimatableProperty,
  BezierHandle,
} from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import type {
  PropertyAuthoringContext,
  PropertyDescriptor,
} from '../../../types/propertyRegistry';
import {
  computeCurveValueRange,
  getPropertyDefaults,
  type CurveValueRange,
} from './curveEditorMath';

export const GLOBAL_CURVE_MAX_SERIES = 24;
export const GLOBAL_CURVE_MAX_KEYFRAMES = 2_000;

const CURVE_SERIES_COLORS = [
  '#f59e0b',
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  '#60a5fa',
  '#f472b6',
  '#facc15',
] as const;

export interface CurveGraphPropertyTarget {
  clipId: string;
  path: string;
  descriptor: PropertyDescriptor;
}

export interface BuildCurveGraphModelInput {
  propertyTargets: readonly CurveGraphPropertyTarget[];
  clips: readonly TimelineClip[];
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  selectedKeyframeIds?: ReadonlySet<string>;
  activeSeriesId?: string | null;
  authoringContextByClipId?: ReadonlyMap<string, PropertyAuthoringContext>;
  maxSeries?: number;
  maxKeyframes?: number;
}

export interface CurveGraphKeyframe {
  id: string;
  clipId: string;
  property: AnimatableProperty;
  localTime: number;
  compositionTime: number;
  storageValue: number;
  authoringValue: number;
  easing: Keyframe['easing'];
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
  keyframe: Keyframe;
}

export interface CurveGraphSeries {
  id: string;
  clipId: string;
  clipName: string;
  property: AnimatableProperty;
  label: string;
  group: string;
  unit?: string;
  step?: number;
  range: CurveValueRange;
  editRange?: { min?: number; max?: number };
  color: string;
  clipStartTime: number;
  clipDuration: number;
  descriptor: PropertyDescriptor;
  authoringContext?: PropertyAuthoringContext;
  keyframes: CurveGraphKeyframe[];
}

export interface CurveGraphOmittedSeries {
  id: string;
  reason: 'missing-clip' | 'non-numeric' | 'descriptor-mismatch' | 'authoring-conversion-failed';
}

export interface CurveGraphModel {
  series: CurveGraphSeries[];
  activeSeriesId: string | null;
  selectedKeyframeIds: Set<string>;
  omittedSeries: CurveGraphOmittedSeries[];
  totalCandidateSeries: number;
  totalKeyframes: number;
  renderedKeyframes: number;
  seriesLimit: number;
  keyframeLimit: number;
  truncatedSeries: boolean;
  truncatedKeyframes: boolean;
}

export interface CurveGraphDragTarget {
  series: CurveGraphSeries;
  keyframe: CurveGraphKeyframe;
}

export interface CurveGraphPlannedKeyframeEdit extends CurveGraphDragTarget {
  requestedLocalTime: number;
  resolvedLocalTime: number;
  storageValue?: number;
}

export interface PlanCurveGraphKeyframeDragInput {
  targets: readonly CurveGraphDragTarget[];
  activeSeriesId: string;
  requestedCompositionDelta: number;
  requestedAuthoringDelta: number;
}

export function getCurveSeriesId(clipId: string, property: string): string {
  return `${clipId}::${property}`;
}

export function curveLocalTimeToCompositionTime(
  clipStartTime: number,
  localTime: number,
): number {
  return clipStartTime + localTime;
}

export function curveCompositionTimeToLocalTime(
  clipStartTime: number,
  clipDuration: number,
  compositionTime: number,
): number {
  return Math.max(0, Math.min(clipDuration, compositionTime - clipStartTime));
}

function authoringScale(
  descriptor: PropertyDescriptor,
  context?: PropertyAuthoringContext,
): number {
  const codec = descriptor.authoring?.codec ?? 'identity';
  const usesHalfExtent = codec === 'composition-half-extent'
    || (codec === 'transform-position' && context?.positionUnitMode === 'composition-pixels');
  if (!usesHalfExtent) return 1;
  if (!context) throw new Error(`${descriptor.path} requires an authoring context`);
  return descriptor.authoring?.axis === 'y'
    ? context.compositionHeight / 2
    : context.compositionWidth / 2;
}

export function curveStorageDeltaToAuthoring(
  descriptor: PropertyDescriptor,
  delta: number,
  context?: PropertyAuthoringContext,
): number {
  return delta * authoringScale(descriptor, context);
}

export function curveAuthoringDeltaToStorage(
  descriptor: PropertyDescriptor,
  delta: number,
  context?: PropertyAuthoringContext,
): number {
  return delta / authoringScale(descriptor, context);
}

export function curveAuthoringValueToStorage(
  series: Pick<CurveGraphSeries, 'descriptor' | 'authoringContext' | 'editRange'>,
  value: number,
): number {
  const clamped = Math.max(
    series.editRange?.min ?? Number.NEGATIVE_INFINITY,
    Math.min(series.editRange?.max ?? Number.POSITIVE_INFINITY, value),
  );
  const stored = propertyValueToStorage(series.descriptor, clamped, series.authoringContext);
  if (typeof stored !== 'number' || !Number.isFinite(stored)) {
    throw new Error(`${series.descriptor.path} did not resolve to a finite stored value`);
  }
  return stored;
}

/**
 * Plans one global-graph drag without mutating the model. Composition-time X
 * movement is shared by every target, then clamped once per clip so keyframes
 * from the same clip preserve their spacing. Authoring-space Y movement only
 * affects targets in the active series.
 */
export function planCurveGraphKeyframeDrag(
  input: PlanCurveGraphKeyframeDragInput,
): CurveGraphPlannedKeyframeEdit[] {
  const uniqueTargets: CurveGraphDragTarget[] = [];
  const seenKeyframeIds = new Set<string>();
  for (const target of input.targets) {
    if (seenKeyframeIds.has(target.keyframe.id)) continue;
    seenKeyframeIds.add(target.keyframe.id);
    uniqueTargets.push(target);
  }

  const resolvedDeltaByClipId = new Map<string, number>();
  for (const target of uniqueTargets) {
    if (resolvedDeltaByClipId.has(target.series.clipId)) continue;
    const clipTargets = uniqueTargets.filter(
      (candidate) => candidate.series.clipId === target.series.clipId,
    );
    const minimumDelta = Math.max(
      ...clipTargets.map((candidate) => -candidate.keyframe.localTime),
    );
    const maximumDelta = Math.min(
      ...clipTargets.map((candidate) => (
        candidate.series.clipDuration - candidate.keyframe.localTime
      )),
    );
    resolvedDeltaByClipId.set(
      target.series.clipId,
      Math.max(minimumDelta, Math.min(maximumDelta, input.requestedCompositionDelta)),
    );
  }

  return uniqueTargets.map((target) => {
    const resolvedDelta = resolvedDeltaByClipId.get(target.series.clipId) ?? 0;
    const planned: CurveGraphPlannedKeyframeEdit = {
      ...target,
      requestedLocalTime: target.keyframe.localTime + input.requestedCompositionDelta,
      resolvedLocalTime: target.keyframe.localTime + resolvedDelta,
    };
    if (target.series.id === input.activeSeriesId) {
      planned.storageValue = curveAuthoringValueToStorage(
        target.series,
        target.keyframe.authoringValue + input.requestedAuthoringDelta,
      );
    }
    return planned;
  });
}

export function buildCurveGraphModel(input: BuildCurveGraphModelInput): CurveGraphModel {
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const selectedInput = input.selectedKeyframeIds ?? new Set<string>();
  const seriesLimit = normalizeLimit(input.maxSeries, GLOBAL_CURVE_MAX_SERIES);
  const keyframeLimit = normalizeLimit(input.maxKeyframes, GLOBAL_CURVE_MAX_KEYFRAMES);
  const omittedSeries: CurveGraphOmittedSeries[] = [];
  const candidates: CurveGraphPropertyTarget[] = [];
  const seenSeries = new Set<string>();

  for (const target of input.propertyTargets) {
    const id = getCurveSeriesId(target.clipId, target.path);
    if (seenSeries.has(id)) continue;
    seenSeries.add(id);
    if (!clipsById.has(target.clipId)) {
      omittedSeries.push({ id, reason: 'missing-clip' });
      continue;
    }
    if (target.descriptor.path !== target.path) {
      omittedSeries.push({ id, reason: 'descriptor-mismatch' });
      continue;
    }
    if (!target.descriptor.animatable || target.descriptor.valueType !== 'number') {
      omittedSeries.push({ id, reason: 'non-numeric' });
      continue;
    }
    candidates.push(target);
  }

  const totalCandidateSeries = candidates.length;
  const totalKeyframes = candidates.reduce((total, target) => (
    total + countSeriesKeyframes(input.clipKeyframes, target)
  ), 0);
  let remainingKeyframes = keyframeLimit;
  const series: CurveGraphSeries[] = [];

  for (const target of candidates.slice(0, seriesLimit)) {
    const clip = clipsById.get(target.clipId)!;
    const context = input.authoringContextByClipId?.get(clip.id);
    const id = getCurveSeriesId(clip.id, target.path);
    try {
      const descriptorView = describePropertyAuthoringDescriptor(target.descriptor, {
        clip,
        context,
      });
      const sourceKeyframes = getSeriesKeyframes(input.clipKeyframes, target);
      const renderedSourceKeyframes = sourceKeyframes.slice(0, remainingKeyframes);
      const keyframes = renderedSourceKeyframes.map((keyframe): CurveGraphKeyframe => {
        const authoringValue = propertyValueFromStorage(
          target.descriptor,
          keyframe.value,
          context,
        );
        if (typeof authoringValue !== 'number' || !Number.isFinite(authoringValue)) {
          throw new Error(`${target.path} keyframe did not resolve to a finite authoring value`);
        }
        return {
          id: keyframe.id,
          clipId: clip.id,
          property: target.path as AnimatableProperty,
          localTime: keyframe.time,
          compositionTime: curveLocalTimeToCompositionTime(clip.startTime, keyframe.time),
          storageValue: keyframe.value,
          authoringValue,
          easing: keyframe.easing,
          ...(keyframe.handleIn ? { handleIn: { ...keyframe.handleIn } } : {}),
          ...(keyframe.handleOut ? { handleOut: { ...keyframe.handleOut } } : {}),
          keyframe,
        };
      });
      remainingKeyframes -= keyframes.length;
      const fallback = getPropertyDefaults(target.path as AnimatableProperty);
      const range = computeCurveValueRange(
        keyframes.map((keyframe) => keyframe.authoringValue),
        {
          fallback: {
            min: fallback.min,
            max: fallback.max,
            fallbackPad: fallback.fallbackPad,
          },
          bounds: descriptorView.range,
        },
      );
      series.push({
        id,
        clipId: clip.id,
        clipName: clip.name,
        property: target.path as AnimatableProperty,
        label: descriptorView.label,
        group: descriptorView.group,
        ...(resolveSeriesUnit(target.path, descriptorView.unit)
          ? { unit: resolveSeriesUnit(target.path, descriptorView.unit) }
          : {}),
        ...(descriptorView.range?.step !== undefined ? { step: descriptorView.range.step } : {}),
        range,
        ...(descriptorView.range ? { editRange: { ...descriptorView.range } } : {}),
        color: CURVE_SERIES_COLORS[series.length % CURVE_SERIES_COLORS.length],
        clipStartTime: clip.startTime,
        clipDuration: clip.duration,
        descriptor: target.descriptor,
        ...(context ? { authoringContext: context } : {}),
        keyframes,
      });
    } catch {
      omittedSeries.push({ id, reason: 'authoring-conversion-failed' });
    }
  }

  const renderedKeyframeIds = new Set(
    series.flatMap((candidate) => candidate.keyframes.map((keyframe) => keyframe.id)),
  );
  const selectedKeyframeIds = new Set(
    [...selectedInput].filter((keyframeId) => renderedKeyframeIds.has(keyframeId)),
  );
  const activeSeriesId = resolveActiveSeriesId(
    series,
    input.activeSeriesId,
    selectedKeyframeIds,
  );
  const renderedKeyframes = series.reduce((total, candidate) => total + candidate.keyframes.length, 0);

  return {
    series,
    activeSeriesId,
    selectedKeyframeIds,
    omittedSeries,
    totalCandidateSeries,
    totalKeyframes,
    renderedKeyframes,
    seriesLimit,
    keyframeLimit,
    truncatedSeries: totalCandidateSeries > seriesLimit,
    truncatedKeyframes: totalKeyframes > renderedKeyframes,
  };
}

function getSeriesKeyframes(
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>,
  target: CurveGraphPropertyTarget,
): Keyframe[] {
  const seenIds = new Set<string>();
  return (clipKeyframes.get(target.clipId) ?? [])
    .filter((keyframe) => {
      if (keyframe.clipId !== target.clipId
        || keyframe.property !== target.path
        || !Number.isFinite(keyframe.time)
        || !Number.isFinite(keyframe.value)
        || seenIds.has(keyframe.id)) {
        return false;
      }
      seenIds.add(keyframe.id);
      return true;
    })
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

function countSeriesKeyframes(
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>,
  target: CurveGraphPropertyTarget,
): number {
  return getSeriesKeyframes(clipKeyframes, target).length;
}

function resolveSeriesUnit(path: string, descriptorUnit?: string): string | undefined {
  if (descriptorUnit) return descriptorUnit;
  if (path === 'opacity'
    || path.includes('.opacity')
    || path.includes('.volume')
    || path.startsWith('scale.')) {
    return '%';
  }
  return undefined;
}

function resolveActiveSeriesId(
  series: readonly CurveGraphSeries[],
  requested: string | null | undefined,
  selectedKeyframeIds: ReadonlySet<string>,
): string | null {
  if (requested && series.some((candidate) => candidate.id === requested)) return requested;
  return series.find((candidate) => (
    candidate.keyframes.some((keyframe) => selectedKeyframeIds.has(keyframe.id))
  ))?.id ?? series[0]?.id ?? null;
}

function normalizeLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return maximum;
  return Math.max(0, Math.min(maximum, Math.floor(requested)));
}
