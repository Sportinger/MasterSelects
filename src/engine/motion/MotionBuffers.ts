import type {
  ColorFillAppearance,
  MotionColor,
  MotionLayerDefinition,
  ShapePrimitive,
  StrokeAppearance,
} from '../../types/motionDesign';
import type { MotionRenderSize } from './MotionTypes';

const TRANSPARENT: MotionColor = { r: 0, g: 0, b: 0, a: 0 };

function primitiveCode(primitive: ShapePrimitive | undefined): number {
  return primitive === 'ellipse' ? 1 : 0;
}

function strokeAlignmentCode(alignment: StrokeAppearance['alignment'] | undefined): number {
  if (alignment === 'inside') return 1;
  if (alignment === 'outside') return 2;
  return 0;
}

function findFill(motion: MotionLayerDefinition): ColorFillAppearance | undefined {
  return motion.appearance?.items.find((item): item is ColorFillAppearance => (
    item.kind === 'color-fill' &&
    item.visible !== false &&
    item.opacity > 0
  ));
}

function findStroke(motion: MotionLayerDefinition): StrokeAppearance | undefined {
  return motion.appearance?.items.find((item): item is StrokeAppearance => (
    item.kind === 'stroke' &&
    item.visible !== false &&
    item.opacity > 0 &&
    item.width > 0
  ));
}

function writeColor(target: Float32Array, offset: number, color: MotionColor): void {
  target[offset] = color.r;
  target[offset + 1] = color.g;
  target[offset + 2] = color.b;
  target[offset + 3] = color.a;
}

export function createMotionUniformArray(
  motion: MotionLayerDefinition,
  size: MotionRenderSize,
): Float32Array<ArrayBuffer> {
  const shape = motion.shape;
  const fill = findFill(motion);
  const stroke = findStroke(motion);
  const data = new Float32Array(20);

  data[0] = Math.max(1, shape?.size.w ?? 1);
  data[1] = Math.max(1, shape?.size.h ?? 1);
  data[2] = size.width;
  data[3] = size.height;

  data[4] = Math.max(0, shape?.cornerRadius ?? 0);
  data[5] = primitiveCode(shape?.primitive);
  data[6] = fill?.opacity ?? 0;
  data[7] = stroke?.opacity ?? 0;

  writeColor(data, 8, fill?.color ?? TRANSPARENT);
  writeColor(data, 12, stroke?.color ?? TRANSPARENT);

  data[16] = stroke?.width ?? 0;
  data[17] = stroke ? 1 : 0;
  data[18] = strokeAlignmentCode(stroke?.alignment);
  data[19] = 0;

  return data;
}

export function createMotionInstanceArray(
  size: MotionRenderSize,
): Float32Array<ArrayBuffer> {
  const replicator = size.replicator;
  const countX = Math.max(1, replicator.countX);
  const countY = Math.max(1, replicator.countY);
  const data = new Float32Array(replicator.instanceCount * 4);
  const gridCenterX = (countX - 1) * 0.5;
  const gridCenterY = (countY - 1) * 0.5;
  let cursor = 0;

  for (let y = 0; y < countY; y += 1) {
    const rowOffsetX = y % 2 === 1 ? replicator.patternOffsetX : 0;
    const rowOffsetY = y % 2 === 1 ? replicator.patternOffsetY : 0;
    for (let x = 0; x < countX; x += 1) {
      const instanceIndex = y * countX + x;
      data[cursor] = (x - gridCenterX) * replicator.spacingX + rowOffsetX - replicator.boundsCenterX;
      data[cursor + 1] = (y - gridCenterY) * replicator.spacingY + rowOffsetY - replicator.boundsCenterY;
      data[cursor + 2] = instanceIndex === 0
        ? 1
        : Math.pow(replicator.offsetOpacity, instanceIndex);
      data[cursor + 3] = 0;
      cursor += 4;
    }
  }

  return data;
}
