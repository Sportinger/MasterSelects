// "Fit to a length": the constant speed that makes a clip last `targetSeconds` on the timeline.
// A clip at speed s that lasts d seconds shows d * s seconds of source; the new speed is that source
// span divided by the wanted length, kept inside the editor's speed range (and said so when clamped).

export interface PhoneFitSpeed {
  speed: number;
  /** The length the clip really gets (differs from the wish when the speed was clamped). */
  length: number;
  clamped: boolean;
}

export function phoneFitSpeed(currentLength: number, currentSpeed: number, targetSeconds: number, min: number, max: number): PhoneFitSpeed | null {
  const span = currentLength * Math.abs(currentSpeed);
  if (!(span > 0) || !(targetSeconds > 0) || !Number.isFinite(targetSeconds)) return null;
  const wanted = span / targetSeconds;
  const speed = Math.min(max, Math.max(min, wanted));
  return { speed, length: span / speed, clamped: Math.abs(speed - wanted) > 1e-9 };
}
