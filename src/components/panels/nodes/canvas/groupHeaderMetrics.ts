/** Only typography compensates for zoom; the frame and header never grow. */
export function groupHeaderMetrics(zoom = 1) {
  const scale = Math.max(0.18, zoom);
  return { height: 34, fontSize: Math.min(26, Math.max(13, 13 / scale)),
    iconSize: 24, controlSize: 28, gap: 6, padding: 6 };
}
