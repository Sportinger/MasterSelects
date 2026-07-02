
import type { TimelineClip } from '../../types/timeline';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import type { PropertyRegistry } from './PropertyRegistry';

type TransformPatch = Omit<Partial<TimelineClip['transform']>, 'position' | 'scale' | 'rotation'> & {
  position?: Partial<TimelineClip['transform']['position']>;
  scale?: Partial<TimelineClip['transform']['scale']>;
  rotation?: Partial<TimelineClip['transform']['rotation']>;
};

function updateTransform(
  clip: TimelineClip,
  patch: TransformPatch,
): TimelineClip {
  return {
    ...clip,
    transform: {
      ...clip.transform,
      ...patch,
      position: patch.position ? { ...clip.transform.position, ...patch.position } : clip.transform.position,
      scale: patch.scale ? { ...clip.transform.scale, ...patch.scale } : clip.transform.scale,
      rotation: patch.rotation ? { ...clip.transform.rotation, ...patch.rotation } : clip.transform.rotation,
    },
  };
}

function createTransformDescriptor(
  path: string,
  label: string,
  defaultValue: number,
  read: (clip: TimelineClip) => number,
  write: (clip: TimelineClip, value: number) => TimelineClip,
  ui: NonNullable<PropertyDescriptor['ui']> = {},
): PropertyDescriptor<number> {
  return {
    path,
    label,
    group: 'Transform',
    valueType: 'number',
    animatable: true,
    defaultValue,
    ui,
    read,
    write: (clip, value) => write(clip, value as number),
  };
}

export function registerTransformProperties(registry: PropertyRegistry): void {
  registry.registerMany([
    createTransformDescriptor(
      'opacity',
      'Opacity',
      1,
      (clip) => clip.transform.opacity,
      (clip, value) => updateTransform(clip, { opacity: value }),
      { min: 0, max: 1, step: 0.01, aliases: ['alpha', 'transparency'] },
    ),
    createTransformDescriptor(
      'position.x',
      'Position X',
      0,
      (clip) => clip.transform.position.x,
      (clip, value) => updateTransform(clip, { position: { x: value } }),
      { step: 1, aliases: ['x'] },
    ),
    createTransformDescriptor(
      'position.y',
      'Position Y',
      0,
      (clip) => clip.transform.position.y,
      (clip, value) => updateTransform(clip, { position: { y: value } }),
      { step: 1, aliases: ['y'] },
    ),
    createTransformDescriptor(
      'position.z',
      'Position Z',
      0,
      (clip) => clip.transform.position.z,
      (clip, value) => updateTransform(clip, { position: { z: value } }),
      { step: 1, aliases: ['z', 'depth'] },
    ),
    createTransformDescriptor(
      'scale.all',
      'Scale',
      1,
      (clip) => clip.transform.scale.all ?? 1,
      (clip, value) => updateTransform(clip, { scale: { all: value } }),
      { step: 0.01, aliases: ['size'] },
    ),
    createTransformDescriptor(
      'scale.x',
      'Scale X',
      1,
      (clip) => clip.transform.scale.x,
      (clip, value) => updateTransform(clip, { scale: { x: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'scale.y',
      'Scale Y',
      1,
      (clip) => clip.transform.scale.y,
      (clip, value) => updateTransform(clip, { scale: { y: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'scale.z',
      'Scale Z',
      1,
      (clip) => clip.transform.scale.z ?? 1,
      (clip, value) => updateTransform(clip, { scale: { z: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'rotation.x',
      'Rotation X',
      0,
      (clip) => clip.transform.rotation.x,
      (clip, value) => updateTransform(clip, { rotation: { x: value } }),
      { unit: 'deg', step: 0.1 },
    ),
    createTransformDescriptor(
      'rotation.y',
      'Rotation Y',
      0,
      (clip) => clip.transform.rotation.y,
      (clip, value) => updateTransform(clip, { rotation: { y: value } }),
      { unit: 'deg', step: 0.1 },
    ),
    createTransformDescriptor(
      'rotation.z',
      'Rotation',
      0,
      (clip) => clip.transform.rotation.z,
      (clip, value) => updateTransform(clip, { rotation: { z: value } }),
      { unit: 'deg', step: 0.1, aliases: ['rotation z'] },
    ),
    {
      path: 'speed',
      label: 'Speed',
      group: 'Transform',
      valueType: 'number',
      animatable: true,
      defaultValue: 1,
      ui: { min: -8, max: 8, step: 0.01, aliases: ['time stretch', 'playback speed'] },
      read: (clip) => clip.speed ?? 1,
      write: (clip, value) => ({ ...clip, speed: value as number }),
    },
  ]);
}
