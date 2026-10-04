import type { ClipTransform } from '../../types/timelineCore';
import type { ParameterSourceTarget } from './parameterSourceTargets';

interface TransformTargetSpec {
  label: string;
  read: (transform: Partial<ClipTransform> | undefined) => number | undefined;
  defaultValue: number;
  min: number; max: number; step: number; unit: string;
  hardMin?: number; hardMax?: number;
}

/**
 * Transform properties with a runtime adapter (`applyParameterSourcesToTransform`). Paths equal the
 * keyframe property names, so a Keyframes source can read the same curve. Positions use stored
 * composition units (half the composition width/height per 1.0), rotations degrees.
 */
const TRANSFORM_TARGETS: Readonly<Record<string, TransformTargetSpec>> = {
  'position.x': { label: 'Position X', read: t => t?.position?.x, defaultValue: 0, min: -2, max: 2, step: 0.001, unit: 'number' },
  'position.y': { label: 'Position Y', read: t => t?.position?.y, defaultValue: 0, min: -2, max: 2, step: 0.001, unit: 'number' },
  'position.z': { label: 'Position Z', read: t => t?.position?.z, defaultValue: 0, min: -2, max: 2, step: 0.001, unit: 'number' },
  'anchor.x': { label: 'Anchor X', read: t => t?.anchor?.x, defaultValue: 0, min: -1, max: 1, step: 0.001, unit: 'number' },
  'anchor.y': { label: 'Anchor Y', read: t => t?.anchor?.y, defaultValue: 0, min: -1, max: 1, step: 0.001, unit: 'number' },
  'scale.all': { label: 'Scale', read: t => t?.scale?.all, defaultValue: 1, min: 0, max: 4, step: 0.01, unit: 'number' },
  'scale.x': { label: 'Scale X', read: t => t?.scale?.x, defaultValue: 1, min: 0, max: 4, step: 0.01, unit: 'number' },
  'scale.y': { label: 'Scale Y', read: t => t?.scale?.y, defaultValue: 1, min: 0, max: 4, step: 0.01, unit: 'number' },
  'rotation.x': { label: 'Rotation X', read: t => t?.rotation?.x, defaultValue: 0, min: -360, max: 360, step: 0.1, unit: 'degrees' },
  'rotation.y': { label: 'Rotation Y', read: t => t?.rotation?.y, defaultValue: 0, min: -360, max: 360, step: 0.1, unit: 'degrees' },
  'rotation.z': { label: 'Rotation', read: t => t?.rotation?.z, defaultValue: 0, min: -360, max: 360, step: 0.1, unit: 'degrees' },
  'opacity': { label: 'Opacity', read: t => t?.opacity, defaultValue: 1, min: 0, max: 1, step: 0.01, unit: 'number', hardMin: 0, hardMax: 1 },
};

export const TRANSFORM_PARAMETER_PATHS: readonly string[] = Object.keys(TRANSFORM_TARGETS);
export const isTransformParameterPath = (path: string) => Object.hasOwn(TRANSFORM_TARGETS, path);

export function transformParameterTargets(transform: Partial<ClipTransform> | undefined): ParameterSourceTarget[] {
  if (!transform) return [];
  return Object.entries(TRANSFORM_TARGETS).map(([path, spec]) => {
    const stored = spec.read(transform);
    return { path, label: spec.label, group: 'Transform', value: typeof stored === 'number' ? stored : spec.defaultValue,
      defaultValue: spec.defaultValue, min: spec.min, max: spec.max, step: spec.step, unit: spec.unit,
      ...(spec.hardMin !== undefined ? { hardMin: spec.hardMin } : {}), ...(spec.hardMax !== undefined ? { hardMax: spec.hardMax } : {}) };
  });
}

/** Nested patch for `updateClipTransform`, e.g. `position.x` → `{ position: { x } }`. */
export function transformParameterPatch(path: string, value: number): Record<string, unknown> {
  if (!isTransformParameterPath(path)) throw new Error('Unsupported transform parameter.');
  if (path === 'opacity') return { opacity: value };
  const [group, axis] = path.split('.');
  return { [group]: { [axis]: value } };
}

/** Write one resolved value into a transform copy (the caller owns the copy). */
export function writeTransformParameter(transform: ClipTransform, path: string, value: number): void {
  switch (path) {
    case 'position.x': transform.position = { ...transform.position, x: value }; break;
    case 'position.y': transform.position = { ...transform.position, y: value }; break;
    case 'position.z': transform.position = { ...transform.position, z: value }; break;
    case 'anchor.x': transform.anchor = { ...(transform.anchor ?? { x: 0, y: 0, z: 0 }), x: value }; break;
    case 'anchor.y': transform.anchor = { ...(transform.anchor ?? { x: 0, y: 0, z: 0 }), y: value }; break;
    case 'scale.all': transform.scale = { ...transform.scale, all: value }; break;
    case 'scale.x': transform.scale = { ...transform.scale, x: value }; break;
    case 'scale.y': transform.scale = { ...transform.scale, y: value }; break;
    case 'rotation.x': transform.rotation = { ...transform.rotation, x: value }; break;
    case 'rotation.y': transform.rotation = { ...transform.rotation, y: value }; break;
    case 'rotation.z': transform.rotation = { ...transform.rotation, z: value }; break;
    case 'opacity': transform.opacity = value; break;
  }
}
