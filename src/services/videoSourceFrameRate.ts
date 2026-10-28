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

/**
 * How far before its nominal start (k/fps) a presented frame's timestamp may lie and still be frame k:
 * phone recorders stamp capture times, so Android MediaMuxer footage at 30 fps carries frames up to
 * 4 ms (0.12 frame) off k/30. A quarter frame matches the jitter the WebCodecs path accepts for a
 * presentation grid (derivePresentationGrid, d/4).
 */
export const PRESENTED_FRAME_EARLY_TOLERANCE_FRAMES = 0.25;

/**
 * The time a presented frame (a requestVideoFrameCallback mediaTime, i.e. the frame's own PTS) stands
 * for on the source's nominal frame grid: a PTS just before k/fps is frame k, so it is labelled k/fps.
 * Every consumer maps labels to frames with floor(t * fps) (scrub cache slots, the paused held-frame
 * guard); a raw early PTS put frame k into slot k - 1 and passed it off as the previous frame's picture
 * (Pixel 10 Pro, jittered phone recording: frame 246 at 8.1974 s filled slot 245, and timeline frame 245
 * showed frame 246 until the next play). A PTS on or after its grid point, a seek position (never pass
 * one here) and a source without a known rate stay as they are.
 */
export function nominalPresentedFrameTime(target: object | null | undefined, pts: number): number {
  const fps = getVideoSourceFrameRate(target);
  if (!fps || !Number.isFinite(pts)) return pts;
  const position = pts * fps;
  const next = Math.ceil(position - 1e-9);
  const lead = next - position;
  return lead > 1e-9 && lead <= PRESENTED_FRAME_EARLY_TOLERANCE_FRAMES ? next / fps : pts;
}
