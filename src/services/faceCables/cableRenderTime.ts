import type { Effect } from '../../types/effects';

/** Baked geometry uses clip-local time in every renderer, without a live tracking runtime. */
export function bindCableRenderTime(effects: Effect[], localTime: number, stabilizationEnabled?: boolean): Effect[] {
  if (!effects.some(effect => effect.type === 'face-cables')) return effects;
  return effects.map(effect => effect.type === 'face-cables'
    ? { ...effect, params: { ...effect.params, cableTime: localTime, cableStabilizationBypassed: stabilizationEnabled === false } }
    : effect);
}
