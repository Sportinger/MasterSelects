import type { MotionLayerDefinition, StrokeAppearance } from '../../types/motionDesign';

export const MOTION_RENDER_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';

export interface MotionRenderSize {
  width: number;
  height: number;
  strokePadding: number;
}

export interface MotionRenderResult extends MotionRenderSize {
  textureView: GPUTextureView;
}

export interface MotionClipGpuCache {
  texture: GPUTexture;
  view: GPUTextureView;
  uniformBuffer: GPUBuffer;
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

export function getMotionRenderSize(motion: MotionLayerDefinition | undefined): MotionRenderSize {
  const shape = motion?.shape;
  const width = Math.max(1, Math.ceil(shape?.size.w ?? 1));
  const height = Math.max(1, Math.ceil(shape?.size.h ?? 1));
  const strokePadding = getStrokePadding(motion ? getVisibleStroke(motion) : undefined);

  return {
    width: width + strokePadding * 2,
    height: height + strokePadding * 2,
    strokePadding,
  };
}
