// Runtime metadata only: the nominal source frame rate of a media element or
// frame provider, remembered by the video sync while it positions the element.
// The render collectors read it to judge whether a held paused frame is the
// target's own frame. Composition fps is not a substitute for source fps.
const sourceFrameRates = new WeakMap<object, number>();

export function setVideoSourceFrameRate(target: object, fps: number | null | undefined): void {
  if (fps && Number.isFinite(fps) && fps > 0) sourceFrameRates.set(target, fps);
  else sourceFrameRates.delete(target);
}

export function getVideoSourceFrameRate(target: object | null | undefined): number | undefined {
  return target ? sourceFrameRates.get(target) : undefined;
}
