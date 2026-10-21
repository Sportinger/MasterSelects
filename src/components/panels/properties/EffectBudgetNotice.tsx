import { useMediaStore } from '../../../stores/mediaStore';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';
import { effectDefinitionNotes } from '../../../services/operators/effectParamVisibility';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';

const size = (value: unknown, fallback: number) => typeof value === 'number' && value > 0 ? value : fallback;

/**
 * Says where a blur stops being exact at the size of the composition being edited, which owns the
 * clip and sets the export size, and which values the effect clamps or cannot show (keyframes and
 * tools can set any value): no silent clamps. The renderer logs other rendered sizes. `params` are
 * the values at the playhead (EffectsTab passes the keyframe-evaluated parameters). An instance
 * that runs an earlier saved recipe gets no notes of the current one (its card says so instead).
 */
export function EffectBudgetNotice({ effectType, params, operatorGraph }: { effectType: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }) {
  const width = size(useMediaStore(state => state.getActiveComposition?.()?.width), 1920);
  const height = size(useMediaStore(state => state.getActiveComposition?.()?.height), 1080);
  const notes = [...blurBudgetNotes(effectType, params, width, height),
    ...effectDefinitionNotes({ type: effectType, params, operatorGraph }, width, height)];
  if (!notes.length) return null;
  return <div className="effect-quality-warning" role="status">{notes.join(' ')}</div>;
}
