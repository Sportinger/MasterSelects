import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage, CanvasWorkerReply } from './nodeCanvasTypes';

let painter: NodeCanvasPainter | undefined;
let layers: OffscreenCanvas[] = [];
let output: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false, dirty = false;
let frames = 0, paintMs = 0, maxPaintMs = 0, reportAt = performance.now();
let baseMs = 0, overlayMs = 0, previewMs = 0;
const post = (message: CanvasWorkerReply, transfer: Transferable[] = []) => self.postMessage(message, transfer);

function schedule(delay = 0) {
  if (!inFlight && timer === undefined) timer = setTimeout(frame, delay);
}

function frame() {
  timer = undefined;
  try {
    const start = performance.now();
    if (!painter?.draw(start)) return;
    // Preserve cached layers. Only the composed output is transferred; no
    // worker-owned canvas can update the visible DOM independently.
    const [base, previews, overlay] = layers;
    if (output.width !== base.width) output.width = base.width;
    if (output.height !== base.height) output.height = base.height;
    context.clearRect(0, 0, output.width, output.height);
    for (const layer of [base, previews, overlay]) context.drawImage(layer, 0, 0);
    const bitmap = output.transferToImageBitmap();
    dirty = false;
    inFlight = true;
    post({ type: 'frame', bitmap, revision: painter.viewRevision }, [bitmap]);
    const cost = performance.now() - start;
    frames++; paintMs += cost; maxPaintMs = Math.max(maxPaintMs, cost);
    if (import.meta.env.DEV) { baseMs += painter.timings.baseMs; overlayMs += painter.timings.overlayMs; previewMs += painter.timings.previewMs; }
    if (import.meta.env.DEV && start - reportAt >= 1000) {
      post({ type: 'stats', fps: frames * 1000 / (start - reportAt), paintMs: paintMs / frames, maxPaintMs,
        phases: { baseMs: baseMs / frames, overlayMs: overlayMs / frames, previewMs: previewMs / frames } });
      baseMs = 0; overlayMs = 0; previewMs = 0;
      frames = 0; paintMs = 0; maxPaintMs = 0; reportAt = start;
    }
  } catch { post({ type: 'failed' }); }
}

self.onmessage = (event: MessageEvent<CanvasMessage>) => {
  try {
    const message = event.data;
    if (message.type === 'presented') {
      inFlight = false;
      if (dirty || painter?.animated) schedule(dirty ? 0 : 1000 / 30);
      return;
    }
    if (message.type === 'init') {
      layers = Array.from({ length: 3 }, () => new OffscreenCanvas(1, 1));
      output = new OffscreenCanvas(1, 1);
      const contexts = layers.map(layer => layer.getContext('2d'));
      const composed = output.getContext('2d');
      if (!contexts[0] || !contexts[1] || !contexts[2] || !composed) throw new Error('Canvas 2D unavailable');
      context = composed;
      painter = new NodeCanvasPainter(contexts[0], contexts[2], contexts[1], () => new OffscreenCanvas(1, 1).getContext('2d'));
    } else painter?.update(message);
    dirty = true;
    if (message.type === 'previews') post({ type: 'previews-ready', batchId: message.batchId, previewCount: painter?.previewCount });
    if (message.type === 'scene' || message.type === 'view') { clearTimeout(timer); timer = undefined; }
    schedule();
  } catch { post({ type: 'failed' }); }
};
