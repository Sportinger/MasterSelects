import type {
  AppearanceItem,
  GradientStop,
  MotionColor,
  MotionLayerDefinition,
  ShapePrimitive,
  StrokeAppearance,
  TextureFillAppearance,
} from '../../types/motionDesign';
import {
  getMotionShapeRenderBounds,
  type MotionRenderSize,
} from './MotionTypes';
import { MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE } from './replicator/runtimeContracts';
import {
  flattenMotionPath,
  type FlattenedMotionPath,
} from '../../services/motionDesign/path/flattenPath';

export const MOTION_MAX_APPEARANCES = 8;
export const MOTION_MAX_GRADIENT_STOPS = 8;

const HEADER_VEC4_COUNT = 4;
const APPEARANCE_ARRAY_COUNT = 4;
const GRADIENT_COLOR_VEC4_COUNT =
  MOTION_MAX_APPEARANCES * MOTION_MAX_GRADIENT_STOPS;
const GRADIENT_OFFSET_VEC4_COUNT = Math.ceil(GRADIENT_COLOR_VEC4_COUNT / 4);
const PATH_PARAMS_VEC4_COUNT = 2;

export const MOTION_UNIFORM_VEC4_COUNT =
  HEADER_VEC4_COUNT
  + APPEARANCE_ARRAY_COUNT * MOTION_MAX_APPEARANCES
  + GRADIENT_COLOR_VEC4_COUNT
  + GRADIENT_OFFSET_VEC4_COUNT
  + PATH_PARAMS_VEC4_COUNT;
export const MOTION_UNIFORM_FLOAT_COUNT = MOTION_UNIFORM_VEC4_COUNT * 4;
export const MOTION_UNIFORM_BYTE_SIZE = MOTION_UNIFORM_FLOAT_COUNT * 4;

export const MOTION_APPEARANCE_META_OFFSET = HEADER_VEC4_COUNT * 4;
const APPEARANCE_DETAIL_OFFSET =
  MOTION_APPEARANCE_META_OFFSET + MOTION_MAX_APPEARANCES * 4;
const APPEARANCE_GEOMETRY_OFFSET =
  APPEARANCE_DETAIL_OFFSET + MOTION_MAX_APPEARANCES * 4;
const APPEARANCE_COLOR_OFFSET =
  APPEARANCE_GEOMETRY_OFFSET + MOTION_MAX_APPEARANCES * 4;
const GRADIENT_COLORS_OFFSET =
  APPEARANCE_COLOR_OFFSET + MOTION_MAX_APPEARANCES * 4;
const GRADIENT_OFFSETS_OFFSET =
  GRADIENT_COLORS_OFFSET + GRADIENT_COLOR_VEC4_COUNT * 4;
export const MOTION_PATH_PARAMS_OFFSET = 464;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function primitiveCode(primitive: ShapePrimitive | undefined): number {
  if (primitive === 'ellipse') return 1;
  if (primitive === 'polygon') return 2;
  if (primitive === 'star') return 3;
  if (primitive === 'path') return 4;
  return 0;
}

function appearanceKindCode(kind: AppearanceItem['kind']): number {
  if (kind === 'stroke') return 1;
  if (kind === 'linear-gradient') return 2;
  if (kind === 'radial-gradient') return 3;
  if (kind === 'texture-fill') return 4;
  return 0;
}

function textureFitCode(fit: TextureFillAppearance['fit']): number {
  if (fit === 'contain') return 1;
  if (fit === 'cover') return 2;
  if (fit === 'fill') return 3;
  if (fit === 'stretch') return 4;
  return 5;
}

function blendModeCode(blendMode: AppearanceItem['blendMode']): number {
  if (blendMode === 'multiply') return 1;
  if (blendMode === 'screen') return 2;
  if (blendMode === 'add' || blendMode === 'linear-dodge') return 3;
  if (blendMode === 'overlay') return 4;
  if (blendMode === 'difference') return 5;
  return 0;
}

function strokeAlignmentCode(alignment: StrokeAppearance['alignment'] | undefined): number {
  if (alignment === 'inside') return 1;
  if (alignment === 'outside') return 2;
  return 0;
}

