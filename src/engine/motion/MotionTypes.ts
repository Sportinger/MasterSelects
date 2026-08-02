import type { Layer } from '../../types/layers';
import type { MotionLayerDefinition, StrokeAppearance } from '../../types/motionDesign';
import { normalizeMotionReplicatorBundle } from '../../services/motionDesign/contracts/replicatorTimelineAdapter';
import { createReplicatorRenderPacket } from './replicator/rendererAdapter';
import {
  MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
  type ReplicatorRuntimeDiagnostic,
} from './replicator/runtimeContracts';
import type { ReplicatorDiagnostic } from '../../services/motionDesign/replicator/contracts';
import type {
  MotionFrameExpressionValue,
  MotionFrameModifierState,
  MotionFrameReplicatorState,
} from '../../services/motionDesign/contracts/evaluatedMotionFrame';

export const MOTION_RENDER_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const MOTION_REPLICATOR_SHADER_MAX_INSTANCES = 100_000;

export interface MotionRenderSize {
  width: number;
  height: number;
  strokePadding: number;
  replicator: MotionReplicatorRenderState;
}

export interface MotionReplicatorRenderState {
  enabled: boolean;
  cacheIdentity: string;
  instanceData: Float32Array;
  diagnostics: readonly (ReplicatorDiagnostic | ReplicatorRuntimeDiagnostic)[];
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
  pathBuffer: GPUBuffer | null;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
  instanceCapacity: number;
  pathCapacity: number;
}

export interface MotionReplicatorSourceGeometry {
  sourceBounds: { minX: number; minY: number; maxX: number; maxY: number };
  strokePadding: number;
}

function getVisibleStrokes(motion: MotionLayerDefinition): StrokeAppearance[] {
  return motion.appearance?.items.filter((item): item is StrokeAppearance => (
    item.kind === 'stroke' &&
    item.visible !== false &&
    item.opacity > 0 &&
    item.width > 0
  )) ?? [];
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

export function getMotionShapeRenderBounds(
  motion: MotionLayerDefinition | undefined,
): { width: number; height: number } {
  const shape = motion?.shape;
  const width = Math.max(1, finiteOr(shape?.size.w, 1));
  const height = Math.max(1, finiteOr(shape?.size.h, 1));
  if (shape?.primitive === 'polygon') {
    const diameter = Math.max(2, finiteOr(
      shape.polygon?.radius,
      Math.min(width, height) * 0.5,
    ) * 2);
    return {
      width: Math.max(width, diameter),
      height: Math.max(height, diameter),
    };
  }
  if (shape?.primitive === 'star') {
    const diameter = Math.max(2, finiteOr(
      shape.star?.outerRadius,
      Math.min(width, height) * 0.5,
    ) * 2);
    return {
      width: Math.max(width, diameter),
      height: Math.max(height, diameter),
    };
  }
  if (shape?.primitive === 'path' && shape.path?.vertices.length) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const vertex of shape.path.vertices) {
      const points = [
        vertex,
        { x: vertex.x + vertex.handleIn.x, y: vertex.y + vertex.handleIn.y },
        { x: vertex.x + vertex.handleOut.x, y: vertex.y + vertex.handleOut.y },
      ];
      for (const point of points) {
        minX = Math.min(minX, finiteOr(point.x, 0));
        minY = Math.min(minY, finiteOr(point.y, 0));
        maxX = Math.max(maxX, finiteOr(point.x, 0));
        maxY = Math.max(maxY, finiteOr(point.y, 0));
      }
    }
    return {
      width: Math.max(width, 2 * Math.max(Math.abs(minX), Math.abs(maxX))),
      height: Math.max(height, 2 * Math.max(Math.abs(minY), Math.abs(maxY))),
    };
  }
  return { width, height };
}

