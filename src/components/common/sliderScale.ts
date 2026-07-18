// Slider taper / scaling law (plan §14 follow-up).
//
// Human perception of frequency, loudness, and time is roughly logarithmic, so a
// LINEAR fader on those feels wrong (cramped at the bottom, coarse at the top).
// This maps between a slider's normalized POSITION [0,1] and the parameter VALUE
// so a control can travel perceptually. The native <input type="range"> stays
// linear in position; SynthSlider runs it on position and converts here — and the
// motorized-fader ghost uses the SAME map, so fader and ghost always agree.
//
// - 'log'   : geometric — equal travel per doubling (frequency, rate, Q). Needs
//             min > 0 and max > 0; falls back to linear otherwise.
// - 'power' : value = min + (max-min)·pos^γ — reaches min (e.g. 0) cleanly with
//             fine resolution near the bottom (gain, envelope times, filter depth).
// - 'linear': unchanged.

export type SliderScale = 'linear' | 'log' | 'power';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Parameter value → normalized slider position [0,1]. */
export function valueToPosition(
  value: number,
  min: number,
  max: number,
  scale: SliderScale = 'linear',
  gamma = 2,
): number {
  if (!Number.isFinite(value) || max === min) return 0;
  if (scale === 'log' && min > 0 && max > 0) {
    const v = Math.max(min, Math.min(max, value));
    return clamp01(Math.log(v / min) / Math.log(max / min));
  }
  const t = clamp01((value - min) / (max - min));
  if (scale === 'power') return Math.pow(t, 1 / gamma);
  return t;
}

/** Normalized slider position [0,1] → parameter value. */
export function positionToValue(
  position: number,
  min: number,
  max: number,
  scale: SliderScale = 'linear',
  gamma = 2,
): number {
  const p = clamp01(position);
  if (scale === 'log' && min > 0 && max > 0) {
    return min * Math.pow(max / min, p);
  }
  if (scale === 'power') return min + (max - min) * Math.pow(p, gamma);
  return min + p * (max - min);
}
