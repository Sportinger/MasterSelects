import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { STICK_FIGURE_EFFECT_TYPE } from '../../../services/parameterSources/stickFigureParameterTargets';

type PlayheadDependencyClip = Pick<TimelineClip, 'effects' | 'nodeGraph' | 'planarTracks'>;

/**
 * Whether the Effects tab's shown values can change when only the playhead moves.
 *
 * Mirrors every time input of `getInterpolatedEffects` (keyframeEffectInterpolationActions.ts):
 * keyframes (and keyed rate travel), node-driven `effect.*` parameter sources, stick-figure actions,
 * face-cable render time and planar-tracked surfaces. Without any of them the interpolated effects
 * equal the stored ones at every time, so the tab need not re-render on playhead ticks.
 * When a new time input is added there, add it here too (tests/unit/effectsTabSubscriptions.test.tsx).
 */
export function effectsDependOnPlayhead(
  clip: PlayheadDependencyClip | undefined,
  keyframes: readonly Keyframe[] | undefined,
): boolean {
  if (!clip) return false;
  if (keyframes && keyframes.length > 0) return true;
  if (clip.planarTracks?.length) return true;
  const sourceTargets = clip.nodeGraph?.parameterSources?.targets;
  if (sourceTargets && Object.keys(sourceTargets).some(path => path.startsWith('effect.'))) return true;
  return (clip.effects ?? []).some(effect => effect.type === STICK_FIGURE_EFFECT_TYPE || effect.type === 'face-cables');
}
