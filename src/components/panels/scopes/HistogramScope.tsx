import { useRef, useEffect } from 'react';
import type { HistogramData } from '../../../engine/analysis/ScopeAnalyzer';

interface HistogramScopeProps {
  data: HistogramData | null;
}

export function HistogramScope({ data }: HistogramScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw histogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Graticule — subtle grid lines at 0, 64, 128, 192, 255
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = dpr;
    const padding = 0;
    const plotW = w - padding * 2;
    const plotH = h - padding * 2;

    for (const mark of [0, 64, 128, 192, 255]) {
      const x = padding + (mark / 255) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, h - padding);
      ctx.stroke();
    }

    // Horizontal guide lines at 25%, 50%, 75%
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = h - padding - frac * plotH;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    if (data.max === 0) return;

    // Draw channels: Luma first (background), then R, G, B
    const channels: { arr: Uint32Array; color: string }[] = [
      { arr: data.luma, color: 'rgba(255, 255, 255, 0.15)' },
      { arr: data.r, color: 'rgba(255, 60, 60, 0.4)' },
      { arr: data.g, color: 'rgba(60, 255, 60, 0.4)' },
      { arr: data.b, color: 'rgba(60, 100, 255, 0.4)' },
    ];

    for (const { arr, color } of channels) {
      ctx.beginPath();
      ctx.moveTo(padding, h - padding);

      for (let i = 0; i < 256; i++) {
        const x = padding + (i / 255) * plotW;
        const normalized = arr[i] / data.max;
        const y = h - padding - normalized * plotH;
        if (i === 0) {
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.lineTo(w - padding, h - padding);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }, [data]);

  return (
    <div ref={containerRef} className="scope-canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
