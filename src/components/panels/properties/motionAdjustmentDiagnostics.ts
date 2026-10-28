import {
  admitAdjustmentEffectsForRender,
  type BypassedAdjustmentEffect,
} from '../../../services/motionDesign/adjustment/adjustmentEffectRenderAdmission';
import { isWorkerGpuAdjustmentEffectType } from '../../../services/motionDesign/adjustment/supportedEffects';
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
  /** The layer renders (layer-level state is valid); bypassed effects do not block it. */
  readonly compatible: boolean;
  readonly effectCount: number;
  readonly message: string;
  /** Effects left out of the render, each with its reason; omitted when there are none. */
  readonly bypassed?: readonly BypassedAdjustmentEffect[];
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
    const admission = admitAdjustmentEffectsForRender(clipId, effects);
    const rendered = admission.effects.filter((effect) => effect.enabled !== false);
    // The opt-in worker GPU modes still draw these with the original color matrices; only say so there.
    const diverging = options.workerRenderMode
      ? [...new Set(workerGpuAdjustmentColorDivergences(effects).map(item => item.effectType))] : [];
    const workerOnly = options.workerRenderMode
      ? [...new Set(rendered.filter((effect) => !isWorkerGpuAdjustmentEffectType(effect.type)).map((effect) => effect.type))] : [];
    const workerNote = (diverging.length
      ? ` Worker GPU render modes still draw ${diverging.join(', ')} with the original linear math.` : '')
      + (workerOnly.length
        ? ` Worker GPU render modes cannot draw ${workerOnly.join(', ')}: export frames go to the main compositor and worker-only preview frames fail with that reason.` : '');
    const bypassNote = admission.bypassed.length
      ? ` Bypassed: ${admission.bypassed.map((item) => item.reason).join(' ')}` : '';
    return {
      compatible: true,
      effectCount: rendered.length,
      message: (rendered.length === 0
        ? admission.bypassed.length ? 'No effect renders on this adjustment layer.' : 'Ready. Add an effect in the Effects tab.'
        : `${rendered.length} supported effect${rendered.length === 1 ? '' : 's'} ready on preview, nested comps, targets, and export.`)
        + bypassNote + workerNote,
      ...(admission.bypassed.length ? { bypassed: admission.bypassed } : {}),
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
