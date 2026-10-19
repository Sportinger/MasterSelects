/**
 * Codec providers that decode slower than real time during playback report their
 * progress here. Their preview advances in steps, which the preview-freeze recovery
 * must not mistake for a wedged pipeline: its pause plus exact seek costs such a
 * decoder another whole GOP and makes the stall longer.
 */
let lastSlowProgressAt = Number.NEGATIVE_INFINITY;

export function noteSlowCodecPlaybackProgress(now = performance.now()): void {
  lastSlowProgressAt = now;
}

export function isSlowCodecPlaybackProgressing(now: number, windowMs: number): boolean {
  return now - lastSlowProgressAt <= windowMs;
}
