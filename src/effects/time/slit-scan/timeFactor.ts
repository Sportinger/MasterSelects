import { slitScanNumber } from './parameters';
import type { TimelineClip } from '../../../types/timeline';
import type { Keyframe, AnimatableProperty } from '../../../types';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';

/** One clock for ordinary video playback/export and the effect's history. */
export function slitScanPlaybackFactor(clip: Pick<TimelineClip, 'effects'>, keyframes: readonly Keyframe[] = [], time = 0): number {
  return (clip.effects ?? []).reduce((factor, effect) => {
    if (effect.type !== 'slit-scan' || !effect.enabled || effect.params.bypassSlowdown !== true) return factor;
    const property = `effect.${effect.id}.timeFactor` as AnimatableProperty;
    const value = interpolateKeyframes([...keyframes], property, time, slitScanNumber(effect.params, 'timeFactor'));
    return factor * slitScanNumber({ timeFactor: value }, 'timeFactor');
  }, 1);
}

export function slitScanDurationFactor(clip: Pick<TimelineClip, 'effects'>): number {
  return (clip.effects ?? []).reduce((factor, effect) => effect.type === 'slit-scan'
    ? factor * Math.max(1, Math.min(100, Number(effect.params.bypassDurationFactor) || 1)) : factor, 1);
}

/** Time factor at which every temporal sample addresses its own source frame:
 * the window spans delay × factor source seconds, and the grid has samples − 2
 * steps. Capped to the Time factor range; `frames` reports what that yields. */
export function slitScanFullResolutionFactor(fps: number | undefined, delay: number, samples: number) {
  if (!fps || !Number.isFinite(fps) || fps <= 0 || !(delay > 0)) return undefined;
  const steps = Math.max(1, Math.round(samples) - 2);
  const exact = steps / (fps * delay);
  const factor = Math.max(1, Math.min(100, Math.ceil(exact * 10 - 1e-9) / 10));
  return { factor, frames: Math.round(fps * delay * factor), steps, capped: exact > 100 };
}
