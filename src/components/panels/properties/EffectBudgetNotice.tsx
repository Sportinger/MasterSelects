import { useMediaStore } from '../../../stores/mediaStore';
import { getEffect } from '../../../effects';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';
import { effectDefinitionNotes } from '../../../services/operators/effectParamVisibility';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { effectExperimentalNote } from '../../../effects/types';

const size = (value: unknown, fallback: number) => typeof value === 'number' && value > 0 ? value : fallback;

/**
 * The effect's own notes on values it clamps, ignores or cannot show (`paramWarnings`, judged on
 * the instance's recipe: an earlier saved stylize recipe gets none). Tool results name parameters
 * by id ("levels: 1 is …"); the inspector names them by their label.
 */
function definitionNotes(effectType: string, params: Record<string, unknown>, operatorGraph: EffectOperatorGraph | undefined,
  width: number, height: number): string[] {
  const definition = getEffect(effectType);
  if (!definition) return [];
  const labelled = (note: string) => note.replace(/^([A-Za-z][\w-]*): /, (prefix, id: string) => {
    const label = Object.hasOwn(definition.params, id) ? definition.params[id].label : undefined;
    return label ? `${label}: ` : prefix;
  });
  return effectDefinitionNotes({ type: effectType, params, operatorGraph }, width, height).map(labelled);
}

/**
 * Says where a blur stops being exact at the size of the composition being edited, which owns the
 * clip and sets the export size, and which values the effect clamps or cannot show (keyframes and
 * tools can set any value): no silent clamps. The renderer logs other rendered sizes. `params` are
 * the values at the playhead (EffectsTab passes the keyframe-evaluated parameters). An instance
 * that runs an earlier saved recipe gets no notes of the current one (its card says so instead);
 * an experimental effect names its known artefacts first.
 */
export function EffectBudgetNotice({ effectType, params, operatorGraph }: { effectType: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }) {
  const width = size(useMediaStore(state => state.getActiveComposition?.()?.width), 1920);
  const height = size(useMediaStore(state => state.getActiveComposition?.()?.height), 1080);
  const experimental = effectExperimentalNote(getEffect(effectType));
  const notes = [...(experimental ? [`Experimental: ${experimental}`] : []), ...blurBudgetNotes(effectType, params, width, height),
    ...definitionNotes(effectType, params, operatorGraph, width, height)];
  if (!notes.length) return null;
  return <div className="effect-quality-warning" role="status">{notes.join(' ')}</div>;
}
