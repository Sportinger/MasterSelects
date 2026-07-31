import type { TimelineClip } from '../../types/timeline';
import type {
  PropertyAuthoringContext,
  PropertyAuthoringDescriptorView,
  PropertyDescriptor,
  PropertyValue,
} from '../../types/propertyRegistry';
import type { PropertyRegistry } from './PropertyRegistry';

export interface PropertyAuthoringCompositionLike {
  id: string;
  width: number;
  height: number;
  timelineData?: {
    clips?: ReadonlyArray<{ id: string }>;
  };
}

export interface PropertyAuthoringContextResolutionInput {
  clipId: string;
  compositions: readonly PropertyAuthoringCompositionLike[];
  activeCompositionId?: string | null;
  /** IDs in the live top-level timeline; this state supersedes saved active data. */
  liveClipIds?: Iterable<string>;
  positionUnitMode: PropertyAuthoringContext['positionUnitMode'];
}

export type PropertyAuthoringContextResolution =
  | {
      ok: true;
      source: 'active-live' | 'persisted-owner';
      context: PropertyAuthoringContext;
    }
  | {
      ok: false;
      reason: 'owner-not-found' | 'owner-ambiguous' | 'invalid-composition-size';
      compositionIds: string[];
    };

export interface DescribePropertyAuthoringOptions {
  clip?: TimelineClip;
  context?: PropertyAuthoringContext;
}

