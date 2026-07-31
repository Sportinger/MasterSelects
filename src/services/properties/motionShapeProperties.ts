import type { TimelineClip } from '../../types/timeline';
import type {
  MotionLayerDefinition,
  MotionShapeProperty,
  ShapeDefinition,
} from '../../types/motionDesign';
import {
  DEFAULT_MOTION_SHAPE_SIZE,
  createDefaultMotionLayerDefinition,
  createDefaultShapeDefinition,
} from '../../types/motionDesign';
import type { PropertyDescriptor } from '../../types/propertyRegistry';

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(
    motion ?? createDefaultMotionLayerDefinition('shape'),
  ) as MotionLayerDefinition;
}

function getShape(motion: MotionLayerDefinition | undefined): ShapeDefinition {
  return motion?.shape ?? createDefaultShapeDefinition();
}

function readShapeValue(
  shape: ShapeDefinition,
  path: MotionShapeProperty,
): number {
  const defaultRadius = Math.min(shape.size.w, shape.size.h) * 0.5;
  if (path === 'shape.size.w') return shape.size.w;
  if (path === 'shape.size.h') return shape.size.h;
  if (path === 'shape.cornerRadius') return shape.cornerRadius ?? 0;
  if (path === 'shape.polygon.points') return shape.polygon?.points ?? 6;
  if (path === 'shape.polygon.radius') return shape.polygon?.radius ?? defaultRadius;
  if (path === 'shape.polygon.cornerRadius') return shape.polygon?.cornerRadius ?? 0;
  if (path === 'shape.star.points') return shape.star?.points ?? 5;
  if (path === 'shape.star.outerRadius') return shape.star?.outerRadius ?? defaultRadius;
  if (path === 'shape.star.innerRadius') return shape.star?.innerRadius ?? defaultRadius * 0.5;
  return shape.star?.cornerRadius ?? 0;
}

function writeShapeValue(
  shape: ShapeDefinition,
  path: MotionShapeProperty,
  value: number,
): ShapeDefinition {
  const defaults = createDefaultShapeDefinition(shape.primitive, shape.size);
  if (path === 'shape.size.w' || path === 'shape.size.h') {
    return {
      ...shape,
      size: {
        ...shape.size,
        ...(path === 'shape.size.w' ? { w: value } : { h: value }),
      },
    };
  }
  if (path === 'shape.cornerRadius') {
    return { ...shape, cornerRadius: value };
  }
  if (path.startsWith('shape.polygon.')) {
    const field = path.slice('shape.polygon.'.length) as keyof NonNullable<ShapeDefinition['polygon']>;
    return {
      ...shape,
      polygon: {
        ...defaults.polygon!,
        ...shape.polygon,
        [field]: value,
      },
    };
  }
  const field = path.slice('shape.star.'.length) as keyof NonNullable<ShapeDefinition['star']>;
  return {
    ...shape,
    star: {
      ...defaults.star!,
      ...shape.star,
      [field]: value,
    },
  };
}

function defaultValue(path: MotionShapeProperty): number {
  if (path === 'shape.size.w') return DEFAULT_MOTION_SHAPE_SIZE.w;
  if (path === 'shape.size.h') return DEFAULT_MOTION_SHAPE_SIZE.h;
  if (path === 'shape.polygon.points') return 6;
  if (path === 'shape.polygon.radius') return 90;
  if (path === 'shape.star.points') return 5;
  if (path === 'shape.star.outerRadius') return 90;
  if (path === 'shape.star.innerRadius') return 45;
  return 0;
}

function numberUi(path: MotionShapeProperty): PropertyDescriptor<number>['ui'] {
  const pointField = path === 'shape.polygon.points' || path === 'shape.star.points';
  return {
    min: pointField ? 3 : path.startsWith('shape.size.') ? 1 : 0,
    ...(pointField ? { max: 32 } : {}),
    step: 1,
    aliases: ['motion', 'shape'],
  };
}

export function createMotionShapeDescriptor(
  path: MotionShapeProperty,
  label: string,
): PropertyDescriptor<number> {
  return {
    path,
    label,
    group: 'Motion / Shape',
    valueType: 'number',
    animatable: true,
    defaultValue: defaultValue(path),
    ui: numberUi(path),
    read: (clip) => readShapeValue(getShape(clip.motion), path),
    write: (clip: TimelineClip, value) => ({
      ...clip,
      motion: (() => {
        const motion = cloneMotion(clip.motion);
        return {
          ...motion,
          shape: writeShapeValue(getShape(motion), path, value as number),
        };
      })(),
    }),
  };
}
