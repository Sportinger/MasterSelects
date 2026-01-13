// Mobile Preview - Simplified preview canvas for mobile

import { useEffect } from 'react';
import { useEngine } from '../../hooks/useEngine';
import { useMediaStore } from '../../stores/mediaStore';

export function MobilePreview() {
  // Get active composition
  const activeCompositionId = useMediaStore((s) => s.activeCompositionId);
  const compositions = useMediaStore((s) => s.compositions);
  const activeComp = compositions.find((c) => c.id === activeCompositionId);

  // Initialize engine - canvasRef comes from useEngine
  const { canvasRef, isEngineReady } = useEngine();

  // Set canvas size based on composition
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeComp) return;

    // Use composition aspect ratio, fit to container
    const container = canvas.parentElement;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const compAspect = activeComp.width / activeComp.height;
    const containerAspect = containerWidth / containerHeight;

    let width: number, height: number;
    if (compAspect > containerAspect) {
      // Composition is wider - fit to width
      width = containerWidth;
      height = containerWidth / compAspect;
    } else {
      // Composition is taller - fit to height
      height = containerHeight;
      width = containerHeight * compAspect;
    }

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = activeComp.width;
    canvas.height = activeComp.height;
  }, [activeComp]);

  return (
    <div className="mobile-preview">
      <canvas
        ref={canvasRef}
        className="mobile-preview-canvas"
      />
      {!isEngineReady && (
        <div className="mobile-preview-loading">
          Initializing WebGPU...
        </div>
      )}
    </div>
  );
}
