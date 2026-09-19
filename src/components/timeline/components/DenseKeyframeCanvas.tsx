import { useEffect, useRef, type MouseEvent } from 'react';
import { nearestKeyframeMarker } from '../utils/visibleKeyframeMarkers';

export interface DenseKeyframeMarker<T> {
  x: number; id: string; data: T; title: string; selected: boolean; dragging: boolean; stateChange: boolean;
}
interface Props<T> {
  markers: DenseKeyframeMarker<T>[]; left: number; width: number; highlighted: boolean;
  onDown: (event: MouseEvent, data: T) => void;
  onContext: (event: MouseEvent, data: T) => void;
  onDoubleClick: (event: MouseEvent) => void;
  onHover: (hovered: boolean) => void;
}
/** A small main-thread 2D surface; every visible source key is drawn and hit-tested. */
export function DenseKeyframeCanvas<T>({ markers, left, width, highlighted, onDown, onContext, onDoubleClick, onHover }: Props<T>) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const height = canvas.clientHeight || 20, cssWidth = Math.max(1, width);
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / cssWidth);
      canvas.width = Math.max(1, Math.round(cssWidth * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(canvas);
      const amber = style.getPropertyValue('--amber-600').trim() || '#d97706';
      const red = style.getPropertyValue('--red-500').trim() || '#ef4444';
      const cyan = style.getPropertyValue('--cyan-500').trim() || '#06b6d4';
      // Selected points are drawn last, but no overlapping point is omitted.
      for (const selectedPass of [false, true]) for (const marker of markers) {
        if ((marker.selected || marker.dragging) !== selectedPass) continue;
        const x = marker.x - left, y = height / 2, size = marker.dragging ? 6 : 4;
        context.fillStyle = marker.dragging || marker.stateChange ? cyan : marker.selected ? red : highlighted ? '#fbbf24' : amber;
        context.beginPath(); context.moveTo(x, y - size); context.lineTo(x + size, y);
        context.lineTo(x, y + size); context.lineTo(x - size, y); context.closePath(); context.fill();
      }
    };
    draw();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [markers, left, width, highlighted]);
  const hit = (event: MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (Math.abs(event.clientY - bounds.top - bounds.height / 2) > 9) return;
    return nearestKeyframeMarker(markers, event.clientX - bounds.left + left);
  };
  return <canvas ref={ref} className="dense-keyframe-canvas" role="img" aria-label={`${markers.length} keyframes; drag a point to move, right-click for options`}
    data-marker-count={markers.length} style={{ position: 'absolute', left, top: 0, width, height: '100%', zIndex: 5 }}
    onMouseDown={event => { const marker = hit(event); if (marker) onDown(event, marker.data); }}
    onDoubleClick={event => { if (hit(event)) onDoubleClick(event); }}
    onContextMenu={event => { const marker = hit(event); if (marker) onContext(event, marker.data); }}
    onMouseMove={event => { const marker = hit(event); event.currentTarget.title = marker?.title ?? ''; event.currentTarget.style.cursor = marker ? 'pointer' : ''; }}
    onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} />;
}
