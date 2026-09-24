import { useEffect, useMemo, useRef, useState } from 'react';
import type { SurfaceDecodedFrame } from '../../../services/planarTracking/surfaceFrameReader';
import { refineRotoEdges, type RotoEdges } from '../../../services/roto/rotoEdges';
import type { RotoMask, RotoPoint } from '../../../services/roto/rotoTypes';

interface Props {
  frame: SurfaceDecodedFrame;
  mask?: RotoMask;
  points: RotoPoint[];
  edges: RotoEdges;
  view: string;
  zoom: number;
  label: 0 | 1;
  disabled: boolean;
  onPoint: (point: RotoPoint) => void;
}

export function RotoPreview({ frame, mask, points, edges, view, zoom, label, disabled, onPoint }: Props) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(300), [cursor, setCursor] = useState({ x: .5, y: .5 });
  const [keyboard, setKeyboard] = useState(false);
  const pointer = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const pixels = frame.pixels;
  const fit = Math.max(.001, Math.min(width / pixels.width, 420 / pixels.height, 1));
  const alpha = useMemo(() => mask?.time === frame.time ? refineRotoEdges(mask, edges) : undefined, [mask, frame.time, edges]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const target = canvas.current; if (!target) return;
    target.width = pixels.width; target.height = pixels.height;
    const context = target.getContext('2d')!;
    const rendered = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    for (let i = 0; i < pixels.width * pixels.height; i++) {
      const value = alpha?.[i] ?? 0, coverage = value / 255;
      if (view === 'mask') rendered.data[4 * i] = rendered.data[4 * i + 1] = rendered.data[4 * i + 2] = value;
      else if (view === 'cutout') {
        const shade = ((Math.floor((i % pixels.width) / 16) + Math.floor(i / pixels.width / 16)) % 2) ? 45 : 65;
        for (let c = 0; c < 3; c++) rendered.data[4 * i + c] = rendered.data[4 * i + c] * coverage + shade * (1 - coverage);
      } else if (view === 'overlay') {
        rendered.data[4 * i] *= 1 - .45 * coverage;
        rendered.data[4 * i + 1] = rendered.data[4 * i + 1] * (1 - .45 * coverage) + 60 * coverage;
        rendered.data[4 * i + 2] = rendered.data[4 * i + 2] * (1 - .45 * coverage) + 110 * coverage;
      }
      rendered.data[4 * i + 3] = 255;
    }
    context.putImageData(rendered, 0, 0);
    if (view === 'overlay') for (const point of points) {
      context.beginPath(); context.arc(point.x * pixels.width, point.y * pixels.height, 4 / (fit * zoom), 0, 2 * Math.PI);
      context.fillStyle = point.label ? '#27ae60' : '#e74c3c'; context.fill();
      context.strokeStyle = 'white'; context.lineWidth = 1 / (fit * zoom); context.stroke();
    }
    if (keyboard) {
      const x = cursor.x * pixels.width, y = cursor.y * pixels.height, r = 8 / (fit * zoom);
      context.beginPath(); context.moveTo(x - r, y); context.lineTo(x + r, y); context.moveTo(x, y - r); context.lineTo(x, y + r);
      context.strokeStyle = '#fff'; context.lineWidth = 2 / (fit * zoom); context.stroke();
    }
  }, [pixels, alpha, view, points, keyboard, cursor, fit, zoom]);
  return <div className="roto-preview-viewport" ref={viewport}>
    <canvas ref={canvas} aria-label="Roto source selection" tabIndex={0} aria-disabled={disabled}
      aria-description="Arrow keys move the selection cursor. Enter adds a point. Control or Command plus Enter excludes."
      style={{ width: pixels.width * fit * zoom, height: pixels.height * fit * zoom }}
      onBlur={() => setKeyboard(false)} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (event.pointerType !== 'touch') event.preventDefault();
        setKeyboard(false); event.currentTarget.blur();
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerCancel={() => { pointer.current = undefined; }} onPointerUp={event => {
        const start = pointer.current; pointer.current = undefined;
        if (disabled || !start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onPoint({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
          label: event.button === 2 || event.ctrlKey || event.metaKey ? 0 : label });
      }} onKeyDown={event => {
        if (event.key === 'Tab') return;
        const step = event.shiftKey ? 10 : 1;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); setKeyboard(true);
          setCursor(p => ({ x: Math.max(0, Math.min(1, p.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) / pixels.width)),
            y: Math.max(0, Math.min(1, p.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) / pixels.height)) }));
        } else if (event.key === 'Enter' && !disabled) {
          event.preventDefault(); onPoint({ ...cursor, label: event.ctrlKey || event.metaKey ? 0 : label });
        }
      }} />
  </div>;
}
