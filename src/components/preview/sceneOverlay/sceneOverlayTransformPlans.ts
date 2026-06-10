import type { AnimatableProperty } from "../../../types/animationProperties";
import type { ClipTransform } from "../../../types/timelineCore";
import type { PreviewSceneObject, SceneGizmoAxis, SceneGizmoMode } from '../sceneObjectOverlayMath';
import type { ClipTransformPatch } from './sceneOverlayTypes';

export function cloneTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

export function resolveTransformPropertyUpdates(transform: ClipTransformPatch): Array<[AnimatableProperty, number]> {
  const updates: Array<[AnimatableProperty, number]> = [];
  if (transform.opacity !== undefined) updates.push(['opacity', transform.opacity]);
  if (transform.position) {
    if (transform.position.x !== undefined) updates.push(['position.x', transform.position.x]);
    if (transform.position.y !== undefined) updates.push(['position.y', transform.position.y]);
    if (transform.position.z !== undefined) updates.push(['position.z', transform.position.z]);
  }
  if (transform.scale) {
    if (transform.scale.all !== undefined) updates.push(['scale.all', transform.scale.all]);
    if (transform.scale.x !== undefined) updates.push(['scale.x', transform.scale.x]);
    if (transform.scale.y !== undefined) updates.push(['scale.y', transform.scale.y]);
    if (transform.scale.z !== undefined) updates.push(['scale.z', transform.scale.z]);
  }
  if (transform.rotation) {
    if (transform.rotation.x !== undefined) updates.push(['rotation.x', transform.rotation.x]);
    if (transform.rotation.y !== undefined) updates.push(['rotation.y', transform.rotation.y]);
    if (transform.rotation.z !== undefined) updates.push(['rotation.z', transform.rotation.z]);
  }
  return updates;
}

export function getDragSpeedMultiplier(event: MouseEvent): number {
  if (event.ctrlKey) return 5;
  if (event.altKey || event.shiftKey) return 0.1;
  return 1;
}

export function buildScaleUpdate(
  startScale: ClipTransform['scale'],
  values: { x: number; y: number; z?: number },
): Partial<ClipTransform['scale']> {
  const scale: Partial<ClipTransform['scale']> = {
    x: Math.max(0.001, values.x),
    y: Math.max(0.001, values.y),
  };

  if (values.z !== undefined || startScale.z !== undefined) {
    scale.z = Math.max(0.001, values.z ?? startScale.z ?? 1);
  }

  return scale;
}

export function buildAxisResetTransform(
  mode: SceneGizmoMode,
  axis: SceneGizmoAxis,
  object: PreviewSceneObject,
  start: ClipTransform,
): ClipTransformPatch {
  if (mode === 'rotate') {
    return {
      rotation: {
        ...start.rotation,
        [axis]: 0,
      },
    };
  }

  if (mode === 'scale') {
    if (object.kind === 'camera') {
      return {
        scale: axis === 'z' ? { z: 0 } : { all: 1 },
      };
    }

    return {
      scale: buildScaleUpdate(start.scale, {
        x: axis === 'x' ? 1 : start.scale.x,
        y: axis === 'y' ? 1 : start.scale.y,
        ...(axis === 'z'
          ? { z: 1 }
          : start.scale.z !== undefined
            ? { z: start.scale.z }
            : {}),
      }),
    };
  }

  return {
    position: {
      ...start.position,
      [axis]: 0,
    },
  };
}

export function buildCenterResetTransform(
  mode: SceneGizmoMode,
  object: PreviewSceneObject,
  start: ClipTransform,
): ClipTransformPatch {
  if (mode === 'rotate') {
    return {
      rotation: { x: 0, y: 0, z: 0 },
    };
  }

  if (mode === 'scale') {
    if (object.kind === 'camera') {
      return {
        scale: { all: 1, x: 1, y: 1, z: 0 },
      };
    }

    return {
      scale: {
        all: 1,
        ...buildScaleUpdate(start.scale, {
          x: 1,
          y: 1,
          ...(object.kind !== 'plane' || start.scale.z !== undefined ? { z: 1 } : {}),
        }),
      },
    };
  }

  return {
    position: { x: 0, y: 0, z: 0 },
  };
}
