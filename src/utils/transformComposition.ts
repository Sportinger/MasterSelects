// Transform composition utility for parent-child clip relationships
// Composes parent and child transforms like After Effects parenting

import type { ClipTransform, TimelineClip } from '../types';
import { Logger } from '../services/logger';
import { resolveTransformPositionUnitMode } from '../services/properties/propertyAuthoring';
import {
  createCompositionParentPositionFrame,
  isValidCompositionPixelSize,
  rotateParentPositionOffset,
  SCENE_PARENT_POSITION_FRAME,
  type CompositionPixelSize,
  type ParentPositionFrame,
} from './parentPositionFrame';

const log = Logger.create('TransformComposition');
const MAX_MISSING_SIZE_WARNINGS = 32;
const missingSizeWarnings = new Set<string>();

/**
 * Picks the frame of a parented child's position offset: scene units for
 * effective-3D clips, the owning composition's pixel aspect for 2D clips. A 2D
 * child without a known composition size falls back to a square frame and says
 * so once per clip, because its rotated offset cannot be aspect-corrected.
 */
export function resolveClipParentPositionFrame(
  clip: Pick<TimelineClip, 'id' | 'is3D' | 'source'>,
  compositionSize: CompositionPixelSize | null | undefined,
): ParentPositionFrame {
  if (resolveTransformPositionUnitMode(clip) === 'scene-units') {
    return SCENE_PARENT_POSITION_FRAME;
  }
  if (
    !isValidCompositionPixelSize(compositionSize)
    && !missingSizeWarnings.has(clip.id)
    && missingSizeWarnings.size < MAX_MISSING_SIZE_WARNINGS
  ) {
    missingSizeWarnings.add(clip.id);
    log.warn('Parented 2D clip has no composition size; parent rotation uses a square frame', {
      clipId: clip.id,
    });
  }
  return createCompositionParentPositionFrame(compositionSize);
}

/**
 * Composes parent and child transforms.
 *
 * In our rendering pipeline:
 * - Shader applies scale to UV BEFORE position
 * - Position is an absolute offset applied AFTER scale
 * - So child position should NOT be multiplied by parent scale
 *
 * - Position: Parent position + rotated child position, including the parent's
 *   uniform Scale All value so children follow the same group-scale motion.
 *   The offset is rotated in `frame` (visible space, renderer direction), so
 *   a rotated parent turns its children rigidly on any composition aspect.
 * - Scale: Child scale is multiplied by parent scale
 * - Rotation: Child rotation is added to parent rotation
 * - Opacity: Child opacity stays local and is never inherited
 */
export function composeTransforms(
  parent: ClipTransform,
  child: ClipTransform,
  frame: ParentPositionFrame,
): ClipTransform {
  // Uniform Scale All represents hierarchy/group scale. Apply it to the child
  // offset before rotation so the child follows the same motion around the
  // parent anchor. Independent X/Y scale remains local UV deformation; using
  // it here would make parenting depend on media/source aspect corrections.
  const parentUniformScale = parent.scale.all ?? 1;
  const rotated = rotateParentPositionOffset(
    {
      x: child.position.x * parentUniformScale,
      y: child.position.y * parentUniformScale,
    },
    parent.rotation.z,
    frame,
  );

  return {
    // Opacity is intentionally clip-local. Pick-whip parenting controls only
    // spatial motion; fading a parent must not hide or fade its children.
    opacity: child.opacity,

    // Child's blend mode takes precedence
    blendMode: child.blendMode,

    // Position: Parent position + rotated child position
    // Scale All affects hierarchy offsets; source-specific X/Y scale does not.
    position: {
      x: parent.position.x + rotated.x,
      y: parent.position.y + rotated.y,
      z: parent.position.z + child.position.z,
    },

    // The pivot remains in the child's local geometry space.
    anchor: child.anchor ? { ...child.anchor } : { x: 0, y: 0, z: 0 },

    // Scale: Multiply parent and child scales
    scale: {
      all: (parent.scale.all ?? 1) * (child.scale.all ?? 1),
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
      ...(parent.scale.z !== undefined || child.scale.z !== undefined
        ? { z: (parent.scale.z ?? 1) * (child.scale.z ?? 1) }
        : {}),
    },

    // Rotation: Add parent and child rotations
    rotation: {
      x: parent.rotation.x + child.rotation.x,
      y: parent.rotation.y + child.rotation.y,
      z: parent.rotation.z + child.rotation.z,
    },
  };
}

/**
 * Checks if setting parentId as parent of clipId would create a cycle.
 * Returns true if it would create a cycle (invalid), false if safe.
 */
export function wouldCreateCycle(
  clipId: string,
  parentId: string,
  getParentId: (id: string) => string | undefined
): boolean {
  let currentId: string | undefined = parentId;

  // Walk up the parent chain
  while (currentId) {
    if (currentId === clipId) {
      // Found the clip in the parent chain - would create cycle
      return true;
    }
    currentId = getParentId(currentId);
  }

  return false;
}
