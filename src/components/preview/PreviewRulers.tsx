import { useEffect, useMemo, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { clearCompositionGuides } from '../../services/compositionGuides';
import { useMediaStore } from '../../stores/mediaStore';
import { computeRulerTicks } from './previewRulerTicks';
import { PreviewGuides } from './PreviewGuides';
import type { GuideViewport } from './previewGuideMath';
import { usePreviewGuideDrag } from './usePreviewGuideDrag';
import './PreviewRulers.css';

export const PREVIEW_RULER_SIZE = 18;

interface PreviewRulersProps {
  /** Screen rect of the composition inside the preview, in CSS pixels. */
  canvasInContainer: { x: number; y: number; width: number; height: number };
  containerSize: { width: number; height: number };
  compositionWidth: number;
  compositionHeight: number;
  /** Composition whose guides are shown and edited; null disables guides. */
  compositionId: string | null;
}

/**
 * Photoshop-style pixel rulers along the top and left preview edges, in
 * composition pixels. Dragging out of a ruler creates a guide.
 */
export function PreviewRulers({ canvasInContainer, containerSize, compositionWidth, compositionHeight, compositionId }: PreviewRulersProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const guides = useMediaStore((state) => (
    compositionId ? state.compositions.find((composition) => composition.id === compositionId)?.guides : undefined
  ));
  const viewport = useMemo<GuideViewport>(() => ({
    canvasInContainer,
    containerSize,
    compositionWidth,
    compositionHeight,
  }), [canvasInContainer, compositionHeight, compositionWidth, containerSize]);
  const { drag, startCreate, startMove } = usePreviewGuideDrag({
    rootRef,
    compositionId,
    viewport,
    rulerSize: PREVIEW_RULER_SIZE,
  });
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
    const root = rootRef.current;
    // The parent can be `display: contents` with an empty rect, so measure
    // against the rulers' own box, which covers the preview container.
    const host = root?.parentElement;
    if (!root || !host) return;
    const move = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
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
  const marker = drag?.pointer ?? pointer;
  const guidesEditable = compositionId !== null;
  const guideCount = guides?.length ?? 0;

  return (
    <div className="preview-rulers" ref={rootRef}>
      {compositionId && (
        <PreviewGuides compositionId={compositionId} drag={drag} guides={guides ?? []} onStartMove={startMove} viewport={viewport} />
      )}
      <svg
        aria-hidden="true"
        className={`preview-ruler preview-ruler-horizontal${guidesEditable ? ' guide-source' : ''}`}
        height={size}
        onPointerDown={guidesEditable ? (event) => startCreate(event, 'horizontal') : undefined}
        width={containerSize.width}
      >
        <title>Drag down to add a horizontal guide</title>
        <rect className="preview-ruler-canvas-span" height={size} width={Math.max(0, canvasInContainer.width)} x={canvasInContainer.x} y={0} />
        {horizontal.map((tick) => (
          <g key={tick.value}>
            <line x1={tick.offset} x2={tick.offset} y1={tick.major ? 0 : size * 0.65} y2={size} />
            {tick.major && <text x={tick.offset + 3} y={9}>{tick.value}</text>}
          </g>
        ))}
        {marker && <line className="preview-ruler-pointer" x1={marker.x} x2={marker.x} y1={0} y2={size} />}
      </svg>
      <svg
        aria-hidden="true"
        className={`preview-ruler preview-ruler-vertical${guidesEditable ? ' guide-source' : ''}`}
        height={containerSize.height}
        onPointerDown={guidesEditable ? (event) => startCreate(event, 'vertical') : undefined}
        width={size}
      >
        <title>Drag right to add a vertical guide</title>
        <rect className="preview-ruler-canvas-span" height={Math.max(0, canvasInContainer.height)} width={size} x={0} y={canvasInContainer.y} />
        {vertical.map((tick) => (
          <g key={tick.value}>
            <line x1={tick.major ? 0 : size * 0.65} x2={size} y1={tick.offset} y2={tick.offset} />
            {tick.major && (
              <text transform={`translate(9 ${tick.offset + 3}) rotate(-90)`} textAnchor="end">{tick.value}</text>
            )}
          </g>
        ))}
        {marker && <line className="preview-ruler-pointer" x1={0} x2={size} y1={marker.y} y2={marker.y} />}
      </svg>
      {guideCount > 0 && compositionId ? (
        <button
          aria-label={`Clear ${guideCount} guide${guideCount === 1 ? '' : 's'}`}
          className="preview-ruler-corner preview-ruler-clear"
          onClick={() => clearCompositionGuides(compositionId)}
          title="Clear guides"
          type="button"
        >
          <IconX aria-hidden="true" size={11} stroke={2} />
        </button>
      ) : (
        <div aria-hidden="true" className="preview-ruler-corner" />
      )}
    </div>
  );
}