export function getMotionReplicatorSourceGeometry(
  motion: MotionLayerDefinition | undefined,
): MotionReplicatorSourceGeometry {
  const shapeBounds = getMotionShapeRenderBounds(motion);
  const strokePadding = motion
    ? getVisibleStrokes(motion).reduce(
        (maximum, stroke) => Math.max(maximum, getStrokePadding(stroke)),
        0,
      )
    : 0;
  const halfWidth = shapeBounds.width * 0.5 + strokePadding;
  const halfHeight = shapeBounds.height * 0.5 + strokePadding;
  return {
    sourceBounds: {
      minX: -halfWidth,
      minY: -halfHeight,
      maxX: halfWidth,
      maxY: halfHeight,
    },
    strokePadding,
  };
}

export function getMotionReplicatorRenderState(
  motion: MotionLayerDefinition | undefined,
  frameReplicator: MotionFrameReplicatorState | null | undefined = undefined,
  frameModifier: MotionFrameModifierState | null | undefined = undefined,
  frameExpressions: readonly MotionFrameExpressionValue[] | null | undefined = undefined,
): MotionReplicatorRenderState {
  const { sourceBounds } = getMotionReplicatorSourceGeometry(motion);
  const replicatorValue = motion?.replicator;
  if (!replicatorValue) {
    return {
      enabled: false,
      cacheIdentity: 'motion-replicator:none',
      instanceData: createIdentityInstanceData(sourceBounds),
      diagnostics: [],
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
      boundsWidth: sourceBounds.maxX - sourceBounds.minX,
      boundsHeight: sourceBounds.maxY - sourceBounds.minY,
    };
  }
  try {
    const replicator = normalizeMotionReplicatorBundle(
      replicatorValue,
      motion?.modifierStack,
    ).replicator;
    if (frameReplicator === null) {
      return createFailedReplicatorState([{
        code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
        severity: 'error',
        message: 'Motion frame-state admission did not provide this Replicator evaluation',
      }], sourceBounds);
    }
    if (
      frameReplicator !== undefined
      && (
        JSON.stringify(frameReplicator.contract) !== JSON.stringify(replicator)
        || JSON.stringify(frameReplicator.sourceBounds) !== JSON.stringify(sourceBounds)
      )
    ) {
      return createFailedReplicatorState([{
        code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
        severity: 'error',
        message: 'Motion frame-state Replicator provenance does not match the rendered layer',
      }], sourceBounds);
    }
    if (frameReplicator === undefined) {
      if (replicator.enabled) {
        return createFailedReplicatorState([{
          code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
          severity: 'error',
          message: 'Enabled Motion Replicators require an admitted Motion frame state',
        }], sourceBounds);
      }
      return {
        enabled: false,
        cacheIdentity: `motion-replicator:v2:r${replicator.revision}|base`,
        instanceData: createIdentityInstanceData(sourceBounds),
        diagnostics: [],
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
        boundsWidth: sourceBounds.maxX - sourceBounds.minX,
        boundsHeight: sourceBounds.maxY - sourceBounds.minY,
      };
    }
    const evaluation = frameReplicator.evaluation;
    const grid = replicator.layout.mode === 'grid' ? replicator.layout : null;
    if (!evaluation.enabled) {
      return {
        enabled: false,
        cacheIdentity: `${evaluation.cacheKey}|base`,
        instanceData: createIdentityInstanceData(sourceBounds),
        diagnostics: evaluation.diagnostics,
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
        boundsWidth: sourceBounds.maxX - sourceBounds.minX,
        boundsHeight: sourceBounds.maxY - sourceBounds.minY,
      };
    }
    // The frame state pairs modifier plans with the replicator evaluation of
    // the same layer, so that evaluation's cache key is the plan's provenance.
    // The adapter applies planned per-instance transforms and omits clipped
    // instances; without a plan the packet is byte-identical to before.
    const packet = createReplicatorRenderPacket(evaluation, {
      ...(frameModifier
        ? {
            modifierPlan: frameModifier.plan,
            modifierPlanReplicatorCacheKey: evaluation.cacheKey,
          }
        : {}),
      ...(frameExpressions && frameExpressions.length > 0
        ? {
            expressionValues: frameExpressions,
            expressionValuesReplicatorCacheKey: evaluation.cacheKey,
          }
        : {}),
    });
    if (!packet.ok || !packet.contentBounds || !packet.cacheIdentity) {
      return createFailedReplicatorState(packet.diagnostics, sourceBounds);
    }
    const bounds = packet.contentBounds;
    return {
      enabled: true,
      cacheIdentity: packet.cacheIdentity,
      instanceData: packet.instanceData,
      diagnostics: packet.diagnostics,
      countX: grid?.count.columns ?? evaluation.effectiveCount,
      countY: grid?.count.rows ?? 1,
      spacingX: grid?.spacing.x ?? 0,
      spacingY: grid?.spacing.y ?? 0,
      patternOffsetX: grid?.patternOffset.x ?? 0,
      patternOffsetY: grid?.patternOffset.y ?? 0,
      offsetOpacity: replicator.terminalTransform.opacity,
      instanceCount: packet.stats.visibleInstances,
      boundsCenterX: (bounds.minX + bounds.maxX) * 0.5,
      boundsCenterY: (bounds.minY + bounds.maxY) * 0.5,
      boundsWidth: bounds.maxX - bounds.minX,
      boundsHeight: bounds.maxY - bounds.minY,
    };
  } catch (error) {
    return createFailedReplicatorState([{
      code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Unknown Replicator integration failure',
    }], sourceBounds);
  }
}

