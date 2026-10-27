// Marker colours offered on the phone and the time label of a marker row.

/** The editor's default marker colour first, then the label palette's strong colours. */
export const PHONE_MARKER_COLORS = ['#2997E5', '#e2514c', '#dbb63b', '#6db849', '#8b5fc7', '#e07934'] as const;

/** "m:ss.ff" with frames at `fps` (frames, not hundredths: what an editor cuts on). */
export function formatPhoneMarkerTime(seconds: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
  const totalFrames = Math.max(0, Math.round(seconds * safeFps));
  const frames = totalFrames % safeFps;
  const wholeSeconds = Math.floor(totalFrames / safeFps);
  const minutes = Math.floor(wholeSeconds / 60);
  const rest = wholeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}
