import { useRef, useEffect } from 'react';

interface VectorscopeScopeProps {
  data: ImageData | null;
}

// BT.709 color target angles (degrees) and labels
// These are the standard vectorscope positions for 75% color bars
const COLOR_TARGETS = [
  { label: 'R', angle: 103, color: 'rgba(255, 80, 80, 0.7)' },
  { label: 'MG', angle: 61, color: 'rgba(255, 80, 255, 0.7)' },
  { label: 'B', angle: 347, color: 'rgba(80, 80, 255, 0.7)' },
  { label: 'CY', angle: 283, color: 'rgba(80, 255, 255, 0.7)' },
  { label: 'G', angle: 241, color: 'rgba(80, 255, 80, 0.7)' },
  { label: 'YL', angle: 167, color: 'rgba(255, 255, 80, 0.7)' },
];

const SKIN_TONE_ANGLE = 123; // I-axis, degrees

export function VectorscopeScope({ data }: VectorscopeScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const s = Math.min(width, height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = s * dpr;
      canvas.height = s * dpr;
      canvas.style.width = `${s}px`;
      canvas.style.height = `${s}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw vectorscope
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(w, h);
    const center = size / 2;
    const radius = center * 0.85;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Draw data first (behind graticule)
    if (data) {
      // Scale the vectorscope ImageData to fit the canvas
      const offscreen = new OffscreenCanvas(data.width, data.height);
      const offCtx = offscreen.getContext('2d')!;
      offCtx.putImageData(data, 0, 0);

      // Map the 256x256 data image into the circular area
      const destSize = radius * 2;
      const destX = center - radius;
      const destY = center - radius;
      ctx.drawImage(offscreen, destX, destY, destSize, destSize);
    }

    // Graticule
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = dpr;

    // Outer circle (75% saturation)
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle (25% saturation)
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.25, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(center - radius, center);
    ctx.lineTo(center + radius, center);
    ctx.moveTo(center, center - radius);
    ctx.lineTo(center, center + radius);
    ctx.stroke();

    // Skin tone line
    const skinRad = (SKIN_TONE_ANGLE - 90) * (Math.PI / 180);
    ctx.strokeStyle = 'rgba(255, 180, 100, 0.25)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(
      center + Math.cos(skinRad) * radius,
      center - Math.sin(skinRad) * radius
    );
    ctx.stroke();

    // Color target boxes
    const boxSize = 8 * dpr;
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const target of COLOR_TARGETS) {
      const rad = (target.angle - 90) * (Math.PI / 180);
      const dist = radius * 0.75;
      const x = center + Math.cos(rad) * dist;
      const y = center - Math.sin(rad) * dist;

      ctx.strokeStyle = target.color;
      ctx.lineWidth = dpr;
      ctx.strokeRect(x - boxSize / 2, y - boxSize / 2, boxSize, boxSize);

      // Label slightly outside
      const labelDist = radius * 0.9;
      const lx = center + Math.cos(rad) * labelDist;
      const ly = center - Math.sin(rad) * labelDist;
      ctx.fillStyle = target.color;
      ctx.fillText(target.label, lx, ly);
    }
  }, [data]);

  return (
    <div ref={containerRef} className="scope-canvas-container vectorscope-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
