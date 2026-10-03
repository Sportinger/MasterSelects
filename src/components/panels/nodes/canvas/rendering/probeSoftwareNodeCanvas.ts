import { paintBase, type DrawContext } from './paintNodeCanvas';
import { takeCablePathTiming } from './cableGeometry';
import { takePaintPhases } from './nodePaintProfile';

/** A non-null 2D context can still lack operations used by the painter (notably
 * Path2D). Exercise one tiny cable before deferring any software frame, so an
 * unsupported renderer releases DOM ownership synchronously. No project graph is painted. */
export function probeSoftwareNodeCanvas(base: DrawContext, overlay: DrawContext, previews: DrawContext) {
  try {
    for (const ctx of [base, overlay, previews]) {
      ctx.canvas.width = 1; ctx.canvas.height = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 1, 1);
    }
    paintBase(base, { nodes: [], groups: [], plugs: [], cables: [
      { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, color: '#000', highlighted: false },
    ] }, { zoom: 1, panX: 0, panY: 0, width: 1, height: 1, ratio: 1 },
    { background: '#000', card: '#000', text: '#000', muted: '#000', border: '#000', accent: '#000' });
    base.clearRect(0, 0, 1, 1);
  } finally {
    // Capability checks are not graph paint measurements.
    if (import.meta.env.DEV) { takePaintPhases(); takeCablePathTiming(); }
  }
}
