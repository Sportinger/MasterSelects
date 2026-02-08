import { useEffect, useRef, useCallback } from 'react';
import { useEngineStore } from '../../../stores/engineStore';
import { ScopeRenderer } from '../../../engine/analysis/ScopeRenderer';

export type ScopeTab = 'histogram' | 'vectorscope' | 'waveform';

const INTERVAL = 66; // ~15fps

/**
 * GPU-accelerated scope rendering hook.
 * Reads directly from the composition texture — no readPixels overhead.
 */
export function useGpuScope(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  scopeType: ScopeTab,
  visible: boolean
) {
  const isEngineReady = useEngineStore((s) => s.isEngineReady);
  const rendererRef = useRef<ScopeRenderer | null>(null);
  const ctxRef = useRef<GPUCanvasContext | null>(null);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const initedRef = useRef(false);

  // Initialize WebGPU context + renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isEngineReady || !visible) return;

    let destroyed = false;

    const init = async () => {
      const { engine } = await import('../../../engine/WebGPUEngine');
      const device = engine.getDevice();
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
    if (!renderer || !ctx) return;

    try {
      const { engine } = await import('../../../engine/WebGPUEngine');
      const texture = engine.getLastRenderedTexture();
      if (!texture) return;

      if (scopeType === 'waveform') {
        renderer.renderWaveform(texture, ctx);
      } else if (scopeType === 'histogram') {
        renderer.renderHistogram(texture, ctx);
      } else {
        renderer.renderVectorscope(texture, ctx);
      }
    } catch {
      // GPU error — skip frame
    }
  }, [scopeType]);

  // RAF render loop
  useEffect(() => {
    if (!isEngineReady || !visible) return;

    let cancelled = false;

    const tick = (time: number) => {
      if (cancelled) return;
      if (initedRef.current && time - lastTimeRef.current >= INTERVAL) {
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
  }, [isEngineReady, visible, render]);

  // Cleanup renderer on unmount
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);
}
