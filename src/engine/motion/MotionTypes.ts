import type { MotionLayerDefinition, ReplicatorLayout, StrokeAppearance } from '../../types/motionDesign';

export const MOTION_RENDER_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const MOTION_REPLICATOR_SHADER_MAX_INSTANCES = 100;

export interface MotionRenderSize {
  width: number;
  height: number;
  strokePadding: number;
  replicator: MotionReplicatorRenderState;
}

export interface MotionReplicatorRenderState {
  enabled: boolean;
  countX: number;
  countY: number;
  spacingX: number;
  spacingY: number;
  patternOffsetX: number;
  patternOffsetY: number;
  offsetOpacity: number;
  instanceCount: number;
  boundsCenterX: number;
  boundsCenterY: number;
  boundsWidth: number;
  boundsHeight: number;
}

export interface MotionRenderResult extends MotionRenderSize {
  textureView: GPUTextureView;
}

export interface MotionClipGpuCache {
  texture: GPUTexture;
  view: GPUTextureView;
  uniformBuffer: GPUBuffer;
  instanceBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
}

function getVisibleStroke(motion: MotionLayerDefinition): StrokeAppearance | undefined {
  return motion.appearance?.items.find((item): item is StrokeAppearance => (
    item.kind === 'stroke' &&
    item.visible !== false &&
    item.opacity > 0 &&
    item.width > 0
  ));
}

function getStrokePadding(stroke: StrokeAppearance | undefined): number {
  if (!stroke) return 0;
  if (stroke.alignment === 'inside') return 0;
  if (stroke.alignment === 'center') return Math.ceil(stroke.width / 2);
  return Math.ceil(stroke.width);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampCount(value: number | undefined, max: number): number {
  return Math.max(1, Math.min(max, Math.round(finiteOr(value, 1))));
}

function getGridLayout(layout: ReplicatorLayout | undefined): Extract<ReplicatorLayout, { mode: 'grid' }> | undefined {
  return layout?.mode === 'grid' ? layout : undefined;
}

function getGridBounds(params: {
  countX: number;
  countY: number;
  spacingX: number;
  spacingY: number;
  patternOffsetX: number;
  patternOffsetY: number;
}): { centerX: number; centerY: number; width: number; height: number } {
  const { countX, countY, spacingX, spacingY, patternOffsetX, patternOffsetY } = params;
  const gridCenterX = (countX - 1) * 0.5;
  const gridCenterY = (countY - 1) * 0.5;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let initialized = false;

  for (let y = 0; y < countY; y += 1) {
    const rowOffsetX = y % 2 === 1 ? patternOffsetX : 0;
    const rowOffsetY = y % 2 === 1 ? patternOffsetY : 0;
    for (let x = 0; x < countX; x += 1) {
      const offsetX = (x - gridCenterX) * spacingX + rowOffsetX;
      const offsetY = (y - gridCenterY) * spacingY + rowOffsetY;
      if (!initialized) {
        minX = offsetX;
        maxX = offsetX;
        minY = offsetY;
        maxY = offsetY;
        initialized = true;
      } else {
        minX = Math.min(minX, offsetX);
        maxX = Math.max(maxX, offsetX);
        minY = Math.min(minY, offsetY);
        maxY = Math.max(maxY, offsetY);
      }
    }
  }

  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getMotionReplicatorRenderState(motion: MotionLayerDefinition | undefined): MotionReplicatorRenderState {
  const replicator = motion?.replicator;
  const layout = getGridLayout(replicator?.layout);
  if (!replicator?.enabled || !layout) {
    return {
      enabled: false,
      countX: 1,
      countY: 1,
      spacingX: 0,
      spacingY: 0,
      patternOffsetX: 0,
      patternOffsetY: 0,
      offsetOpacity: 1,
      instanceCount: 1,
      boundsCenterX: 0,
      boundsCenterY: 0,
      boundsWidth: 0,
      boundsHeight: 0,
    };
  }

  const maxInstances = clampCount(replicator.maxInstances, MOTION_REPLICATOR_SHADER_MAX_INSTANCES);
  const countX = clampCount(layout.count.x, maxInstances);
  const countY = clampCount(layout.count.y, Math.max(1, Math.floor(maxInstances / countX)));
  const spacingX = finiteOr(layout.spacing.x, 0) + finiteOr(replicator.offset.position.x, 0);
  const spacingY = finiteOr(layout.spacing.y, 0) + finiteOr(replicator.offset.position.y, 0);
  const patternOffsetX = finiteOr(layout.patternOffset?.x, 0);
  const patternOffsetY = finiteOr(layout.patternOffset?.y, 0);
  const bounds = getGridBounds({
    countX,
    countY,
    spacingX,
    spacingY,
    patternOffsetX,
    patternOffsetY,
  });

  return {
    enabled: true,
    countX,
    countY,
    spacingX,
    spacingY,
    patternOffsetX,
    patternOffsetY,
    offsetOpacity: Math.max(0, Math.min(1, finiteOr(replicator.offset.opacity, 1))),
    instanceCount: countX * countY,
    boundsCenterX: bounds.centerX,
    boundsCenterY: bounds.centerY,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  };
}

export function getMotionRenderSize(motion: MotionLayerDefinition | undefined): MotionRenderSize {
  const shape = motion?.shape;
  const width = Math.max(1, Math.ceil(shape?.size.w ?? 1));
  const height = Math.max(1, Math.ceil(shape?.size.h ?? 1));
  const strokePadding = getStrokePadding(motion ? getVisibleStroke(motion) : undefined);
  const replicator = getMotionReplicatorRenderState(motion);
  const replicatedWidth = Math.ceil(replicator.boundsWidth);
  const replicatedHeight = Math.ceil(replicator.boundsHeight);

  return {
    width: width + strokePadding * 2 + replicatedWidth,
    height: height + strokePadding * 2 + replicatedHeight,
    strokePadding,
    replicator,
  };
}
