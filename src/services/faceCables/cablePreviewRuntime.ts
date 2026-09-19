import type { Effect } from '../../types/effects';

interface Preview { time: number; bakedData: string; frameRate?: number }
const previews = new Map<string, Preview>();
const key = (clipId: string, effectId: string) => JSON.stringify([clipId, effectId]);

export function setCablePreview(clipId: string, effectId: string, preview: Preview | null) {
  const id = key(clipId, effectId);
  if (!preview) return previews.delete(id);
  if (previews.get(id) === preview) return false;
  previews.set(id, preview);
  return true;
}

/** Ephemeral render input only; never written into a project or used during export. */
export function applyCablePreviews(clipId: string, time: number, effects: Effect[], allowed: boolean): Effect[] {
  if (!allowed) return effects;
  return effects.map(effect => {
    const preview = previews.get(key(clipId, effect.id));
    if (effect.type !== 'face-cables' || !preview || Math.abs(time - preview.time) > 1 / (preview.frameRate ?? 30) + 1e-6) return effect;
    return { ...effect, params: { ...effect.params, bakedData: preview.bakedData, cableTime: 0 } };
  });
}

if (import.meta.hot) import.meta.hot.dispose(() => previews.clear());
