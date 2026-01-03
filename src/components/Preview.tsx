// Preview canvas component

import { useEngine } from '../hooks/useEngine';
import { useMixerStore } from '../stores/mixerStore';

export function Preview() {
  const { canvasRef, isEngineReady } = useEngine();
  const { engineStats, outputResolution } = useMixerStore();

  return (
    <div className="preview-container">
      <div className="preview-stats">
        {engineStats.fps} FPS | {outputResolution.width}x{outputResolution.height}
      </div>
      <div className="preview-canvas-wrapper">
        {!isEngineReady ? (
          <div className="loading">
            <div className="loading-spinner" />
            <p>Initializing WebGPU...</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={outputResolution.width}
            height={outputResolution.height}
            className="preview-canvas"
          />
        )}
      </div>
    </div>
  );
}