function writeColor(target: Float32Array, offset: number, color: MotionColor): void {
  target[offset] = clamp(finiteOr(color.r, 0), 0, 1);
  target[offset + 1] = clamp(finiteOr(color.g, 0), 0, 1);
  target[offset + 2] = clamp(finiteOr(color.b, 0), 0, 1);
  target[offset + 3] = clamp(finiteOr(color.a, 0), 0, 1);
}

function getRenderableAppearances(motion: MotionLayerDefinition): AppearanceItem[] {
  return (motion.appearance?.items ?? [])
    .slice(0, MOTION_MAX_APPEARANCES);
}

export interface MotionTextureFillUniformState {
  /** Only slot zero is bound in this MD5 still-image slice. */
  activeAppearanceId: string | null;
  sourceSize?: { width: number; height: number };
}

function writeGradientStops(
  target: Float32Array,
  appearanceIndex: number,
  stops: readonly GradientStop[],
): number {
  const sortedStops = [...stops]
    .sort((left, right) => left.offset - right.offset)
    .slice(0, MOTION_MAX_GRADIENT_STOPS);

  sortedStops.forEach((stop, stopIndex) => {
    const flatStopIndex =
      appearanceIndex * MOTION_MAX_GRADIENT_STOPS + stopIndex;
    writeColor(
      target,
      GRADIENT_COLORS_OFFSET + flatStopIndex * 4,
      stop.color,
    );
    target[GRADIENT_OFFSETS_OFFSET + flatStopIndex] =
      clamp(finiteOr(stop.offset, 0), 0, 1);
  });

  return sortedStops.length;
}

function writeAppearance(
  target: Float32Array,
  item: AppearanceItem,
  index: number,
  textureFill?: MotionTextureFillUniformState,
): void {
  const metaOffset = MOTION_APPEARANCE_META_OFFSET + index * 4;
  const detailOffset = APPEARANCE_DETAIL_OFFSET + index * 4;
  const geometryOffset = APPEARANCE_GEOMETRY_OFFSET + index * 4;
  const colorOffset = APPEARANCE_COLOR_OFFSET + index * 4;

  target[metaOffset] = appearanceKindCode(item.kind);
  const textureIsActive = item.kind !== 'texture-fill'
    || textureFill === undefined
    || textureFill.activeAppearanceId === item.id;
  target[metaOffset + 1] = item.visible === false || !textureIsActive ? 0 : 1;
  target[metaOffset + 2] = clamp(finiteOr(item.opacity, 1), 0, 1);
  target[metaOffset + 3] = blendModeCode(item.blendMode);

  if (item.kind === 'color-fill') {
    writeColor(target, colorOffset, item.color);
    return;
  }

  if (item.kind === 'stroke') {
    target[detailOffset] = Math.max(0, finiteOr(item.width, 0));
    target[detailOffset + 1] = strokeAlignmentCode(item.alignment);
    writeColor(target, colorOffset, item.color);
    return;
  }

  if (item.kind === 'linear-gradient') {
    target[detailOffset + 2] = writeGradientStops(target, index, item.stops);
    target[geometryOffset] = finiteOr(item.start.x, 0);
    target[geometryOffset + 1] = finiteOr(item.start.y, 0.5);
    target[geometryOffset + 2] = finiteOr(item.end.x, 1);
    target[geometryOffset + 3] = finiteOr(item.end.y, 0.5);
    return;
  }

  if (item.kind === 'radial-gradient') {
    target[detailOffset + 2] = writeGradientStops(target, index, item.stops);
    target[detailOffset + 3] = Math.max(0.001, finiteOr(item.radius, 0.5));
    target[geometryOffset] = finiteOr(item.center.x, 0.5);
    target[geometryOffset + 1] = finiteOr(item.center.y, 0.5);
    return;
  }

  if (item.kind === 'texture-fill') {
    // detail = fit mode, bind-group texture slot, source aspect, rotation.
    // geometry = transform position.xy, transform scale.xy.
    const source = textureFill?.sourceSize;
    target[detailOffset] = textureFitCode(item.fit);
    target[detailOffset + 1] = 0;
    target[detailOffset + 2] = Math.max(
      0.0001,
      finiteOr(source?.width, 1) / Math.max(0.0001, finiteOr(source?.height, 1)),
    );
    target[detailOffset + 3] = finiteOr(item.transform.rotation, 0);
    target[geometryOffset] = finiteOr(item.transform.position.x, 0);
    target[geometryOffset + 1] = finiteOr(item.transform.position.y, 0);
    target[geometryOffset + 2] = nonZeroOr(item.transform.scale.x, 1);
    target[geometryOffset + 3] = nonZeroOr(item.transform.scale.y, 1);
  }
}

