import { useCallback, useEffect, useRef } from 'react';
import type { StreamHealthSample } from '../../../services/liveStream/streamTypes';

interface GraphLine {
  label: string;
  colorProperty: string;
  values: readonly number[];
}

interface HealthGraphCanvasProps {
  label: string;
  samples: readonly StreamHealthSample[];
  lines: readonly GraphLine[];
  rangeFloor: number;
  formatValue(value: number): string;
}

function cssColor(styles: CSSStyleDeclaration, property: string, fallback: string): string {
  return styles.getPropertyValue(property).trim() || fallback;
}

function finiteValues(lines: readonly GraphLine[]): number[] {
  return lines.flatMap(line => line.values.filter(Number.isFinite));
}

export function HealthGraphCanvas({
  label,
  samples,
  lines,
  rangeFloor,
  formatValue,
}: HealthGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || canvas.clientWidth || 1);
    const height = Math.max(1, bounds.height || canvas.clientHeight || 108);
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const backingWidth = Math.max(1, Math.round(width * pixelRatio));
    const backingHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const gridColor = cssColor(styles, '--stream-graph-grid', '#444');
    const textColor = cssColor(styles, '--stream-graph-text', '#aaa');
    const padding = { top: 8, right: 8, bottom: 18, left: 38 };
    const graphWidth = Math.max(1, width - padding.left - padding.right);
    const graphHeight = Math.max(1, height - padding.top - padding.bottom);

    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    for (let row = 0; row <= 2; row += 1) {
      const y = padding.top + graphHeight * row / 2;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
    }

    const values = finiteValues(lines);
    const observedMin = values.length > 0 ? Math.min(...values) : 0;
    const observedMax = values.length > 0 ? Math.max(...values) : 0;
    const visibleRange = Math.max(rangeFloor, observedMax - observedMin);
    const center = (observedMin + observedMax) / 2;
    const minValue = Math.max(0, center - visibleRange / 2);
    const maxValue = Math.max(minValue + rangeFloor, center + visibleRange / 2);

    context.fillStyle = textColor;
    context.font = '10px sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'top';
    context.fillText(formatValue(maxValue), padding.left - 5, padding.top);
    context.textBaseline = 'bottom';
    context.fillText(formatValue(minValue), padding.left - 5, padding.top + graphHeight);

    for (const line of lines) {
      if (line.values.length === 0) continue;
      context.strokeStyle = cssColor(styles, line.colorProperty, '#2d8ceb');
      context.lineWidth = 1.5;
      context.beginPath();
      line.values.forEach((rawValue, index) => {
        const value = Number.isFinite(rawValue) ? rawValue : 0;
        const x = padding.left + (line.values.length === 1
          ? graphWidth
          : graphWidth * index / (line.values.length - 1));
        const normalized = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
        const y = padding.top + graphHeight * (1 - normalized);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    context.fillStyle = textColor;
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    context.fillText(samples.length > 0 ? `${samples.length}s` : 'No samples', padding.left, height - 2);
  }, [formatValue, lines, rangeFloor, samples]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', draw);
      return () => window.removeEventListener('resize', draw);
    }
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className="stream-analytics-graph-canvas" aria-label={label} />;
}
