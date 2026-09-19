import { useRef, useState, useEffect } from 'react';
import {
  useGpuScope,
  type ScopeViewMode,
  type WaveformSizingMode,
} from './useScopeAnalysis';

const IRE_LABELS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

interface WaveformScopeProps {
  refreshIntervalMs?: number;
  showLegend?: boolean;
  sizing?: WaveformSizingMode;
  viewMode?: ScopeViewMode;
}

export function WaveformScope({
  refreshIntervalMs,
  showLegend = true,
  sizing = 'source-aspect',
  viewMode = 'rgb',
}: WaveformScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasH, setCanvasH] = useState<number>(0);

  // Canvas sizing is handled inside useGpuScope (aspect-ratio-aware)
  useGpuScope(canvasRef, 'waveform', true, viewMode, sizing, refreshIntervalMs);

  // Track canvas display height so legend can match it
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      setCanvasH(canvas.clientHeight);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  if (!showLegend) {
    return (
      <div className="scope-canvas-container">
        <canvas ref={canvasRef} />
      </div>
    );
  }

  return (
    <div className="scope-with-legend">
      <div
        className="scope-legend-y"
        style={canvasH > 0 ? { height: canvasH, alignSelf: 'center' } : undefined}
      >
        {IRE_LABELS.map((v) => (
          <span key={v} className="scope-legend-label">{v}</span>
        ))}
      </div>
      <div className="scope-canvas-container scope-waveform-canvas">
        <canvas ref={canvasRef} />
        <div aria-hidden="true" className="scope-waveform-reference-grid">
          {IRE_LABELS.map(value => <i key={value} />)}
        </div>
      </div>
    </div>
  );
}