export function createMotionUniformArray(
  motion: MotionLayerDefinition,
  size: MotionRenderSize,
  textureFill?: MotionTextureFillUniformState,
  flattenedPathInput?: FlattenedMotionPath | null,
): Float32Array<ArrayBuffer> {
  const shape = motion.shape;
  const shapeBounds = getMotionShapeRenderBounds(motion);
  const shapeWidth = shapeBounds.width;
  const shapeHeight = shapeBounds.height;
  const defaultRadius = Math.min(shapeWidth, shapeHeight) * 0.5;
  const polygon = shape?.polygon;
  const star = shape?.star;
  const appearances = getRenderableAppearances(motion);
  const flattenedPath = shape?.primitive === 'path' && shape.path
    ? (flattenedPathInput === undefined
        ? flattenMotionPath(shape.path)
        : flattenedPathInput)
    : null;
  const pathParamsOffset = MOTION_PATH_PARAMS_OFFSET;
  const data = new Float32Array(MOTION_UNIFORM_FLOAT_COUNT);

  data[0] = shapeWidth;
  data[1] = shapeHeight;
  data[2] = size.width;
  data[3] = size.height;

  data[4] = Math.max(0, finiteOr(shape?.cornerRadius, 0));
  data[5] = primitiveCode(shape?.primitive);
  data[6] = appearances.length;
  data[7] = size.strokePadding;

  data[8] = clamp(Math.round(finiteOr(polygon?.points, 6)), 3, 32);
  data[9] = Math.max(1, finiteOr(polygon?.radius, defaultRadius));
  data[10] = Math.max(0, finiteOr(polygon?.cornerRadius, 0));
  data[11] = clamp(Math.round(finiteOr(star?.points, 5)), 3, 32);

  data[12] = Math.max(1, finiteOr(star?.outerRadius, defaultRadius));
  data[13] = Math.max(0.5, finiteOr(star?.innerRadius, defaultRadius * 0.5));
  data[14] = Math.max(0, finiteOr(star?.cornerRadius, 0));

  if (shape?.primitive === 'path' && shape.path && flattenedPath) {
    const trim = shape.path.trim;
    const dash = shape.path.dash;
    data[pathParamsOffset] = clamp(finiteOr(trim?.start, 0), 0, 1);
    data[pathParamsOffset + 1] = clamp(finiteOr(trim?.end, 1), 0, 1);
    data[pathParamsOffset + 2] = clamp(finiteOr(trim?.offset, 0), 0, 1);
    data[pathParamsOffset + 3] = finiteOr(dash?.length, 0);
    data[pathParamsOffset + 4] = finiteOr(dash?.gap, 0);
    data[pathParamsOffset + 5] = finiteOr(dash?.offset, 0);
    data[pathParamsOffset + 6] = flattenedPath.points.length;
    data[pathParamsOffset + 7] = flattenedPath.closed ? 1 : 0;
  } else {
    data[pathParamsOffset + 1] = 1;
  }

  appearances.forEach((item, index) => writeAppearance(data, item, index, textureFill));
  return data;
}

function nonZeroOr(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved === 0 ? fallback : resolved;
}

export function createMotionInstanceArray(
  size: MotionRenderSize,
): Float32Array<ArrayBuffer> {
  const replicator = size.replicator;
  const data = new Float32Array(replicator.instanceData);
  for (let instance = 0; instance < replicator.instanceCount; instance += 1) {
    const offset = instance * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE;
    data[offset + 4] -= replicator.boundsCenterX;
    data[offset + 5] -= replicator.boundsCenterY;
  }
  return data;
}
