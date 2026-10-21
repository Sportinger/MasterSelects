import { useState } from 'react';
import type { EffectControlProps } from '../types';
import { useTimelineStore } from '../../stores/timeline';
import { editEffectGraph } from '../../services/operators/effectGraphEditing';
import { createStylizeRecipeGraph, isEarlierStylizeGraph, STYLIZE_RECIPE_UPDATES } from '../../services/operators/stylizeRecipes';
import { glowQualityNote, resolveGlowSampling } from './glow/glowSampling';

/**
 * Inspector note for a stylize effect saved with its earlier recipe (see stylizeRecipes.ts): it
 * keeps that look until the user asks for the current recipe with the button. A Glow saved with
 * the ring version also reports its quality limits (never silent). Values the current recipes
 * limit are reported by the effect's `paramWarnings` (EffectBudgetNotice). Renders nothing for a
 * current recipe.
 */
export default function StylizeRecipeNote({ clipId, effectInstanceId, effectId, params }: EffectControlProps) {
  const graph = useTimelineStore(store => store.clips.find(clip => clip.id === clipId)?.effects
    .find(effect => effect.id === effectInstanceId)?.operatorGraph);
  const [error, setError] = useState<string | null>(null);
  const update = STYLIZE_RECIPE_UPDATES[effectId as keyof typeof STYLIZE_RECIPE_UPDATES];
  const earlier = !!update && !!clipId && !!effectInstanceId && isEarlierStylizeGraph(effectId, graph);
  const ringNote = earlier && effectId === 'glow' ? glowQualityNote(resolveGlowSampling(params)) : undefined;
  if (!earlier && !error) return null;
  const apply = () => {
    const next = createStylizeRecipeGraph(effectId);
    if (!update || !next || !clipId || !effectInstanceId) return;
    try {
      editEffectGraph(clipId, effectInstanceId, update.label, (target, values) => {
        for (const key of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[key];
        Object.assign(target, next);
        Object.assign(values, update.resetParams ?? {});
      });
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return (
    <div className="effect-recipe-note">
      {earlier && update && (
        <p className="effect-info" role="status">
          {update.message}{' '}
          <button type="button" className="btn btn-sm" onClick={apply}>{update.label}</button>
        </p>
      )}
      {ringNote && <p className="effect-info" role="status" aria-live="polite">{ringNote}</p>}
      {error && <p className="effect-info" role="alert">{error}</p>}
    </div>
  );
}
