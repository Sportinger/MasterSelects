import type { AnimatableProperty, Keyframe, TransitionRenderState } from '../types';
import { interpolateKeyframes } from './keyframeInterpolation';

export const TRANSITION_RENDER_PROGRESS_PROPERTY = 'transitionRender.progress' as AnimatableProperty;

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function evaluateTransitionRenderState(
  base: TransitionRenderState | undefined,
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
): TransitionRenderState | undefined {
  if (!base) return undefined;
  const next = structuredClone(base);
  if (keyframes?.some((keyframe) => keyframe.property === TRANSITION_RENDER_PROGRESS_PROPERTY)) {
    next.progress = clamp01(interpolateKeyframes(
      [...keyframes],
      TRANSITION_RENDER_PROGRESS_PROPERTY,
      localTime,
      base.progress,
    ));
  }
  return next;
}
