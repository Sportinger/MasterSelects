import { motionTurnDistance } from './motionTurn';

/** Integral of a smooth speed envelope, independent of render history and seek order.
 * An optional turn changes the direction of seconds, while motionPhase stays forward.
 */
export function motionTime(time: number, duration: number, attack: number, release: number, stopPower = 1,
  turnStart = -1, turnDuration = 1): number {
  if (![time, duration, attack, release].every(Number.isFinite)) throw new Error('Motion Time requires finite seconds.');
  if (duration <= 0 || attack < 0 || release < 0 || attack + release > duration)
    throw new Error('Motion Time needs a positive duration and non-overlapping acceleration/deceleration intervals.');
  if (!Number.isInteger(stopPower) || stopPower < 1 || stopPower > 4)
    throw new Error('Motion Time Final Stillness must be an integer from 1 to 4.');
  if (!Number.isFinite(turnStart) || turnStart < -1 || (turnStart < 0 && turnStart !== -1))
    throw new Error('Motion Time Turn Start must be -1 (disabled) or non-negative seconds.');
  if (turnStart >= 0 && (!Number.isFinite(turnDuration) || turnDuration <= 0 || turnStart + turnDuration > duration))
    throw new Error('Motion Time Direction Turn needs a positive duration and must finish within Duration.');
  const t = Math.max(0, Math.min(duration, time));
  if (turnStart >= 0 && t > turnStart) {
    const end = Math.min(t, turnStart + turnDuration);
    const at = (seconds: number) => motionTime(seconds, duration, attack, release, stopPower);
    // After the turn the signed speed is exactly the negative original envelope.
    return at(end) - 2 * motionTurnDistance(turnStart, end, turnStart, turnDuration,
      duration, attack, release, stopPower) - (at(t) - at(end));
  }
  // Integral of smoothstep(u): u³ - u⁴/2. Speed and acceleration join continuously.
  const integral = (u: number) => u * u * u * (1 - u / 2);
  if (attack > 0 && t < attack) return attack * integral(t / attack);
  const cruiseEnd = duration - release;
  if (release > 0 && t > cruiseEnd) {
    const elapsed = t - cruiseEnd;
    if (stopPower === 1) return cruiseEnd - attack / 2 + elapsed - release * integral(elapsed / release);
    // Integrate the remaining distance, not a polynomial near u=1. This avoids
    // cancellation causing a tiny reversal just before rest at higher powers.
    return cruiseEnd - attack / 2 + release * (remaining(1, stopPower) - remaining(1 - elapsed / release, stopPower));
  }
  return t - attack / 2;
}

/** One monotone turn over the complete eased interval, for cyclic motion that must close at the end. */
export function motionPhase(time: number, duration: number, attack: number, release: number, stopPower = 1): number {
  return motionTime(time, duration, attack, release, stopPower) / motionTime(duration, duration, attack, release, stopPower);
}

/** Integral from 0 to v of smoothstep(v)^power, using its exact binomial polynomial. */
function remaining(v: number, power: number): number {
  let sum = 0, choose = 1;
  for (let k = 0; k <= power; k++) {
    sum += choose * 3 ** (power - k) * (-2) ** k * v ** (2 * power + k + 1) / (2 * power + k + 1);
    choose *= (power - k) / (k + 1);
  }
  return sum;
}
