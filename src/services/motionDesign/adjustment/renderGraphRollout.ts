import { assertMotionAdjustmentJsonData } from './contractLimits';
import type { MotionAdjustmentRenderSurface } from './supportedEffects';

export const MOTION_ADJUSTMENT_RENDER_GRAPH_ROLLOUT_VERSION =
  'motion-adjustment-render-graph-rollout/v1' as const;

export type MotionAdjustmentRenderGraphIntegrationState =
  | 'legacy-only'
  | 'dual-path-unverified'
  | 'dual-path-verified';

export type MotionAdjustmentRenderGraphDecisionReason =
  | 'FLAG_DISABLED'
  | 'SURFACE_NOT_INTEGRATED'
  | 'PARITY_NOT_VERIFIED'
  | 'RENDER_GRAPH_ENABLED';

export interface MotionAdjustmentRenderGraphRolloutInput {
  readonly useRenderGraphFlag: boolean;
  readonly surface: MotionAdjustmentRenderSurface;
  readonly integrationState: MotionAdjustmentRenderGraphIntegrationState;
}

export interface MotionAdjustmentRenderGraphRolloutDecision {
  readonly contractVersion: typeof MOTION_ADJUSTMENT_RENDER_GRAPH_ROLLOUT_VERSION;
  readonly surface: MotionAdjustmentRenderSurface;
  readonly useRenderGraph: boolean;
  readonly reason: MotionAdjustmentRenderGraphDecisionReason;
}

/**
 * Leaf-only decision for Main to consume. This module deliberately owns no
 * global flag or renderer state and fails closed until parity is verified.
 */
export function decideMotionAdjustmentRenderGraphRollout(
  input: MotionAdjustmentRenderGraphRolloutInput,
): MotionAdjustmentRenderGraphRolloutDecision {
  assertMotionAdjustmentJsonData(input);
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, [
      'useRenderGraphFlag',
      'surface',
      'integrationState',
    ])
    || typeof input.useRenderGraphFlag !== 'boolean'
    || !isSurface(input.surface)
    || !isIntegrationState(input.integrationState)
  ) {
    throw new Error('Invalid motion adjustment render graph rollout input');
  }

  if (!input.useRenderGraphFlag) {
    return decision(input.surface, false, 'FLAG_DISABLED');
  }
  if (input.integrationState === 'legacy-only') {
    return decision(input.surface, false, 'SURFACE_NOT_INTEGRATED');
  }
  if (input.integrationState === 'dual-path-unverified') {
    return decision(input.surface, false, 'PARITY_NOT_VERIFIED');
  }
  return decision(input.surface, true, 'RENDER_GRAPH_ENABLED');
}

function decision(
  surface: MotionAdjustmentRenderSurface,
  useRenderGraph: boolean,
  reason: MotionAdjustmentRenderGraphDecisionReason,
): MotionAdjustmentRenderGraphRolloutDecision {
  return {
    contractVersion: MOTION_ADJUSTMENT_RENDER_GRAPH_ROLLOUT_VERSION,
    surface,
    useRenderGraph,
    reason,
  };
}

function isSurface(value: unknown): value is MotionAdjustmentRenderSurface {
  return value === 'preview'
    || value === 'nested-preview'
    || value === 'target-preview'
    || value === 'export';
}

function isIntegrationState(
  value: unknown,
): value is MotionAdjustmentRenderGraphIntegrationState {
  return value === 'legacy-only'
    || value === 'dual-path-unverified'
    || value === 'dual-path-verified';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}
