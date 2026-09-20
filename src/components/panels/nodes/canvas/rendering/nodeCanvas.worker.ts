import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage } from './nodeCanvasTypes';

let painter: NodeCanvasPainter | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let ready = false;
let frames = 0, paintMs = 0, maxPaintMs = 0, reportAt = performance.now();
const frame = () => {
  timer = undefined;
  try {
    const start = performance.now();
    if (painter?.draw(start)) {
      const cost = performance.now() - start; frames++; paintMs += cost; maxPaintMs = Math.max(maxPaintMs, cost);
      if (!ready) { ready = true; self.postMessage({ type: 'ready' }); }
      if (import.meta.env.DEV && start - reportAt >= 1000) {
        self.postMessage({ type: 'stats', fps: frames * 1000 / (start - reportAt), paintMs: paintMs / frames, maxPaintMs });
        frames = 0; paintMs = 0; maxPaintMs = 0; reportAt = start;
      }
    }
    if (painter?.animated) timer = setTimeout(frame, 1000 / 30);
  } catch { self.postMessage({ type: 'failed' }); }
};
self.onmessage = (event: MessageEvent<CanvasMessage>) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      const base = message.base.getContext('2d'), overlay = message.overlay.getContext('2d');
      if (!base || !overlay) throw new Error('Canvas 2D unavailable');
      painter = new NodeCanvasPainter(base, overlay);
    } else painter?.update(message);
    // Pointer edits must not wait behind the 30 Hz decorative animation timer.
    if (message.type === 'scene' || message.type === 'view') { clearTimeout(timer); timer = undefined; }
    if (timer === undefined) timer = setTimeout(frame, 0);
  } catch { self.postMessage({ type: 'failed' }); }
};
