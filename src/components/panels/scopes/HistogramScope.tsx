import { useRef, useEffect } from 'react';
import { useGpuScope, type ScopeViewMode } from './useScopeAnalysis';

interface HistogramScopeProps {
  viewMode?: ScopeViewMode;
}

export function HistogramScope({ viewMode = 'rgb' }: HistogramScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useGpuScope(canvasRef, 'histogram', true, viewMode);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="scope-canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
