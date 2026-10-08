/** Integral of a smooth speed envelope, independent of render history and seek order. */
export function motionTime(time: number, duration: number, attack: number, release: number): number {
  if (![time, duration, attack, release].every(Number.isFinite)) throw new Error('Motion Time requires finite seconds.');
  if (duration <= 0 || attack < 0 || release < 0 || attack + release > duration)
    throw new Error('Motion Time needs a positive duration and non-overlapping acceleration/deceleration intervals.');
  const t = Math.max(0, Math.min(duration, time));
  // Integral of smoothstep(u): u³ - u⁴/2. Speed and acceleration join continuously.
  const integral = (u: number) => u * u * u * (1 - u / 2);
  if (attack > 0 && t < attack) return attack * integral(t / attack);
  const cruiseEnd = duration - release;
  if (release > 0 && t > cruiseEnd) {
    const elapsed = t - cruiseEnd;
    return cruiseEnd - attack / 2 + elapsed - release * integral(elapsed / release);
  }
  return t - attack / 2;
}

/** One monotone turn over the complete eased interval, for cyclic motion that must close at the end. */
export function motionPhase(time: number, duration: number, attack: number, release: number): number {
  return motionTime(time, duration, attack, release) / motionTime(duration, duration, attack, release);
}
