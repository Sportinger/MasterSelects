import { useEffect, useMemo, useRef, useState } from 'react';
import { computeRulerTicks } from './previewRulerTicks';
import './PreviewRulers.css';

export const PREVIEW_RULER_SIZE = 18;

interface PreviewRulersProps {
  /** Screen rect of the composition inside the preview, in CSS pixels. */
  canvasInContainer: { x: number; y: number; width: number; height: number };
  containerSize: { width: number; height: number };
  compositionWidth: number;
  compositionHeight: number;
}

/** Photoshop-style pixel rulers along the top and left preview edges, in composition pixels. */
export function PreviewRulers({ canvasInContainer, containerSize, compositionWidth, compositionHeight }: PreviewRulersProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const scaleX = compositionWidth > 0 ? canvasInContainer.width / compositionWidth : 0;
  const scaleY = compositionHeight > 0 ? canvasInContainer.height / compositionHeight : 0;
  const horizontal = useMemo(
    () => computeRulerTicks(canvasInContainer.x, scaleX, containerSize.width),
    [canvasInContainer.x, containerSize.width, scaleX],
  );
  const vertical = useMemo(
    () => computeRulerTicks(canvasInContainer.y, scaleY, containerSize.height),
    [canvasInContainer.y, containerSize.height, scaleY],
  );

  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const leave = () => setPointer(null);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);

  if (!(scaleX > 0 && scaleY > 0)) return null;
  const size = PREVIEW_RULER_SIZE;

  return (
    <div aria-hidden="true" className="preview-rulers" ref={rootRef}>
      <svg className="preview-ruler preview-ruler-horizontal" height={size} width={containerSize.width}>
        <rect className="preview-ruler-canvas-span" height={size} width={Math.max(0, canvasInContainer.width)} x={canvasInContainer.x} y={0} />
        {horizontal.map((tick) => (
          <g key={tick.value}>
            <line x1={tick.offset} x2={tick.offset} y1={tick.major ? 0 : size * 0.65} y2={size} />
            {tick.major && <text x={tick.offset + 3} y={9}>{tick.value}</text>}
          </g>
        ))}
        {pointer && <line className="preview-ruler-pointer" x1={pointer.x} x2={pointer.x} y1={0} y2={size} />}
      </svg>
      <svg className="preview-ruler preview-ruler-vertical" height={containerSize.height} width={size}>
        <rect className="preview-ruler-canvas-span" height={Math.max(0, canvasInContainer.height)} width={size} x={0} y={canvasInContainer.y} />
        {vertical.map((tick) => (
          <g key={tick.value}>
            <line x1={tick.major ? 0 : size * 0.65} x2={size} y1={tick.offset} y2={tick.offset} />
            {tick.major && (
              <text transform={`translate(9 ${tick.offset + 3}) rotate(-90)`} textAnchor="end">{tick.value}</text>
            )}
          </g>
        ))}
        {pointer && <line className="preview-ruler-pointer" x1={0} x2={size} y1={pointer.y} y2={pointer.y} />}
      </svg>
      <div className="preview-ruler-corner" />
    </div>
  );
}
