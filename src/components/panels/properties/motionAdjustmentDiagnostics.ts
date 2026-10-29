import {
  admitAdjustmentEffectsForRender,
  type BypassedAdjustmentEffect,
} from '../../../services/motionDesign/adjustment/adjustmentEffectRenderAdmission';
import {
  adjustmentLayerDefinitionProblem,
  inspectAdjustmentLayerProperties,
  skippedAdjustmentLayerProperties,
  type SkippedAdjustmentLayerProperty,
} from '../../../services/motionDesign/adjustment/adjustmentLayerRenderAdmission';
import { isWorkerGpuAdjustmentEffectType } from '../../../services/motionDesign/adjustment/supportedEffects';
import { workerGpuAdjustmentColorDivergences } from '../../../services/render/workerGpuAdjustmentColorParity';
import type { BlendMode, Effect, TimelineClip } from '../../../types';

export interface MotionAdjustmentDiagnostics {
  /** The layer renders (layer-level state is valid); bypassed effects do not block it. */
  readonly compatible: boolean;
  readonly effectCount: number;
  readonly message: string;
  /** Effects left out of the render, each with its reason; omitted when there are none. */
  readonly bypassed?: readonly BypassedAdjustmentEffect[];
  /** Layer properties left out of the render (transform, 3D, transition, ...); omitted when there are none. */
  readonly skipped?: readonly SkippedAdjustmentLayerProperty[];
}

export interface MotionAdjustmentDiagnosticsOptions {
  /** A worker render host mode is selected (opt-in dev modes that draw adjustments with color matrices). */
  readonly workerRenderMode?: boolean;
  /** The adjustment clip itself: its definition and layer properties are checked too. */
  readonly clip?: Pick<TimelineClip, 'source' | 'motion' | 'transform' | 'is3D' | 'sourceRect' | 'transitionRender' | 'nodeGraph' | 'sceneGraphOutput'>;
}

export function getMotionAdjustmentDiagnostics(
  clipId: string,
  effects: readonly Effect[],
  blendMode: BlendMode,
  options: MotionAdjustmentDiagnosticsOptions = {},
): MotionAdjustmentDiagnostics {
  try {
    const problem = options.clip ? adjustmentLayerDefinitionProblem(options.clip) : null;
    if (problem) throw new Error(problem);
    const skipped = options.clip
      ? inspectAdjustmentLayerProperties({ ...options.clip, transform: { ...options.clip.transform, blendMode } })
      : skippedAdjustmentLayerProperties({}, { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, blendMode });
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
    const skipNote = skipped.length
      ? ` Skipped, the rest renders: ${skipped.map((item) => item.reason).join(' ')}` : '';
    return {
      compatible: true,
      effectCount: rendered.length,
      message: (rendered.length === 0
        ? admission.bypassed.length ? 'No effect renders on this adjustment layer.' : 'Ready. Add an effect in the Effects tab.'
        : `${rendered.length} supported effect${rendered.length === 1 ? '' : 's'} ready on preview, nested comps, targets, and export.`)
        + bypassNote + skipNote + workerNote,
      ...(admission.bypassed.length ? { bypassed: admission.bypassed } : {}),
      ...(skipped.length ? { skipped } : {}),
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
