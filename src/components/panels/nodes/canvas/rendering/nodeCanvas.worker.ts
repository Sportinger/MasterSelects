import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage, CanvasWorkerReply } from './nodeCanvasTypes';
import { dragUpdatesFirst } from './canvasNodeDrag';

let painter: NodeCanvasPainter | undefined;
let layers: OffscreenCanvas[] = [];
let output: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false, dirty = false, motionReported = false;
let frames = 0, paintMs = 0, maxPaintMs = 0, reportAt = performance.now();
let baseMs = 0, overlayMs = 0, previewMs = 0, updateMs = 0, composeMs = 0, drawMs = 0;
type Update = Extract<CanvasMessage, { type: 'scene' | 'view' | 'transport' | 'hover' | 'drag' }>;
const pending = new Map<Update['type'], Update>();
const post = (message: CanvasWorkerReply, transfer: Transferable[] = []) => self.postMessage(message, transfer);
function reportEvicted() {
  const keys = painter?.takeEvictedPreviews();
  if (keys?.length) post({ type: 'previews-evicted', keys });
}

function schedule(delay = 0) {
  if (!inFlight && timer === undefined) timer = setTimeout(frame, delay);
}

function frame() {
  timer = undefined;
  try {
    const start = performance.now();
    for (const message of dragUpdatesFirst(pending.values())) painter?.update(message);
    pending.clear();
    const updated = performance.now();
    if (!painter?.draw(start)) return;
    reportEvicted();
    const drawn = performance.now();
    // Always compose into the output layer. Transferring the base itself
    // detaches its backing store, and reallocating it every motion frame cost
    // 50-75 ms on large graphs; the copy costs a few milliseconds.
    const [base, previews, overlay] = layers;
    if (output.width !== base.width) output.width = base.width;
    if (output.height !== base.height) output.height = base.height;
    // 'copy' replaces every output pixel, so no separate full-surface clear pass.
    context.globalCompositeOperation = 'copy'; context.drawImage(base, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
    if (painter.previewCount) context.drawImage(previews, 0, 0);
    if (painter.hasOverlay) context.drawImage(overlay, 0, 0);
    context.restore();
    const bitmap = output.transferToImageBitmap();
    dirty = false;
    inFlight = true;
    post({ type: 'frame', bitmap, revision: painter.viewRevision }, [bitmap]);
    // The DOM hides its static group frames while the worker animates them.
    if (painter.layoutMoving !== motionReported) { motionReported = painter.layoutMoving; post({ type: 'motion', active: motionReported }); }
    const cost = performance.now() - start;
    if (import.meta.env.DEV) { updateMs += updated - start; drawMs += drawn - updated; composeMs += start + cost - drawn; }
    frames++; paintMs += cost; maxPaintMs = Math.max(maxPaintMs, cost);
    if (import.meta.env.DEV) { baseMs += painter.timings.baseMs; overlayMs += painter.timings.overlayMs; previewMs += painter.timings.previewMs; }
    if (import.meta.env.DEV && start - reportAt >= 1000) {
      post({ type: 'stats', fps: frames * 1000 / (start - reportAt), paintMs: paintMs / frames, maxPaintMs,
        phases: { baseMs: baseMs / frames, overlayMs: overlayMs / frames, previewMs: previewMs / frames,
          updateMs: updateMs / frames, drawMs: drawMs / frames, composeMs: composeMs / frames } });
      baseMs = 0; overlayMs = 0; previewMs = 0; updateMs = 0; drawMs = 0; composeMs = 0;
      frames = 0; paintMs = 0; maxPaintMs = 0; reportAt = start;
    }
  } catch { post({ type: 'failed' }); }
}

self.onmessage = (event: MessageEvent<CanvasMessage>) => {
  try {
    const message = event.data;
    if (message.type === 'presented') {
      inFlight = false;
      // Layout motion runs at display rate; playback signal flow stays at 30 Hz.
      if (dirty || painter?.animated) schedule(dirty ? 0 : painter?.layoutMoving ? 1000 / 60 : 1000 / 30);
      return;
    }
    if (message.type === 'init') {
      layers = Array.from({ length: 3 }, () => new OffscreenCanvas(1, 1));
      output = new OffscreenCanvas(1, 1);
      // These layers are copied into a bitmap every frame. GPU-backed 2D
      // surfaces can stall browser composition for hundreds of milliseconds
      // on large/zoomed graphs (notably Windows/AMD). Keep rasterization and
      // copies in this worker; the main thread only presents the final bitmap.
      const contexts = layers.map(layer => layer.getContext('2d', { willReadFrequently: true }));
      const composed = output.getContext('2d', { willReadFrequently: true });
      if (!contexts[0] || !contexts[1] || !contexts[2] || !composed) throw new Error('Canvas 2D unavailable');
      context = composed;
      painter = new NodeCanvasPainter(contexts[0], contexts[2], contexts[1], () => new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }));
    } else if (message.type === 'previews') painter?.update(message);
    else pending.set(message.type, message);
    dirty = true;
    if (message.type === 'previews') { reportEvicted(); post({ type: 'previews-ready', batchId: message.batchId, previewCount: painter?.previewCount }); }
    if (message.type === 'scene' || message.type === 'view' || message.type === 'drag') { clearTimeout(timer); timer = undefined; }
    schedule();
  } catch { post({ type: 'failed' }); }
};
