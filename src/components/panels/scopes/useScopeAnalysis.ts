import { useEffect, useRef, useCallback } from 'react';
import { useEngineStore } from '../../../stores/engineStore';
import { ScopeRenderer } from '../../../engine/analysis/ScopeRenderer';
import { renderHostPort } from '../../../services/render/renderHostPort';

export type ScopeTab = 'histogram' | 'vectorscope' | 'waveform';
export type ScopeViewMode = 'rgb' | 'r' | 'g' | 'b' | 'luma' | 'parade';
export type WaveformSizingMode = 'source-aspect' | 'fill';

// Map view mode to numeric value for GPU uniform
const VIEW_MODE_MAP: Record<ScopeViewMode, number> = {
  rgb: 0,
  r: 1,
  g: 2,
  b: 3,
  luma: 4,
  parade: 5,
};

const DEFAULT_REFRESH_INTERVAL_MS = 66; // ~15fps
const RESIZE_REFRESH_DEBOUNCE_MS = 100;

/**
 * GPU-accelerated scope rendering hook.
 * Reads directly from the composition texture — no readPixels overhead.
 */
export function useGpuScope(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  scopeType: ScopeTab,
  visible: boolean,
  viewMode: ScopeViewMode = 'rgb',
  waveformSizing: WaveformSizingMode = 'source-aspect',
  refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS,
) {
  const isEngineReady = useEngineStore((s) => s.isEngineReady);
  const rendererRef = useRef<ScopeRenderer | null>(null);
  const ctxRef = useRef<GPUCanvasContext | null>(null);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const initedRef = useRef(false);
  const lastAnalyzedRenderTimeRef = useRef<number | null>(null);
  const resizeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize WebGPU context + renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isEngineReady || !visible) return;

    let destroyed = false;

    const init = async () => {
      const device = renderHostPort.getDevice();
      if (!device || destroyed) return;

      const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
      if (!ctx) return;
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, alphaMode: 'opaque' });
      ctxRef.current = ctx;

      if (!rendererRef.current) {
        rendererRef.current = new ScopeRenderer(device, format);
      }
      initedRef.current = true;
    };

    init();

    return () => {
      destroyed = true;
      initedRef.current = false;
      ctxRef.current = null;
    };
  }, [canvasRef, isEngineReady, visible]);

  // Render callback
  const render = useCallback(async () => {
    const renderer = rendererRef.current;
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !ctx || !canvas) return;

    const mode = VIEW_MODE_MAP[viewMode];
    const renderedAt = renderHostPort.getRenderLoop()?.getLastSuccessfulRenderTime() ?? 0;
    if (lastAnalyzedRenderTimeRef.current === renderedAt) return;

    try {
      const texture = renderHostPort.getLastRenderedTexture();
      if (!texture) {
        // No content — clear scope to black
        const device = renderHostPort.getDevice();
        if (device && ctx) {
          const enc = device.createCommandEncoder();
          enc.beginRenderPass({
            colorAttachments: [{
              view: ctx.getCurrentTexture().createView(),
              loadOp: 'clear', storeOp: 'store',
              clearValue: { r: 0.04, g: 0.04, b: 0.04, a: 1 },
            }],
          }).end();
          device.queue.submit([enc.finish()]);
        }
        lastAnalyzedRenderTimeRef.current = renderedAt;
        return;
      }

      // Waveform: maintain source content aspect ratio
      if (scopeType === 'waveform') {
        const parent = canvas.parentElement;
        if (parent) {
          const cw = parent.clientWidth;
          const ch = parent.clientHeight;
          if (cw > 0 && ch > 0) {
            const dpr = window.devicePixelRatio || 1;
            let w = cw;
            let h = ch;
            if (waveformSizing === 'source-aspect') {
              const srcAR = texture.width / texture.height;
              const containerAR = cw / ch;
              if (containerAR > srcAR) {
                h = ch;
                w = ch * srcAR;
              } else {
                w = cw;
                h = cw / srcAR;
              }
            }
            const pw = Math.round(w * dpr);
            const ph = Math.round(h * dpr);
            if (canvas.width !== pw || canvas.height !== ph) {
              canvas.width = pw;
              canvas.height = ph;
              canvas.style.width = `${Math.round(w)}px`;
              canvas.style.height = `${Math.round(h)}px`;
            }
          }
        }
        renderer.renderWaveform(texture, ctx, mode);
      } else if (scopeType === 'histogram') {
        renderer.renderHistogram(texture, ctx, mode);
      } else {
        renderer.renderVectorscope(texture, ctx);
      }
      lastAnalyzedRenderTimeRef.current = renderedAt;
    } catch {
      // GPU error — skip frame
    }
  }, [scopeType, canvasRef, viewMode, waveformSizing]);

  useEffect(() => {
    lastAnalyzedRenderTimeRef.current = null;
  }, [scopeType, viewMode, waveformSizing]);

  // A paused frame normally stays cached. Invalidate it once after panel
  // resizing settles so the scope is redrawn at the new canvas dimensions.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let observedWidth = container.clientWidth;
    let observedHeight = container.clientHeight;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? container.getBoundingClientRect();
      if (width === observedWidth && height === observedHeight) return;
      observedWidth = width;
      observedHeight = height;

      if (resizeRefreshTimerRef.current !== null) {
        clearTimeout(resizeRefreshTimerRef.current);
      }
      resizeRefreshTimerRef.current = setTimeout(() => {
        lastAnalyzedRenderTimeRef.current = null;
        resizeRefreshTimerRef.current = null;
      }, RESIZE_REFRESH_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeRefreshTimerRef.current !== null) {
        clearTimeout(resizeRefreshTimerRef.current);
        resizeRefreshTimerRef.current = null;
      }
    };
  }, [canvasRef]);

  // RAF render loop
  useEffect(() => {
    if (!isEngineReady || !visible) return;

    let cancelled = false;

    const tick = (time: number) => {
      if (cancelled) return;
      if (initedRef.current && time - lastTimeRef.current >= refreshIntervalMs) {
        lastTimeRef.current = time;
        render();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isEngineReady, visible, refreshIntervalMs, render]);

  // Cleanup renderer on unmount
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);
}
