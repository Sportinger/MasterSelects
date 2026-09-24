/** Marker sizes in SVG units, based on adjacent contour spacing in screen pixels. */
export function maskVertexSizing(points: readonly { x: number; y: number }[], unitsPerScreenPx: number) {
  const unit = Math.max(1e-6, unitsPerScreenPx);
  return points.map((p, index) => {
    let spacing = Infinity;
    for (const direction of [-1, 1]) {
      // Retraced contour bridges can contain coincident vertices.
      for (let step = 1; step < Math.min(points.length, 9); step++) {
        const q = points[(index + direction * step + points.length) % points.length];
        const distance = Math.hypot(q.x - p.x, q.y - p.y) / unit;
        if (distance > .01) { spacing = Math.min(spacing, distance); break; }
      }
    }
    return {
      size: Math.min(8, Math.max(1.5, spacing * .55)) * unit,
      hitRadius: Math.min(14, Math.max(3, spacing * .45)) * unit,
    };
  });
}
