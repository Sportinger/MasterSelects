import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../../../services/motionDesign/adjustment/supportedEffectContractAdapter';
import type { BlendMode, Effect } from '../../../types';

const SUPPORTED_ADJUSTMENT_BLEND_MODES = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
]);

export interface MotionAdjustmentDiagnostics {
  readonly compatible: boolean;
  readonly effectCount: number;
  readonly message: string;
}

export function getMotionAdjustmentDiagnostics(
  clipId: string,
  effects: readonly Effect[],
  blendMode: BlendMode,
): MotionAdjustmentDiagnostics {
  try {
    if (!SUPPORTED_ADJUSTMENT_BLEND_MODES.has(blendMode)) {
      throw new Error(`Unsupported adjustment blend mode: ${blendMode}`);
    }
    const admitted = adaptTimelineEffectsToMotionAdjustmentContracts({
      layerId: clipId,
      effects: effects.map((effect) => ({
        id: effect.id,
        name: effect.name,
        type: effect.type,
        enabled: effect.enabled,
        params: effect.params,
      })),
    });
    return {
      compatible: true,
      effectCount: admitted.length,
      message: admitted.length === 0
        ? 'Ready. Add a supported effect in the Effects tab.'
        : `${admitted.length} supported effect${admitted.length === 1 ? '' : 's'} ready on preview, nested comps, targets, and export.`,
    };
  } catch (error) {
    return {
      compatible: false,
      effectCount: effects.length,
      message: error instanceof Error
        ? error.message
        : 'This adjustment contains unsupported effect data.',
    };
  }
}
