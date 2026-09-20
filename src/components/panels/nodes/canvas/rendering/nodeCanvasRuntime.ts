import { prefersSoftwareTimelineCanvas } from '../../../../../utils/canvasPlatform';
import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage } from './nodeCanvasTypes';
import { releasePreviewFrame, type PreviewFrame } from '../../../../../services/nodePreview/previewTypes';

type Update = Exclude<CanvasMessage, { type: 'init' } | { type: 'previews' }>;
/** A failed transferred canvas must be replaced, not reused for the software path. */
export function createNodeCanvasRuntime(host: HTMLElement, onReady: (ready: boolean) => void) {
  let disposed = false, worker: Worker | undefined, painter: NodeCanvasPainter | undefined;
  let frame: number | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
  let base!: HTMLCanvasElement, overlay!: HTMLCanvasElement, previews!: HTMLCanvasElement;
  const pendingPreviews = new Map<string, PreviewFrame>();
  let previewBatch = 0, previewInFlight = false;
  let previewWatchdog: ReturnType<typeof setTimeout> | undefined;
  let ready = false, lastDraw = -Infinity;
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
        if (painter.draw(now)) markReady(); lastDraw = now;
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
    if (prefersSoftwareTimelineCanvas() || typeof Worker === 'undefined' || !base.transferControlToOffscreen) { fallback(); }
    else {
      worker = new Worker(new URL('./nodeCanvas.worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = () => fallback();
      worker.onmessage = (event: MessageEvent<{ type: string; fps?: number; paintMs?: number; maxPaintMs?: number; previewCount?: number }>) => {
        if (event.data.type === 'ready') markReady();
        if (event.data.type === 'failed') fallback();
        if (event.data.type === 'previews-ready') {
          previewInFlight = false; clearTimeout(previewWatchdog);
          if (import.meta.env.DEV) host.dataset.previewCount = String(event.data.previewCount ?? 0);
          if (pendingPreviews.size) schedule();
        }
        if (event.data.type === 'stats') {
          host.dataset.workerFps = event.data.fps?.toFixed(1);
          host.dataset.paintMs = event.data.paintMs?.toFixed(2);
          host.dataset.maxPaintMs = event.data.maxPaintMs?.toFixed(2);
        }
      };
      const main = base.transferControlToOffscreen(), animated = overlay.transferControlToOffscreen();
      const preview = previews.transferControlToOffscreen();
      worker.postMessage({ type: 'init', base: main, overlay: animated, previews: preview } satisfies CanvasMessage, [main, animated, preview]);
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
export function canvasPixelRatio(width: number, height: number, dpr: number): number {
  return Math.min(Math.max(1, dpr), 2, 4096 / Math.max(1, width), 4096 / Math.max(1, height), Math.sqrt(8_000_000 / Math.max(1, width * height)));
}
