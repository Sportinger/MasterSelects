import {
  MOTION_PARENT_ERROR_CODES,
  type MotionParentFailure,
  type MotionParentTransform2D,
} from './contracts';
import { inspectMotionParentStableIdArray } from './stableId';

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

/** Exact 2D equivalent of the established composition algebra. */
export function composeMotionParentTransforms2D(
  parent: MotionParentTransform2D,
  child: MotionParentTransform2D,
): MotionParentTransform2D {
  const radians = (parent.rotationZ * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatedX = child.position.x * cosine - child.position.y * sine;
  const rotatedY = child.position.x * sine + child.position.y * cosine;

  return {
    position: {
      x: parent.position.x + rotatedX,
      y: parent.position.y + rotatedY,
    },
    scale: {
      all: parent.scale.all * child.scale.all,
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
    },
    rotationZ: parent.rotationZ + child.rotationZ,
    opacity: parent.opacity * child.opacity,
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
    Math.abs(parentWorld.scale.y) <= INVERSE_EPSILON ||
    Math.abs(parentWorld.opacity) <= INVERSE_EPSILON;
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

  const deltaX = childWorld.position.x - parentWorld.position.x;
  const deltaY = childWorld.position.y - parentWorld.position.y;
  const inverseRadians = (-parentWorld.rotationZ * Math.PI) / 180;
  const cosine = Math.cos(inverseRadians);
  const sine = Math.sin(inverseRadians);

  const transform: MotionParentTransform2D = {
    position: {
      x: deltaX * cosine - deltaY * sine,
      y: deltaX * sine + deltaY * cosine,
    },
    scale: {
      all: childWorld.scale.all / parentWorld.scale.all,
      x: childWorld.scale.x / parentWorld.scale.x,
      y: childWorld.scale.y / parentWorld.scale.y,
    },
    rotationZ: childWorld.rotationZ - parentWorld.rotationZ,
    opacity: childWorld.opacity / parentWorld.opacity,
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
