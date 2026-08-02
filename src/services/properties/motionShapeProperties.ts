import type { TimelineClip } from '../../types/timeline';
import type {
  MotionLayerDefinition,
  MotionShapeProperty,
  ShapeDefinition,
} from '../../types/motionDesign';
import {
  DEFAULT_MOTION_SHAPE_SIZE,
  DEFAULT_MOTION_PATH_TRIM,
  DEFAULT_MOTION_PATH_DASH,
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
  if (path === 'shape.star.cornerRadius') return shape.star?.cornerRadius ?? 0;
  if (path === 'shape.path.trim.start') return shape.path?.trim?.start ?? DEFAULT_MOTION_PATH_TRIM.start;
  if (path === 'shape.path.trim.end') return shape.path?.trim?.end ?? DEFAULT_MOTION_PATH_TRIM.end;
  if (path === 'shape.path.trim.offset') return shape.path?.trim?.offset ?? DEFAULT_MOTION_PATH_TRIM.offset;
  if (path === 'shape.path.dash.length') return shape.path?.dash?.length ?? DEFAULT_MOTION_PATH_DASH.length;
  if (path === 'shape.path.dash.gap') return shape.path?.dash?.gap ?? DEFAULT_MOTION_PATH_DASH.gap;
  return shape.path?.dash?.offset ?? DEFAULT_MOTION_PATH_DASH.offset;
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
  if (path.startsWith('shape.path.')) {
    if (shape.primitive !== 'path') return shape;
    const pathDefinition = shape.path ?? defaults.path!;
    if (path.startsWith('shape.path.trim.')) {
      const field = path.slice('shape.path.trim.'.length) as keyof NonNullable<typeof pathDefinition.trim>;
      return {
        ...shape,
        path: {
          ...pathDefinition,
          trim: {
            ...DEFAULT_MOTION_PATH_TRIM,
            ...pathDefinition.trim,
            [field]: value,
          },
        },
      };
    }
    const field = path.slice('shape.path.dash.'.length) as keyof NonNullable<typeof pathDefinition.dash>;
    return {
      ...shape,
      path: {
        ...pathDefinition,
        dash: {
          ...DEFAULT_MOTION_PATH_DASH,
          ...pathDefinition.dash,
          [field]: value,
        },
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
  if (path === 'shape.path.trim.end') return 1;
  return 0;
}

function numberUi(path: MotionShapeProperty): PropertyDescriptor<number>['ui'] {
  const pointField = path === 'shape.polygon.points' || path === 'shape.star.points';
  const trimField = path.startsWith('shape.path.trim.');
  return {
    min: pointField ? 3 : path.startsWith('shape.size.') ? 1 : 0,
    ...(pointField ? { max: 32 } : trimField ? { max: 1 } : {}),
    step: trimField ? 0.01 : 1,
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