function isPositiveExtent(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function contextFromComposition(
  composition: PropertyAuthoringCompositionLike,
  positionUnitMode: PropertyAuthoringContext['positionUnitMode'],
): PropertyAuthoringContext | null {
  if (!isPositiveExtent(composition.width) || !isPositiveExtent(composition.height)) {
    return null;
  }
  return {
    compositionId: composition.id,
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    positionUnitMode,
  };
}

function compositionContainsClip(
  composition: PropertyAuthoringCompositionLike,
  clipId: string,
): boolean {
  return composition.timelineData?.clips?.some((clip) => clip.id === clipId) === true;
}

/**
 * Resolve the composition that owns a property coordinate system.
 *
 * The active live timeline is authoritative because its persisted
 * `timelineData` can lag behind unsaved edits. If the requested clip is not in
 * the live timeline, inactive persisted compositions are searched before the
 * active persisted snapshot. `TimelineClip.compositionId` is intentionally not
 * used: it identifies a nested source composition, not the clip's owner.
 */
export function resolveClipPropertyAuthoringContext(
  input: PropertyAuthoringContextResolutionInput,
): PropertyAuthoringContextResolution {
  const activeComposition = input.compositions.find(
    (composition) => composition.id === input.activeCompositionId,
  );
  const liveClipIds = input.liveClipIds
    ? new Set(input.liveClipIds)
    : null;

  if (liveClipIds?.has(input.clipId)) {
    if (!activeComposition) {
      return { ok: false, reason: 'owner-not-found', compositionIds: [] };
    }
    const context = contextFromComposition(activeComposition, input.positionUnitMode);
    return context
      ? { ok: true, source: 'active-live', context }
      : {
          ok: false,
          reason: 'invalid-composition-size',
          compositionIds: [activeComposition.id],
        };
  }

  const inactiveOwners = input.compositions.filter((composition) => (
    composition.id !== input.activeCompositionId
    && compositionContainsClip(composition, input.clipId)
  ));
  if (inactiveOwners.length === 0) {
    return { ok: false, reason: 'owner-not-found', compositionIds: [] };
  }
  if (inactiveOwners.length > 1) {
    return {
      ok: false,
      reason: 'owner-ambiguous',
      compositionIds: inactiveOwners.map((composition) => composition.id),
    };
  }
  const context = contextFromComposition(inactiveOwners[0], input.positionUnitMode);
  return context
    ? { ok: true, source: 'persisted-owner', context }
    : {
        ok: false,
        reason: 'invalid-composition-size',
        compositionIds: [inactiveOwners[0].id],
      };
}

/** Mirrors TransformTab's `usesScenePositionUnits`/camera decision. */
export function resolveTransformPositionUnitMode(
  clip: Pick<TimelineClip, 'is3D' | 'source'>,
): PropertyAuthoringContext['positionUnitMode'] {
  const sourceType = clip.source?.type;
  const locked3D = sourceType === 'model'
    || sourceType === 'gaussian-splat'
    || sourceType === 'splat-effector'
    || sourceType === 'light';
  return clip.is3D || sourceType === 'camera' || locked3D
    ? 'scene-units'
    : 'composition-pixels';
}

function halfExtent(
  descriptor: PropertyDescriptor,
  context: PropertyAuthoringContext | undefined,
): number {
  if (!context
    || !isPositiveExtent(context.compositionWidth)
    || !isPositiveExtent(context.compositionHeight)) {
    throw new Error(`${descriptor.path} requires an explicit composition context`);
  }
  return descriptor.authoring?.axis === 'y'
    ? context.compositionHeight / 2
    : context.compositionWidth / 2;
}

function effectiveCodec(
  descriptor: PropertyDescriptor,
  context: PropertyAuthoringContext | undefined,
): 'identity' | 'composition-half-extent' {
  const codec = descriptor.authoring?.codec ?? 'identity';
  if (codec === 'transform-position') {
    if (!context) {
      throw new Error(`${descriptor.path} requires an explicit position-unit context`);
    }
    return context.positionUnitMode === 'composition-pixels'
      ? 'composition-half-extent'
      : 'identity';
  }
  return codec;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isVector2(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number'
    && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.y);
}

/** Validate a value expressed in the descriptor's external authoring units. */
export function validatePropertyAuthoringValue(
  descriptor: PropertyDescriptor,
  value: PropertyValue,
): PropertyValue {
  if (descriptor.valueType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${descriptor.path} must be a finite number`);
    }
    if (descriptor.ui?.min !== undefined && value < descriptor.ui.min) {
      throw new Error(`${descriptor.path} must be at least ${descriptor.ui.min}`);
    }
    if (descriptor.ui?.max !== undefined && value > descriptor.ui.max) {
      throw new Error(`${descriptor.path} must be at most ${descriptor.ui.max}`);
    }
    return value;
  }

  if (descriptor.valueType === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`${descriptor.path} must be a boolean`);
    }
    return value;
  }

  if (descriptor.valueType === 'enum') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`${descriptor.path} must be an enum value`);
    }
    const enumValues = descriptor.ui?.options?.map((option) => option.value);
    if (enumValues?.length && !enumValues.includes(value as string | number | boolean)) {
      throw new Error(`${descriptor.path} must be one of: ${enumValues.join(', ')}`);
    }
    return value;
  }

  if (descriptor.valueType === 'vector2' && !isVector2(value)) {
    throw new Error(`${descriptor.path} must be a finite { x, y } vector`);
  }

  return value;
}

/** Convert an external authoring value to the unchanged timeline storage unit. */
export function propertyValueToStorage(
  descriptor: PropertyDescriptor,
  value: PropertyValue,
  context?: PropertyAuthoringContext,
): PropertyValue {
  const validated = validatePropertyAuthoringValue(descriptor, value);
  if (effectiveCodec(descriptor, context) !== 'composition-half-extent') {
    return cloneValue(validated);
  }
  if (typeof validated !== 'number') {
    throw new Error(`${descriptor.path} half-extent codec requires a number`);
  }
  return validated / halfExtent(descriptor, context);
}

/** Convert a timeline storage value to the descriptor's external authoring unit. */
export function propertyValueFromStorage(
  descriptor: PropertyDescriptor,
  value: PropertyValue,
  context?: PropertyAuthoringContext,
): PropertyValue {
  if (effectiveCodec(descriptor, context) !== 'composition-half-extent') {
    return validatePropertyAuthoringValue(descriptor, cloneValue(value));
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${descriptor.path} stored value must be a finite number`);
  }
  return value * halfExtent(descriptor, context);
}

