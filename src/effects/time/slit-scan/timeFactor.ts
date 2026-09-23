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