function createIdentityInstanceData(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): Float32Array {
  const data = new Float32Array(MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
  data.set([1, 0, 0, 1, 0, 0, 1, 0, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
  return data;
}

function createFailedReplicatorState(
  diagnostics: readonly (ReplicatorDiagnostic | ReplicatorRuntimeDiagnostic)[],
  sourceBounds: { minX: number; minY: number; maxX: number; maxY: number },
): MotionReplicatorRenderState {
  return {
    enabled: false,
    cacheIdentity: 'motion-replicator:invalid',
    instanceData: new Float32Array(0),
    diagnostics,
    countX: 0,
    countY: 0,
    spacingX: 0,
    spacingY: 0,
    patternOffsetX: 0,
    patternOffsetY: 0,
    offsetOpacity: 1,
    instanceCount: 0,
    boundsCenterX: 0,
    boundsCenterY: 0,
    boundsWidth: sourceBounds.maxX - sourceBounds.minX,
    boundsHeight: sourceBounds.maxY - sourceBounds.minY,
  };
}

export function getMotionRenderSize(
  motion: MotionLayerDefinition | undefined,
  frameReplicator: MotionFrameReplicatorState | null | undefined = undefined,
  frameModifier: MotionFrameModifierState | null | undefined = undefined,
  frameExpressions: readonly MotionFrameExpressionValue[] | null | undefined = undefined,
): MotionRenderSize {
  const strokePadding = motion
    ? getVisibleStrokes(motion).reduce(
        (maximum, stroke) => Math.max(maximum, getStrokePadding(stroke)),
        0,
      )
    : 0;
  const replicator = getMotionReplicatorRenderState(
    motion,
    frameReplicator,
    frameModifier,
    frameExpressions,
  );
  const replicatedWidth = Math.ceil(replicator.boundsWidth);
  const replicatedHeight = Math.ceil(replicator.boundsHeight);

  return {
    width: Math.max(1, replicatedWidth),
    height: Math.max(1, replicatedHeight),
    strokePadding,
    replicator,
  };
}

/**
 * The Replicator texture is centered on its content bounds. Move the compositor
 * layer by that local-space center so asymmetric layouts keep their authored
 * contract-space placement instead of being visually re-centered.
 */
export function applyMotionRenderPlacement(
  layer: Layer,
  size: MotionRenderSize,
): Layer {
  const localX = size.replicator.boundsCenterX * layer.scale.x;
  const localY = size.replicator.boundsCenterY * layer.scale.y;
  if (localX === 0 && localY === 0) return layer;
  const rotationDegrees = typeof layer.rotation === 'number'
    ? layer.rotation
    : layer.rotation.z;
  const radians = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    ...layer,
    position: {
      ...layer.position,
      x: layer.position.x + localX * cos - localY * sin,
      y: layer.position.y + localX * sin + localY * cos,
    },
  };
}
