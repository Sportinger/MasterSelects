import { useRef } from 'react';
import { useGpuScope, type ScopeViewMode } from './useScopeAnalysis';

const IRE_LABELS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

interface WaveformScopeProps {
  viewMode?: ScopeViewMode;
}

export function WaveformScope({ viewMode = 'rgb' }: WaveformScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas sizing is handled inside useGpuScope (aspect-ratio-aware)
  useGpuScope(canvasRef, 'waveform', true, viewMode);

  return (
    <div className="scope-with-legend">
      <div className="scope-legend-y">
        {IRE_LABELS.map((v) => (
          <span key={v} className="scope-legend-label">{v}</span>
        ))}
      </div>
      <div className="scope-canvas-container">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
