// Time × Rate in a geometry graph (the Weave In progress, a pulse): with keyframes on a rate that
// integrates (EffectParam.integratedAs), the program reads the distance the rate has travelled
// instead of rate × time, so a Speed ramp moves smoothly instead of jumping. Image graphs and the
// 2D packers do the same through the keyframe evaluation's travel parameters.
import { effectRateTravelParams } from '../../../effects';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { ParameterSourceBinding } from '../../../types/parameterSources';
import { integrateKeyframedRateBetween } from '../../../utils/speedIntegration';
import { bindingOverridesKeyframes, reportKeyedRateOverride } from '../../parameterSources/parameterSourceRendering';

/** The clock a Time node reads: the clip clock (Clip Time, source time) or the timeline clock (Time). */
export type GeometryRateClock = 'clip' | 'timeline';

/** Distance a keyframed rate parameter has travelled on a clock, or undefined to keep rate × time. */
export type GeometryRateTravel = (rateKey: string, clock: GeometryRateClock) => number | undefined;

export interface GeometryRateClocks {
  /** The clip clock (geometry.clip-time) at a clip-local time; linear in it (clip speed, reversal, trim). */
  clipClockAt: (clipTime: number) => number;
  /** Where the clip starts on the timeline clock (image.timeline-time). */
  timelineStart: number;
}

/**
 * Travel for the integrating rates of `effect` at clip-local `clipTime` (the keyframe clock). Before
 * the first key the rate holds that key's value, so a rate keyed at a constant value travels exactly
 * rate × clock and adding the first key moves nothing. Unkeyed rates return undefined: the program
 * keeps rate × time, which is the same distance. A rate a parameter source drives (`bindings`, the
 * clip's parameterSources.targets) also keeps rate × time, and says so once in the log.
 */
export function geometryRateTravel(effect: Pick<Effect, 'id' | 'type'> & { name?: string }, keyframes: readonly Keyframe[], clipTime: number,
  clocks: GeometryRateClocks, bindings?: Readonly<Record<string, ParameterSourceBinding>>): GeometryRateTravel | undefined {
  const rates = new Set(effectRateTravelParams(effect.type).map(([rate]) => rate));
  if (!rates.size || !keyframes.length) return undefined;
  const keys = keyframes as Keyframe[];
  return (rateKey, clock) => {
    const property = `effect.${effect.id}.${rateKey}` as AnimatableProperty;
    if (!rates.has(rateKey) || !keys.some(key => key.property === property)) return undefined;
    // A node or the Constant mode drives the rate (applyParameterSourcesToEffects): rate × time, as in image graphs.
    const binding = bindings?.[property];
    if (bindingOverridesKeyframes(binding)) {
      reportKeyedRateOverride({ ...effect, name: effect.name ?? effect.type }, rateKey, binding!);
      return undefined;
    }
    if (clock === 'timeline') return integrateKeyframedRateBetween(keys, property, -clocks.timelineStart, clipTime, 0);
    // The clip clock runs `slope` clock seconds per clip second from `start` at the clip start.
    const start = clocks.clipClockAt(0), slope = clocks.clipClockAt(1) - start;
    if (!Number.isFinite(start) || !Number.isFinite(slope) || slope === 0) return undefined;
    return slope * integrateKeyframedRateBetween(keys, property, -start / slope, clipTime, 0);
  };
}
