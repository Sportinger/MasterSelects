import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { getEffect } from '../../../effects';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { effectExperimentalNote } from '../../../effects/types';
import { definitionNotes, previewSizeNotes } from './effectCardNotes';

const size = (value: unknown, fallback: number) => typeof value === 'number' && value > 0 ? value : fallback;

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
  const previewQuality = useSettingsStore(state => state.previewQuality);
  const experimental = effectExperimentalNote(getEffect(effectType));
  const exported = definitionNotes(effectType, params, operatorGraph, width, height);
  const notes = [...(experimental ? [`Experimental: ${experimental}`] : []), ...blurBudgetNotes(effectType, params, width, height),
    ...exported, ...previewSizeNotes(effectType, params, operatorGraph, width, height, previewQuality, exported)];
  if (!notes.length) return null;
  return <div className="effect-quality-warning" role="status">{notes.join(' ')}</div>;
}
