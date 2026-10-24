// Shared by tutorial-video.mjs: the paths of a presenter's pointer gestures, as points (CSS px) for
// humanMouse.path. A hand never draws a perfect circle, so loops wobble a little and do not close
// exactly; waves and nods swing a little less each time, as a gesture fades out.

/**
 * A loop around `center` that starts where the pointer is (`from`), so it flows out of the
 * approach: radii r (x) and ry (y), `turns` times, clockwise.
 */
export function circlePoints(center, from, { r = 40, ry = r, turns = 1 } = {}) {
  const start = Math.atan2((from.y - center.y) / ry, (from.x - center.x) / r);
  const count = Math.max(24, Math.round(48 * turns));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count, angle = start + t * turns * Math.PI * 2;
    const wobble = 1 + 0.06 * Math.sin(3 * angle + 0.7) - 0.05 * t;
    return { x: center.x + Math.cos(angle) * r * wobble, y: center.y + Math.sin(angle) * ry * wobble };
  });
}

/** Back and forth around `center`: a wave (axis "x") or a nod (axis "y"), ending where it began. */
export function swingPoints(center, { amp = 40, cycles = 2, axis = 'x' } = {}) {
  const count = Math.max(12, Math.round(16 * cycles));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count, swing = Math.sin(t * cycles * Math.PI * 2) * amp * (1 - 0.45 * t);
    // A wave rises slightly at its ends, a nod leans slightly forward.
    const side = Math.abs(swing) * 0.12;
    return axis === 'x' ? { x: center.x + swing, y: center.y - side } : { x: center.x + side, y: center.y + swing };
  });
}

/**
 * Through `points`; with `curve` each step bends like a node cable (leaving and arriving
 * horizontally), so the pointer can follow one.
 */
export function tracePoints(points, { curve = false } = {}) {
  if (!curve) return points;
  return points.slice(1).flatMap((to, index) => {
    const from = points[index], mid = (from.x + to.x) / 2;
    return Array.from({ length: 20 }, (_, step) => {
      const t = (step + 1) / 20, u = 1 - t;
      return { x: u ** 3 * from.x + 3 * u * u * t * mid + 3 * u * t * t * mid + t ** 3 * to.x,
        y: u ** 3 * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t ** 3 * to.y };
    });
  });
}
