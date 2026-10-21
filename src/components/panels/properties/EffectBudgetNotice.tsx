import { useMediaStore } from '../../../stores/mediaStore';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';

const size = (value: unknown, fallback: number) => typeof value === 'number' && value > 0 ? value : fallback;

/** Says where a blur stops being exact at the active composition size (no silent clamps). */
export function EffectBudgetNotice({ effectType, params }: { effectType: string; params: Record<string, unknown> }) {
  const width = size(useMediaStore(state => state.getActiveComposition?.()?.width), 1920);
  const height = size(useMediaStore(state => state.getActiveComposition?.()?.height), 1080);
  const notes = blurBudgetNotes(effectType, params, width, height);
  if (!notes.length) return null;
  return <div className="effect-quality-warning" role="status">{notes.join(' ')}</div>;
}
