import { useRef } from 'react';
import { useGpuScope, type ScopeViewMode } from './useScopeAnalysis';

interface WaveformScopeProps {
  viewMode?: ScopeViewMode;
}

export function WaveformScope({ viewMode = 'rgb' }: WaveformScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas sizing is handled inside useGpuScope (aspect-ratio-aware)
  useGpuScope(canvasRef, 'waveform', true, viewMode);

  return (
    <div className="scope-canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
