import { prefersSoftwareTimelineCanvas } from '../../../../../utils/canvasPlatform';
import { NodeCanvasPainter } from './NodeCanvasPainter';
import type { CanvasMessage } from './nodeCanvasTypes';

type Update = Exclude<CanvasMessage, { type: 'init' }>;
/** A failed transferred canvas must be replaced, not reused for the software path. */
export function createNodeCanvasRuntime(host: HTMLElement, onReady: (ready: boolean) => void) {
  let disposed = false, worker: Worker | undefined, painter: NodeCanvasPainter | undefined;
  let frame: number | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
  let base!: HTMLCanvasElement, overlay!: HTMLCanvasElement;
  let ready = false, lastDraw = -Infinity;
  const latest = new Map<Update['type'], Update>(), pending = new Map<Update['type'], Update>();
  const createSurfaces = () => {
    base = document.createElement('canvas'); overlay = document.createElement('canvas');
    base.dataset.layer = 'base'; overlay.dataset.layer = 'animation';
    base.setAttribute('aria-hidden', 'true'); overlay.setAttribute('aria-hidden', 'true');
    host.replaceChildren(base, overlay);
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
      const changed = pending.size > 0; pending.clear();
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
    ready = false; onReady(false);
    if (painter && !wasWorker) { // Even Canvas 2D failed: keep the accessible DOM renderer visible.
      painter = undefined; host.replaceChildren(); host.dataset.renderer = 'dom'; return;
    }
    try {
      createSurfaces();
      const main = base.getContext('2d', { willReadFrequently: true }), animated = overlay.getContext('2d', { willReadFrequently: true });
      if (!main || !animated) throw new Error('Canvas unavailable');
      painter = new NodeCanvasPainter(main, animated);
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
      worker.onmessage = (event: MessageEvent<{ type: string; fps?: number; paintMs?: number; maxPaintMs?: number }>) => {
        if (event.data.type === 'ready') markReady();
        if (event.data.type === 'failed') fallback();
        if (event.data.type === 'stats') {
          host.dataset.workerFps = event.data.fps?.toFixed(1);
          host.dataset.paintMs = event.data.paintMs?.toFixed(2);
          host.dataset.maxPaintMs = event.data.maxPaintMs?.toFixed(2);
        }
      };
      const main = base.transferControlToOffscreen(), animated = overlay.transferControlToOffscreen();
      worker.postMessage({ type: 'init', base: main, overlay: animated } satisfies CanvasMessage, [main, animated]);
      watchdog = setTimeout(fallback, 5000);
    }
  } catch { fallback(); }
  return {
    update(message: Update) { if (disposed) return; latest.set(message.type, message); pending.set(message.type, message); schedule(); },
    dispose() {
      disposed = true; worker?.terminate(); clearTimeout(watchdog);
      if (frame !== undefined) cancelAnimationFrame(frame);
      host.replaceChildren(); pending.clear(); latest.clear();
    },
  };
}

/** Bound both dimensions and area, including very wide/high-DPI displays. */
export function canvasPixelRatio(width: number, height: number, dpr: number): number {
  return Math.min(Math.max(1, dpr), 2, 4096 / Math.max(1, width), 4096 / Math.max(1, height), Math.sqrt(8_000_000 / Math.max(1, width * height)));
}
