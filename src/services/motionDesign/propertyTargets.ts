import type { TimelineClip } from '../../types/timeline';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import type { PropertyRegistry } from '../properties/PropertyRegistry';

/** Matches the existing bounded Motion property update contract. */
export const MOTION_PROPERTY_TARGET_LIMIT = 50;

export type MotionPropertyTargetSource =
  | 'selected'
  | 'pinned'
  | 'favorited'
  | 'animated';

export interface MotionPropertyTargetRef {
  clipId: string;
  path: string;
}

export interface MotionPropertyAnimationRef {
  property: string;
}

export interface BuildMotionPropertyTargetModelInput {
  registry: Pick<PropertyRegistry, 'getAllDescriptors' | 'getDescriptor'>;
  /** Clips in the caller's deterministic display/selection order. */
  clips: readonly TimelineClip[];
  /** Explicit property selections, ordered from primary to secondary. */
  selectedTargets?: readonly MotionPropertyTargetRef[];
  /** Exact per-user favorite paths, applied to every supplied clip. */
  favoritePaths?: readonly string[];
  /** The timeline's existing per-clip keyframe lists. */
  animatedByClip?: ReadonlyMap<string, readonly MotionPropertyAnimationRef[]>;
  /** Callers may lower the bound, but cannot exceed the shared Motion limit. */
  maxTargets?: number;
}

export interface MotionPropertyTarget {
  id: string;
  clipId: string;
  path: string;
  descriptor: PropertyDescriptor;
  /** Highest-priority source that contributed this exact clip/path target. */
  priority: MotionPropertyTargetSource;
  /** All contributing sources, always in deterministic priority order. */
  sources: MotionPropertyTargetSource[];
}

export interface MotionPropertyTargetModel {
  targets: MotionPropertyTarget[];
  totalResolved: number;
  truncated: boolean;
  limit: number;
}

const SOURCE_PRIORITY: readonly MotionPropertyTargetSource[] = [
  'selected',
  'pinned',
  'favorited',
  'animated',
];

interface TargetCandidate extends MotionPropertyTargetRef {
  source: MotionPropertyTargetSource;
}

/**
 * Build the shared Motion property target list without mutating clip content,
 * user preferences, or keyframes. Registry enumeration is the clip-valid
 * boundary: stale dynamic paths remain in their stored source arrays but are
 * omitted until they resolve for the current clip again.
 */
export function buildMotionPropertyTargetModel(
  input: BuildMotionPropertyTargetModelInput,
): MotionPropertyTargetModel {
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const descriptorIndexes = new Map<string, Map<string, PropertyDescriptor>>();
  const targetsByKey = new Map<string, MotionPropertyTarget>();

  const addCandidate = (candidate: TargetCandidate): void => {
    const clip = clipsById.get(candidate.clipId);
    if (!clip || !isExactPath(candidate.path)) return;

    const key = targetDedupeKey(candidate.clipId, candidate.path);
    const existing = targetsByKey.get(key);
    if (existing) {
      if (!existing.sources.includes(candidate.source)) {
        existing.sources.push(candidate.source);
      }
      return;
    }

    const descriptor = resolveClipValidDescriptor(
      input.registry,
      clip,
      candidate.path,
      descriptorIndexes,
    );
    if (!descriptor?.animatable) return;

    targetsByKey.set(key, {
      id: `${candidate.clipId}::${candidate.path}`,
      clipId: candidate.clipId,
      path: candidate.path,
      descriptor,
      priority: candidate.source,
      sources: [candidate.source],
    });
  };

  for (const candidate of input.selectedTargets ?? []) {
    addCandidate({ ...candidate, source: 'selected' });
  }

  for (const clip of input.clips) {
    for (const path of clip.motion?.ui?.pinnedProperties ?? []) {
      addCandidate({ clipId: clip.id, path, source: 'pinned' });
    }
  }

  for (const path of input.favoritePaths ?? []) {
    for (const clip of input.clips) {
      addCandidate({ clipId: clip.id, path, source: 'favorited' });
    }
  }

  for (const clip of input.clips) {
    const animatedPaths = new Set(
      (input.animatedByClip?.get(clip.id) ?? []).map((keyframe) => keyframe.property),
    );
    for (const path of [...animatedPaths].sort(compareExactPaths)) {
      addCandidate({ clipId: clip.id, path, source: 'animated' });
    }
  }

  const resolved = [...targetsByKey.values()].map((target) => ({
    ...target,
    sources: SOURCE_PRIORITY.filter((source) => target.sources.includes(source)),
  }));
  const limit = normalizeTargetLimit(input.maxTargets);

  return {
    targets: resolved.slice(0, limit),
    totalResolved: resolved.length,
    truncated: resolved.length > limit,
    limit,
  };
}

function resolveClipValidDescriptor(
  registry: Pick<PropertyRegistry, 'getAllDescriptors' | 'getDescriptor'>,
  clip: TimelineClip,
  path: string,
  indexes: Map<string, Map<string, PropertyDescriptor>>,
): PropertyDescriptor | undefined {
  let index = indexes.get(clip.id);
  if (!index) {
    index = new Map(
      registry.getAllDescriptors(clip).map((descriptor) => [descriptor.path, descriptor]),
    );
    indexes.set(clip.id, index);
  }
  if (!index.has(path)) return undefined;

  const descriptor = registry.getDescriptor(path, clip);
  return descriptor?.path === path ? descriptor : undefined;
}

function isExactPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.trim() === path;
}

function targetDedupeKey(clipId: string, path: string): string {
  return `${clipId}\u0000${path}`;
}

function compareExactPaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeTargetLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return MOTION_PROPERTY_TARGET_LIMIT;
  }
  return Math.max(0, Math.min(MOTION_PROPERTY_TARGET_LIMIT, Math.floor(requested)));
}
