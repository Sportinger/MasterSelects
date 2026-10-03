export const SCRUB_CACHE_FPS = 30;
/** Slots absorb the 3-decimal key strings and float noise (0.67 ms), never a real frame step. */
const SLOT_EPSILON = 0.02;

/** A frame holds until the next one: media time maps to the last slot starting at or before it
 * (rounding would show the next frame from half a slot on, e.g. 0.75 s -> 0.767). */
export function frameIndexForTime(time: number): number {
  return Math.floor(time * SCRUB_CACHE_FPS + SLOT_EPSILON);
}

export function quantizeToFrame(time: number): string {
  return (frameIndexForTime(time) / SCRUB_CACHE_FPS).toFixed(3);
}

export function getScrubbingKey(videoSrc: string, time: number): string {
  return `${videoSrc}:${quantizeToFrame(time)}`;
}

export function getScrubbingKeyForFrame(videoSrc: string, frameIndex: number): string {
  return getScrubbingKey(videoSrc, frameIndex / SCRUB_CACHE_FPS);
}

export function getScrubbingKeyTime(key: string): number {
  const index = key.lastIndexOf(':');
  if (index === -1) {
    return 0;
  }
  const parsed = Number(key.slice(index + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function quantizeTime(time: number): number {
  return Math.round(time * SCRUB_CACHE_FPS) / SCRUB_CACHE_FPS;
}