export function describePropertyAuthoringDescriptor(
  descriptor: PropertyDescriptor,
  options: DescribePropertyAuthoringOptions = {},
): PropertyAuthoringDescriptorView {
  const codec = effectiveCodec(descriptor, options.context);
  const isTransformPosition = descriptor.authoring?.codec === 'transform-position';
  const isPixelPosition = isTransformPosition && codec === 'composition-half-extent';
  const defaultValue = propertyValueFromStorage(
    descriptor,
    descriptor.defaultValue,
    options.context,
  );
  const storedValue = options.clip
    ? descriptor.read?.(options.clip, descriptor.path)
    : undefined;
  const range = descriptor.ui && (
    descriptor.ui.min !== undefined
    || descriptor.ui.max !== undefined
    || descriptor.ui.step !== undefined
  )
    ? {
        ...(descriptor.ui.min !== undefined ? { min: descriptor.ui.min } : {}),
        ...(descriptor.ui.max !== undefined ? { max: descriptor.ui.max } : {}),
        ...(descriptor.ui.step !== undefined ? { step: descriptor.ui.step } : {}),
      }
    : undefined;

  return {
    path: descriptor.path,
    label: descriptor.label,
    group: descriptor.group,
    valueType: descriptor.valueType,
    animatable: descriptor.animatable,
    writable: descriptor.write !== undefined,
    defaultValue: cloneValue(defaultValue),
    ...(storedValue !== undefined
      ? { value: propertyValueFromStorage(descriptor, storedValue, options.context) }
      : {}),
    ...(range ? { range } : {}),
    ...(isTransformPosition || descriptor.authoring?.unit || descriptor.ui?.unit
      ? {
          unit: isTransformPosition
            ? isPixelPosition ? 'px' : 'scene-unit'
            : descriptor.authoring?.unit ?? descriptor.ui?.unit,
        }
      : {}),
    ...(isTransformPosition || descriptor.authoring?.storageUnit
      ? {
          storageUnit: isTransformPosition
            ? isPixelPosition ? 'normalized' : 'scene-unit'
            : descriptor.authoring?.storageUnit,
        }
      : {}),
    ...(isPixelPosition || descriptor.authoring?.coordinateSpace
      ? {
          coordinateSpace: isPixelPosition
            ? 'composition-center'
            : descriptor.authoring?.coordinateSpace,
        }
      : {}),
    ...(descriptor.authoring?.axis ? { axis: descriptor.authoring.axis } : {}),
    codec,
    aliases: [...(descriptor.ui?.aliases ?? [])],
    ...(descriptor.ui?.options
      ? { enumValues: descriptor.ui.options.map((option) => ({ ...option })) }
      : {}),
    ...(descriptor.ui ? { ui: cloneValue(descriptor.ui) } : {}),
  };
}

export function resolvePropertyAuthoringDescriptor(
  registry: PropertyRegistry,
  path: string,
  clip?: TimelineClip,
): PropertyDescriptor {
  const descriptor = registry.getDescriptor(path, clip);
  if (!descriptor) {
    throw new Error(`Unknown property: ${path}`);
  }
  return descriptor;
}

export function resolvePropertyAuthoringDescriptorView(
  registry: PropertyRegistry,
  path: string,
  options: DescribePropertyAuthoringOptions = {},
): PropertyAuthoringDescriptorView {
  return describePropertyAuthoringDescriptor(
    resolvePropertyAuthoringDescriptor(registry, path, options.clip),
    options,
  );
}

export function readPropertyAuthoringValue(
  registry: PropertyRegistry,
  clip: TimelineClip,
  path: string,
  context?: PropertyAuthoringContext,
): PropertyValue | undefined {
  const descriptor = resolvePropertyAuthoringDescriptor(registry, path, clip);
  const storedValue = descriptor.read?.(clip, path);
  return storedValue === undefined
    ? undefined
    : propertyValueFromStorage(descriptor, storedValue, context);
}

export function writePropertyAuthoringValue(
  registry: PropertyRegistry,
  clip: TimelineClip,
  path: string,
  value: PropertyValue,
  context?: PropertyAuthoringContext,
): TimelineClip {
  const descriptor = resolvePropertyAuthoringDescriptor(registry, path, clip);
  if (!descriptor.write) {
    throw new Error(`Property is not writable: ${path}`);
  }
  const storedValue = propertyValueToStorage(descriptor, value, context);
  return descriptor.write(clip, storedValue, path);
}
