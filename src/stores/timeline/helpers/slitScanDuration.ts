import type { TimelineClip } from '../../../types/timeline';
import { slitScanNumber } from '../../../effects/time/slit-scan/parameters';

/** Persist the applied ratio so edits, bypass, removal and undo preserve source span. */
export function reconcileSlitScanDuration(previous: TimelineClip, next: TimelineClip): TimelineClip {
  let previousFactor = 1, nextFactor = 1;
  for (const effect of previous.effects) {
    if (effect.type === 'slit-scan') previousFactor *= appliedFactor(effect.params.bypassDurationFactor);
  }
  const effects = next.effects.map(effect => {
    if (effect.type !== 'slit-scan') return effect;
    const factor = effect.enabled && effect.params.bypassSlowdown === true ? slitScanNumber(effect.params, 'timeFactor') : 1;
    nextFactor *= factor;
    if (factor === appliedFactor(effect.params.bypassDurationFactor)) return effect;
    return { ...effect, params: { ...effect.params, bypassDurationFactor: factor } };
  });
  if (previousFactor === nextFactor && effects.every((effect, i) => effect === next.effects[i])) return next;
  return { ...next, effects, duration: next.duration * previousFactor / nextFactor };
}

function appliedFactor(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : 1;
}
