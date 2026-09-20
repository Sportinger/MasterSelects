import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage } from './nodeCanvasTypes';

let painter: NodeCanvasPainter | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let ready = false;
let reportedViewRevision: number | undefined;
let frames = 0, paintMs = 0, maxPaintMs = 0, reportAt = performance.now();
const frame = () => {
  timer = undefined;
  try {
    const start = performance.now();
    if (painter?.draw(start)) {
      const cost = performance.now() - start; frames++; paintMs += cost; maxPaintMs = Math.max(maxPaintMs, cost);
      if (!ready) { ready = true; self.postMessage({ type: 'ready' }); }
      if (painter.viewRevision !== undefined && painter.viewRevision !== reportedViewRevision) {
        reportedViewRevision = painter.viewRevision;
        self.postMessage({ type: 'view-ready', revision: reportedViewRevision });
      }
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
      const preview = message.previews?.getContext('2d') ?? undefined;
      painter = new NodeCanvasPainter(base, overlay, preview, () => new OffscreenCanvas(1, 1).getContext('2d'));
    } else painter?.update(message);
    if (message.type === 'previews') self.postMessage({ type: 'previews-ready', batchId: message.batchId, previewCount: painter?.previewCount });
    // Pointer edits must not wait behind the 30 Hz decorative animation timer.
    if (message.type === 'scene' || message.type === 'view') { clearTimeout(timer); timer = undefined; }
    if (timer === undefined) timer = setTimeout(frame, 0);
  } catch { self.postMessage({ type: 'failed' }); }
};
