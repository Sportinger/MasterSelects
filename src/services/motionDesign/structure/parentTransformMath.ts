import {
  MOTION_PARENT_ERROR_CODES,
  type MotionParentCompositionSize,
  type MotionParentFailure,
  type MotionParentTransform2D,
} from './contracts';
import { inspectMotionParentStableIdArray } from './stableId';
import {
  createCompositionParentPositionFrame,
  rotateParentPositionOffset,
} from '../../../utils/parentPositionFrame';

const INVERSE_EPSILON = 1e-12;

export const IDENTITY_MOTION_PARENT_TRANSFORM_2D: MotionParentTransform2D = {
  position: { x: 0, y: 0 },
  scale: { all: 1, x: 1, y: 1 },
  rotationZ: 0,
  opacity: 1,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isFiniteMotionParentTransform2D(
  transform: MotionParentTransform2D,
): boolean {
  if (!transform || typeof transform !== 'object') return false;
  const candidate = transform as Partial<MotionParentTransform2D>;
  if (!candidate.position || typeof candidate.position !== 'object') return false;
  if (!candidate.scale || typeof candidate.scale !== 'object') return false;
  return (
    isFiniteNumber(candidate.position.x) &&
    isFiniteNumber(candidate.position.y) &&
    isFiniteNumber(candidate.scale.all) &&
    isFiniteNumber(candidate.scale.x) &&
    isFiniteNumber(candidate.scale.y) &&
    isFiniteNumber(candidate.rotationZ) &&
    isFiniteNumber(candidate.opacity)
  );
}

/** An exact inert `{ width, height }` record of positive finite numbers. */
export function isExactMotionParentCompositionSize(
  value: unknown,
): value is MotionParentCompositionSize {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  return Reflect.ownKeys(descriptors).length === 2 && ['width', 'height'].every((key) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true
      && 'value' in descriptor
      && isFiniteNumber(descriptor.value)
      && descriptor.value > 0;
  });
}

export function cloneMotionParentTransform2D(
  transform: MotionParentTransform2D,
): MotionParentTransform2D {
  return {
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotationZ: transform.rotationZ,
    opacity: transform.opacity,
  };
}

/**
 * Exact 2D equivalent of the established composition algebra. Positions are
 * normalized half extents of `compositionSize`; omitted means square.
 */
export function composeMotionParentTransforms2D(
  parent: MotionParentTransform2D,
  child: MotionParentTransform2D,
  compositionSize?: MotionParentCompositionSize,
): MotionParentTransform2D {
  const rotated = rotateParentPositionOffset(
    {
      x: child.position.x * parent.scale.all,
      y: child.position.y * parent.scale.all,
    },
    parent.rotationZ,
    createCompositionParentPositionFrame(compositionSize),
  );

  return {
    position: {
      x: parent.position.x + rotated.x,
      y: parent.position.y + rotated.y,
    },
    scale: {
      all: parent.scale.all * child.scale.all,
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
    },
    rotationZ: parent.rotationZ + child.rotationZ,
    // Opacity is not part of pick-whip inheritance.
    opacity: child.opacity,
  };
}

export type MotionParentInverseResult =
  | { readonly ok: true; readonly transform: MotionParentTransform2D }
  | { readonly ok: false; readonly failure: MotionParentFailure };

/**
 * Derives the child-local value which composes with `parentWorld` to produce
 * `childWorld`. It rejects singular parent values rather than guessing.
 */
export function deriveMotionParentLocalTransform2D(
  parentWorld: MotionParentTransform2D,
  childWorld: MotionParentTransform2D,
  clipIds: readonly string[] = [],
  compositionSize?: MotionParentCompositionSize,
): MotionParentInverseResult {
  const clipIdInspection = inspectMotionParentStableIdArray(clipIds);
  if (!clipIdInspection.ok) {
    return {
      ok: false,
      failure: {
        code: MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        message: 'Transform diagnostics require a bounded native array of stable clip ids.',
        clipIds: [],
      },
    };
  }
  const stableClipIds = [...clipIdInspection.values].sort();
  if (!isFiniteMotionParentTransform2D(parentWorld) || !isFiniteMotionParentTransform2D(childWorld)) {
    return {
      ok: false,
      failure: {
        code: MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM,
        message: 'Parent and child transforms must contain only finite values.',
        clipIds: stableClipIds,
      },
    };
  }

  const singular =
    Math.abs(parentWorld.scale.all) <= INVERSE_EPSILON ||
    Math.abs(parentWorld.scale.x) <= INVERSE_EPSILON ||
    Math.abs(parentWorld.scale.y) <= INVERSE_EPSILON;
  if (singular) {
    return {
      ok: false,
      failure: {
        code: MOTION_PARENT_ERROR_CODES.NON_INVERTIBLE_TRANSFORM,
        message: 'The parent transform is singular at the requested timeline time.',
        clipIds: stableClipIds,
      },
    };
  }

  const unrotated = rotateParentPositionOffset(
    {
      x: childWorld.position.x - parentWorld.position.x,
      y: childWorld.position.y - parentWorld.position.y,
    },
    -parentWorld.rotationZ,
    createCompositionParentPositionFrame(compositionSize),
  );

  const transform: MotionParentTransform2D = {
    position: {
      x: unrotated.x / parentWorld.scale.all,
      y: unrotated.y / parentWorld.scale.all,
    },
    scale: {
      all: childWorld.scale.all / parentWorld.scale.all,
      x: childWorld.scale.x / parentWorld.scale.x,
      y: childWorld.scale.y / parentWorld.scale.y,
    },
    rotationZ: childWorld.rotationZ - parentWorld.rotationZ,
    opacity: childWorld.opacity,
  };
  if (!isFiniteMotionParentTransform2D(transform)) {
    return {
      ok: false,
      failure: {
        code: MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM,
        message: 'The derived child-local transform overflowed to a non-finite value.',
        clipIds: stableClipIds,
      },
    };
  }

  return { ok: true, transform };
}
