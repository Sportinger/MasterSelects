import { prefersSoftwareTimelineCanvas } from '../../../../../utils/canvasPlatform';
import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage, CanvasView, CanvasWorkerReply } from './nodeCanvasTypes';
import { releasePreviewFrame, type PreviewFrame } from '../../../../../services/nodePreview/previewTypes';

type Update = Exclude<CanvasMessage, { type: 'init' | 'presented' | 'previews' }>;

// CSS pixels, independent of graph zoom. Keep pixels ready beyond all four
// edges while the compositor moves the previous frame ahead of the worker.
export const NODE_CANVAS_OVERSCAN = 256;

export function bufferedCanvasView(view: Omit<CanvasView, 'ratio'>, dpr: number): CanvasView {
  const width = view.width + NODE_CANVAS_OVERSCAN * 2;
  const height = view.height + NODE_CANVAS_OVERSCAN * 2;
  return { ...view, width, height, panX: view.panX + NODE_CANVAS_OVERSCAN,
    panY: view.panY + NODE_CANVAS_OVERSCAN, ratio: canvasPixelRatio(width, height, dpr) };
}

/** Present worker pixels and their viewport correction in one main-thread task. */
export function createNodeCanvasRuntime(host: HTMLElement, onReady: (ready: boolean) => void, onViewReady: (revision: number) => void = () => {}) {
  let disposed = false, worker: Worker | undefined, painter: NodeCanvasPainter | undefined;
  let frame: number | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
  let base!: HTMLCanvasElement, overlay!: HTMLCanvasElement, previews!: HTMLCanvasElement;
  const pendingPreviews = new Map<string, PreviewFrame>();
  let previewBatch = 0, previewInFlight = false;
  let previewWatchdog: ReturnType<typeof setTimeout> | undefined;
  let ready = false, lastDraw = -Infinity;
  let reportedViewRevision: number | undefined;
  const latest = new Map<Update['type'], Update>(), pending = new Map<Update['type'], Update>();
  const createSurfaces = () => {
    base = document.createElement('canvas'); overlay = document.createElement('canvas');
    previews = document.createElement('canvas'); previews.dataset.layer = 'previews'; previews.setAttribute('aria-hidden', 'true');
    base.dataset.layer = 'base'; overlay.dataset.layer = 'animation';
    base.setAttribute('aria-hidden', 'true'); overlay.setAttribute('aria-hidden', 'true');
    host.replaceChildren(base, previews, overlay);
  };
  const markReady = () => {
    clearTimeout(watchdog);
    if (ready || disposed) return;
    ready = true; host.dataset.renderer = worker ? 'worker' : 'software'; onReady(true);
  };
  const tick = (now: number) => {
    frame = undefined;
    if (disposed) return;
    try {
      for (const message of pending.values()) {
        if (worker) worker.postMessage(message); else painter?.update(message);
      }
      let changed = pending.size > 0; pending.clear();
      if (pendingPreviews.size && !previewInFlight) {
        const frames = [...pendingPreviews.values()]; pendingPreviews.clear();
        const message = { type: 'previews' as const, frames, batchId: ++previewBatch };
        if (worker) {
          try { worker.postMessage(message, frames.flatMap(value => value.bitmap ? [value.bitmap] : [])); }
          catch (error) { frames.forEach(releasePreviewFrame); throw error; }
          previewInFlight = true;
          previewWatchdog = setTimeout(fallback, 2500);
        } else painter?.update(message);
        changed = true;
      }
      if (painter && (changed || now - lastDraw >= 1000 / 30)) {
        if (painter.draw(now)) {
          markReady();
          host.dataset.workerMotion = String(painter.layoutMoving);
          if (painter.viewRevision !== undefined && painter.viewRevision !== reportedViewRevision) {
            reportedViewRevision = painter.viewRevision; onViewReady(reportedViewRevision);
          }
        }
        lastDraw = now;
      }
      if (painter?.animated) frame = requestAnimationFrame(tick);
    } catch { fallback(); }
  };
  let flushQueued = false;
  const schedule = () => {
    if (disposed) return;
    if (worker) {
      // React has already coalesced pointer updates. Another RAF here adds a
      // full frame of input latency before the worker can even see the view.
      if (flushQueued) return;
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        if (!disposed && worker) tick(performance.now());
      });
    } else if (frame === undefined) frame = requestAnimationFrame(tick);
  };
  const fallback = () => {
    if (disposed) return;
    const wasWorker = !!worker;
    reportedViewRevision = undefined;
    worker?.terminate(); worker = undefined; clearTimeout(watchdog);
    previewInFlight = false; painter?.dispose();
    clearTimeout(previewWatchdog);
    for (const value of pendingPreviews.values()) releasePreviewFrame(value);
    pendingPreviews.clear();
    ready = false; onReady(false);
    if (painter && !wasWorker) { // Even Canvas 2D failed: keep the accessible DOM renderer visible.
      painter = undefined; host.replaceChildren(); host.dataset.renderer = 'dom'; return;
    }
    try {
      createSurfaces();
      const main = base.getContext('2d', { willReadFrequently: true }), animated = overlay.getContext('2d', { willReadFrequently: true });
      const preview = previews.getContext('2d', { willReadFrequently: true });
      if (!main || !animated || !preview) throw new Error('Canvas unavailable');
      painter = new NodeCanvasPainter(main, animated, preview, () => document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
      for (const [type, message] of latest) pending.set(type, message);
      schedule();
    } catch { host.replaceChildren(); host.dataset.renderer = 'dom'; }
  };
  createSurfaces();
  try {
    if (prefersSoftwareTimelineCanvas() || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') { fallback(); }
    else {
      const presenter = base.getContext('bitmaprenderer');
      if (!presenter) throw new Error('Bitmap presentation unavailable');
      host.replaceChildren(base);
      worker = new Worker(new URL('./nodeCanvas.worker.ts', import.meta.url), { type: 'module' });
      const activeWorker = worker;
      worker.onerror = () => { if (!disposed && worker === activeWorker) fallback(); };
      worker.onmessage = (event: MessageEvent<CanvasWorkerReply>) => {
        if (disposed || worker !== activeWorker) {
          if (event.data.type === 'frame') event.data.bitmap.close();
          return;
        }
        if (event.data.type === 'frame') {
          const { bitmap, revision } = event.data;
          try {
            // Both operations happen before the browser's next paint. A bare
            // worker acknowledgement cannot guarantee that for transferred DOM canvases.
            if (base.width !== bitmap.width) base.width = bitmap.width;
            if (base.height !== bitmap.height) base.height = bitmap.height;
            presenter.transferFromImageBitmap(bitmap);
            // Dev probes count what the user actually sees, not main-thread ticks.
            if (import.meta.env.DEV) host.dataset.presentedFrames = String(Number(host.dataset.presentedFrames ?? 0) + 1);
            if (revision !== undefined && revision !== reportedViewRevision) {
              reportedViewRevision = revision; onViewReady(revision);
            }
            markReady();
            activeWorker.postMessage({ type: 'presented' } satisfies CanvasMessage);
          } catch { fallback(); }
          finally { bitmap.close(); }
        }
        if (event.data.type === 'failed') fallback();
        if (event.data.type === 'motion') host.dataset.workerMotion = String(event.data.active);
        if (event.data.type === 'previews-ready') {
          previewInFlight = false; clearTimeout(previewWatchdog);
          if (import.meta.env.DEV) host.dataset.previewCount = String(event.data.previewCount ?? 0);
          if (pendingPreviews.size) schedule();
        }
        if (event.data.type === 'stats') {
          if (event.data.phases) host.dataset.paintPhases = JSON.stringify(event.data.phases);
          host.dataset.workerFps = event.data.fps?.toFixed(1);
          host.dataset.paintMs = event.data.paintMs?.toFixed(2);
          host.dataset.maxPaintMs = event.data.maxPaintMs?.toFixed(2);
        }
      };
      worker.postMessage({ type: 'init' } satisfies CanvasMessage);
      watchdog = setTimeout(fallback, 5000);
    }
  } catch { fallback(); }
  return {
    update(message: Update) { if (disposed) return; latest.set(message.type, message); pending.set(message.type, message); schedule(); },
    preview(value: PreviewFrame) {
      if (disposed || host.dataset.renderer === 'dom') { releasePreviewFrame(value); return; }
      releasePreviewFrame(pendingPreviews.get(value.key)); pendingPreviews.set(value.key, value);
      if (pendingPreviews.size > 128) { const key = pendingPreviews.keys().next().value!; releasePreviewFrame(pendingPreviews.get(key)); pendingPreviews.delete(key); }
      schedule();
    },
    get previewBusy() { return previewInFlight; },
    get software() { return !worker; },
    dispose() {
      disposed = true; worker?.terminate(); clearTimeout(watchdog);
      clearTimeout(previewWatchdog);
      painter?.dispose(); for (const value of pendingPreviews.values()) releasePreviewFrame(value); pendingPreviews.clear();
      if (frame !== undefined) cancelAnimationFrame(frame);
      host.replaceChildren(); pending.clear(); latest.clear();
    },
  };
}

/** Bound both dimensions and area, including very wide/high-DPI displays. */
export function canvasPixelRatio(width: number, height: number, dpr: number, maxPixels = 8_000_000): number {
  return Math.min(Math.max(1, dpr), 2, 4096 / Math.max(1, width), 4096 / Math.max(1, height), Math.sqrt(maxPixels / Math.max(1, width * height)));
}
