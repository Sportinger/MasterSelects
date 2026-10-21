import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../../../services/motionDesign/adjustment/supportedEffectContractAdapter';
import { workerGpuAdjustmentColorDivergences } from '../../../services/render/workerGpuAdjustmentColorParity';
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

export interface MotionAdjustmentDiagnosticsOptions {
  /** A worker render host mode is selected (opt-in dev modes that draw adjustments with color matrices). */
  readonly workerRenderMode?: boolean;
}

export function getMotionAdjustmentDiagnostics(
  clipId: string,
  effects: readonly Effect[],
  blendMode: BlendMode,
  options: MotionAdjustmentDiagnosticsOptions = {},
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
    // The opt-in worker GPU modes still draw these with the original color matrices; only say so there.
    const diverging = options.workerRenderMode
      ? [...new Set(workerGpuAdjustmentColorDivergences(effects).map(item => item.effectType))] : [];
    const workerNote = diverging.length
      ? ` Worker GPU render modes still draw ${diverging.join(', ')} with the original linear math.` : '';
    return {
      compatible: true,
      effectCount: admitted.length,
      message: admitted.length === 0
        ? 'Ready. Add a supported effect in the Effects tab.'
        : `${admitted.length} supported effect${admitted.length === 1 ? '' : 's'} ready on preview, nested comps, targets, and export.${workerNote}`,
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
