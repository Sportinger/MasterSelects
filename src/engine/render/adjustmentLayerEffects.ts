import type { Effect } from '../../types/effects';
import { Logger } from '../../services/logger';
import { classifyAdjustmentEffect } from '../../services/motionDesign/adjustment/adjustmentEffectClassification';

const log = Logger.create('Compositor');
const reported = new Set<string>();

/**
 * Compositor-side guard for adjustment layers that reach the GPU without the layer builder's
 * admission (collectors, tests, older callers): enabled effects that cannot run on an adjustment
 * layer are left out one by one with a warning, never the whole layer. Returns `effects` itself
 * when nothing is bypassed.
 */
export function bypassUnavailableAdjustmentEffects(layerId: string, effects: Effect[]): Effect[] {
  const bypassed = effects.filter(effect => effect.enabled !== false && effect.type !== 'blur'
    && !classifyAdjustmentEffect(effect.type).admitted);
  if (bypassed.length === 0) return effects;
  for (const effect of bypassed) {
    const key = `${layerId}|${effect.id}`;
    if (reported.has(key)) continue;
    if (reported.size > 512) reported.clear();
    reported.add(key);
    log.warn('Bypassing adjustment effect that cannot run on an adjustment layer', {
      layerId, effectId: effect.id, effectType: effect.type, reason: classifyAdjustmentEffect(effect.type).reason,
    });
  }
  return effects.filter(effect => !bypassed.includes(effect));
}
