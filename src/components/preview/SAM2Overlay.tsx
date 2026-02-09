// SAM 2 Overlay — renders point prompts and mask preview on top of the canvas
//
// Positioned inside preview-canvas-wrapper, overlaying the WebGPU canvas.
// Left-click = foreground point (green), Right-click = background point (red)
// Displays the live mask as a colored semi-transparent overlay.

import { useRef, useEffect, useCallback } from 'react';
import { useSAM2Store } from '../../stores/sam2Store';
import { getSAM2Service } from '../../services/sam2/SAM2Service';
import type { SAM2Point } from '../../services/sam2/types';

interface SAM2OverlayProps {
  canvasWidth: number;
  canvasHeight: number;
}

const POINT_RADIUS = 6;
const FOREGROUND_COLOR = '#27AE60'; // green
const BACKGROUND_COLOR = '#E74C3C'; // red
const MASK_COLOR = [41, 128, 235]; // blue overlay for mask

export function SAM2Overlay({ canvasWidth, canvasHeight }: SAM2OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const points = useSAM2Store((s) => s.points);
  const liveMask = useSAM2Store((s) => s.liveMask);
  const maskOpacity = useSAM2Store((s) => s.maskOpacity);
  const isProcessing = useSAM2Store((s) => s.isProcessing);
  const modelStatus = useSAM2Store((s) => s.modelStatus);

  // Draw overlay: mask + points
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw mask overlay
    if (liveMask && liveMask.maskData.length > 0) {
      const imageData = ctx.createImageData(liveMask.width, liveMask.height);
      const data = imageData.data;

      for (let i = 0; i < liveMask.maskData.length; i++) {
        const isForeground = liveMask.maskData[i] > 127;
        const offset = i * 4;
        if (isForeground) {
          data[offset] = MASK_COLOR[0];
          data[offset + 1] = MASK_COLOR[1];
          data[offset + 2] = MASK_COLOR[2];
          data[offset + 3] = Math.round(maskOpacity * 180); // semi-transparent
        } else {
          data[offset + 3] = 0; // fully transparent
        }
      }

      // Draw mask scaled to canvas
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = liveMask.width;
      tmpCanvas.height = liveMask.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.putImageData(imageData, 0, 0);

      ctx.drawImage(tmpCanvas, 0, 0, canvasWidth, canvasHeight);
    }

    // Draw points
    for (const pt of points) {
      const x = pt.x * canvasWidth;
      const y = pt.y * canvasHeight;
      const color = pt.label === 1 ? FOREGROUND_COLOR : BACKGROUND_COLOR;

      // Outer circle (white border)
      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();

      // Inner circle (colored)
      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Center dot
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
    }

    // Show processing indicator
    if (isProcessing) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.textAlign = 'left';
      ctx.fillText('Processing...', 8, 16);
    }
  }, [canvasWidth, canvasHeight, points, liveMask, maskOpacity, isProcessing]);

  // Handle clicks — add point and trigger decode
  const handleClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (modelStatus !== 'ready' || isProcessing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    // Normalized 0-1 coordinates
    const x = ((e.clientX - rect.left) * scaleX) / canvasWidth;
    const y = ((e.clientY - rect.top) * scaleY) / canvasHeight;

    // Clamp to 0-1
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));

    // Left click = foreground, right click would need contextmenu handler
    const label: 0 | 1 = 1; // foreground
    const point: SAM2Point = { x: nx, y: ny, label };

    const store = useSAM2Store.getState();
    store.addPoint(point);

    // Trigger decode with all current points
    const allPoints = [...store.points, point];
    const service = getSAM2Service();

    try {
      // First encode frame if needed (check if embedding is ready)
      const { engine } = await import('../../engine/WebGPUEngine');
      if (!engine) return;

      const pixels = await engine.readPixels();
      if (!pixels) return;

      const { width, height } = engine.getOutputDimensions();
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

      // Encode frame (cached if already encoded)
      await service.encodeFrame(imageData, 0);

      // Decode with all points
      await service.decodePrompt(allPoints, [], width, height);
    } catch (err) {
      console.error('SAM2 decode failed:', err);
    }
  }, [canvasWidth, canvasHeight, modelStatus, isProcessing]);

  // Right-click for background point
  const handleContextMenu = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (modelStatus !== 'ready' || isProcessing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const x = ((e.clientX - rect.left) * scaleX) / canvasWidth;
    const y = ((e.clientY - rect.top) * scaleY) / canvasHeight;

    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));

    const point: SAM2Point = { x: nx, y: ny, label: 0 }; // background

    const store = useSAM2Store.getState();
    store.addPoint(point);

    const allPoints = [...store.points, point];
    const service = getSAM2Service();

    try {
      const { engine } = await import('../../engine/WebGPUEngine');
      if (!engine) return;

      const pixels = await engine.readPixels();
      if (!pixels) return;

      const { width, height } = engine.getOutputDimensions();
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

      await service.encodeFrame(imageData, 0);
      await service.decodePrompt(allPoints, [], width, height);
    } catch (err) {
      console.error('SAM2 decode failed:', err);
    }
  }, [canvasWidth, canvasHeight, modelStatus, isProcessing]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      className="sam2-overlay-canvas"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        cursor: modelStatus === 'ready' && !isProcessing ? 'crosshair' : 'default',
        zIndex: 50,
      }}
    />
  );
}
