import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage, CanvasWorkerReply } from './nodeCanvasTypes';
import { dragUpdatesFirst } from './canvasNodeDrag';

let painter: NodeCanvasPainter | undefined;
let layers: OffscreenCanvas[] = [];
let output: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
interface ViewportOutput { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D; shown: boolean }
let previewOutput: ViewportOutput, overlayOutput: ViewportOutput;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false, dirty = false, motionReported = false, lastFrameAt = -Infinity;
/** Timeline playback shares the GPU process with the WebGPU preview: every presented
 * bitmap is a full-surface upload, so signal flow and preview refreshes run at 15 Hz. */
const PLAYBACK_FRAME_MS = 1000 / 15;
const playbackDelay = () => Math.max(0, lastFrameAt + PLAYBACK_FRAME_MS - performance.now());
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

/** Copies a layer without its overscan; null clears a layer that no longer has content. */
function viewportLayer(layer: OffscreenCanvas, target: ViewportOutput, content: boolean): ImageBitmap | null | undefined {
  if (!content) { if (!target.shown) return undefined; target.shown = false; return null; }
  const inset = Math.round((painter?.viewInset ?? 0) * (painter?.viewRatio ?? 1));
  const width = Math.max(1, layer.width - inset * 2), height = Math.max(1, layer.height - inset * 2);
  if (target.canvas.width !== width) target.canvas.width = width;
  if (target.canvas.height !== height) target.canvas.height = height;
  target.context.globalCompositeOperation = 'copy';
  target.context.drawImage(layer, inset, inset, width, height, 0, 0, width, height);
  target.shown = true;
  return target.canvas.transferToImageBitmap();
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
    lastFrameAt = start;
    // Always compose into the output layers. Transferring a layer itself
    // detaches its backing store, and reallocating it every motion frame cost
    // 50-75 ms on large graphs; the copy costs a few milliseconds.
    const [base, previews, overlay] = layers;
    let bitmap: ImageBitmap | undefined;
    // Static cards and cables keep the overscan and are resent only when they changed.
    if (painter.changed.base || output.width !== base.width || output.height !== base.height) {
      if (output.width !== base.width) output.width = base.width;
      if (output.height !== base.height) output.height = base.height;
      // 'copy' replaces every output pixel, so no separate full-surface clear pass.
      context.globalCompositeOperation = 'copy'; context.drawImage(base, 0, 0);
      bitmap = output.transferToImageBitmap();
    }
    // Thumbnails and signal flow change during playback: send them cropped to the viewport.
    const previewBitmap = painter.changed.previews ? viewportLayer(previews, previewOutput, painter.previewCount > 0) : undefined;
    const overlayBitmap = painter.changed.overlay ? viewportLayer(overlay, overlayOutput, painter.hasOverlay) : undefined;
    dirty = false;
    if (bitmap || previewBitmap !== undefined || overlayBitmap !== undefined) {
      inFlight = true;
      post({ type: 'frame', bitmap, previews: previewBitmap, overlay: overlayBitmap, revision: painter.viewRevision },
        [bitmap, previewBitmap, overlayBitmap].filter((value): value is ImageBitmap => !!value));
    } else if (painter.animated) schedule(painter.playing ? PLAYBACK_FRAME_MS : 1000 / 30);
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
      // Layout motion runs at display rate; signal flow runs at 30 Hz, 15 Hz during playback.
      const throttled = !!painter?.playing && !painter.layoutMoving;
      if (dirty || painter?.animated) schedule(throttled ? playbackDelay() : dirty ? 0 : painter?.layoutMoving ? 1000 / 60 : 1000 / 30);
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
      const viewportOutput = (): ViewportOutput => {
        const canvas = new OffscreenCanvas(1, 1), viewportContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!viewportContext) throw new Error('Canvas 2D unavailable');
        return { canvas, context: viewportContext, shown: false };
      };
      if (!contexts[0] || !contexts[1] || !contexts[2] || !composed) throw new Error('Canvas 2D unavailable');
      context = composed; previewOutput = viewportOutput(); overlayOutput = viewportOutput();
      painter = new NodeCanvasPainter(contexts[0], contexts[2], contexts[1], () => new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }));
    } else if (message.type === 'previews') painter?.update(message);
    else pending.set(message.type, message);
    dirty = true;
    if (message.type === 'previews') { reportEvicted(); post({ type: 'previews-ready', batchId: message.batchId, previewCount: painter?.previewCount }); }
    // Editing input stays immediate; playback transport and preview refreshes are paced.
    const stopping = message.type === 'transport' && !message.transport.playing && !!painter?.playing;
    if (message.type === 'scene' || message.type === 'view' || message.type === 'drag' || message.type === 'hover' || stopping) { clearTimeout(timer); timer = undefined; schedule(); }
    else schedule((message.type === 'transport' ? message.transport.playing : !!painter?.playing) && !painter?.layoutMoving ? playbackDelay() : 0);
  } catch { post({ type: 'failed' }); }
};
