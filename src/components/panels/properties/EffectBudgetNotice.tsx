import { useMediaStore } from '../../../stores/mediaStore';
import { getEffect } from '../../../effects';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';

const size = (value: unknown, fallback: number) => typeof value === 'number' && value > 0 ? value : fallback;

/** The effect's own notes on values it clamps, ignores or cannot show (`paramWarnings`). */
function definitionNotes(effectType: string, params: Record<string, unknown>): string[] {
  const definition = getEffect(effectType);
  if (!definition || !('paramWarnings' in definition) || !definition.paramWarnings) return [];
  try { return definition.paramWarnings(params as Record<string, number | boolean | string>); } catch { return []; }
}

/**
 * Says where a blur stops being exact at the active composition size, and which values the
 * effect clamps or cannot show (keyframes and tools can set any value): no silent clamps.
 */
export function EffectBudgetNotice({ effectType, params }: { effectType: string; params: Record<string, unknown> }) {
  const width = size(useMediaStore(state => state.getActiveComposition?.()?.width), 1920);
  const height = size(useMediaStore(state => state.getActiveComposition?.()?.height), 1080);
  const notes = [...blurBudgetNotes(effectType, params, width, height), ...definitionNotes(effectType, params)];
  if (!notes.length) return null;
  return <div className="effect-quality-warning" role="status">{notes.join(' ')}</div>;
}
