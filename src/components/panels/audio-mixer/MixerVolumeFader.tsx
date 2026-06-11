import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

type MixerVolumeFaderStyle = CSSProperties & {
  '--audio-mixer-fader-thumb-y'?: string;
};

const DEFAULT_THUMB_HEIGHT = 34;

interface MixerVolumeFaderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  title?: string;
  onBeginDrag: () => void;
  onEndDrag: () => void;
  onChange: (value: number) => void;
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, min: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  const rounded = min + Math.round((value - min) / step) * step;
  return Math.round(rounded * 1000) / 1000;
}

function getValueFromClientY(
  clientY: number,
  rect: DOMRect,
  min: number,
  max: number,
  step: number,
): number {
  const normalized = clamp(1 - ((clientY - rect.top) / Math.max(1, rect.height)), 0, 1);
  return clamp(roundToStep(min + normalized * (max - min), min, step), min, max);
}

function getPositionPercent(value: number, min: number, max: number): number {
  return clamp((value - min) / Math.max(1, max - min), 0, 1) * 100;
}

function getThumbTranslateY(value: number, min: number, max: number, height: number, thumbHeight: number): number {
  const normalized = getPositionPercent(value, min, max) / 100;
  return (1 - normalized) * Math.max(0, Math.max(1, height) - thumbHeight);
}

function readThumbHeight(element: HTMLSpanElement | null, fallback: number): number {
  const measured = element?.offsetHeight ?? 0;
  return measured > 0 ? measured : fallback;
}

export function MixerVolumeFader({
  value,
  min = -60,
  max = 18,
  step = 0.5,
  ariaLabel,
  title,
  onBeginDrag,
  onEndDrag,
  onChange,
  onDoubleClick,
}: MixerVolumeFaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef(false);
  const dragRectRef = useRef<DOMRect | null>(null);
  const thumbHeightRef = useRef(DEFAULT_THUMB_HEIGHT);
  const style: MixerVolumeFaderStyle = {
    '--audio-mixer-fader-thumb-y': '0px',
  };

  const applyVisualValue = useCallback((nextValue: number, rectOverride?: DOMRect) => {
    const root = rootRef.current;
    if (!root) return;
    const height = rectOverride?.height ?? dragRectRef.current?.height ?? root.clientHeight;
    const thumbHeight = readThumbHeight(thumbRef.current, thumbHeightRef.current || DEFAULT_THUMB_HEIGHT);
    thumbHeightRef.current = thumbHeight;
    root.style.setProperty(
      '--audio-mixer-fader-thumb-y',
      `${getThumbTranslateY(nextValue, min, max, height, thumbHeight)}px`,
    );
    root.setAttribute('aria-valuenow', String(nextValue));
    root.setAttribute('data-value', String(nextValue));
  }, [max, min]);

  useEffect(() => {
    if (!draggingRef.current) {
      applyVisualValue(value);
    }
  }, [applyVisualValue, value]);

  const updateFromPointer = useCallback((clientY: number, rectOverride?: DOMRect) => {
    const rect = rectOverride ?? dragRectRef.current ?? rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextValue = getValueFromClientY(clientY, rect, min, max, step);
    applyVisualValue(nextValue, rect);
    onChange(nextValue);
  }, [applyVisualValue, max, min, onChange, step]);

  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    dragRectRef.current = rect;
    thumbHeightRef.current = readThumbHeight(thumbRef.current, thumbHeightRef.current);
    onBeginDrag();
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic debug pointer events do not always create a capturable pointer.
    }
    updateFromPointer(event.clientY, rect);
  }, [onBeginDrag, updateFromPointer]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    updateFromPointer(event.clientY);
  }, [updateFromPointer]);

  const finishPointerDrag = useCallback((event?: PointerEvent) => {
    if (!draggingRef.current) return;
    event?.preventDefault();
    event?.stopPropagation();
    draggingRef.current = false;
    dragRectRef.current = null;
    if (event) {
      const target = event.currentTarget as HTMLDivElement;
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore non-captured synthetic pointers.
      }
    }
    onEndDrag();
  }, [onEndDrag]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    root.addEventListener('pointerdown', handlePointerDown);
    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerup', finishPointerDrag);
    root.addEventListener('pointercancel', finishPointerDrag);
    root.addEventListener('lostpointercapture', finishPointerDrag);
    return () => {
      root.removeEventListener('pointerdown', handlePointerDown);
      root.removeEventListener('pointermove', handlePointerMove);
      root.removeEventListener('pointerup', finishPointerDrag);
      root.removeEventListener('pointercancel', finishPointerDrag);
      root.removeEventListener('lostpointercapture', finishPointerDrag);
    };
  }, [finishPointerDrag, handlePointerDown, handlePointerMove]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | null = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nextValue = value + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        nextValue = value - step;
        break;
      case 'PageUp':
        nextValue = value + step * 4;
        break;
      case 'PageDown':
        nextValue = value - step * 4;
        break;
      case 'Home':
        nextValue = min;
        break;
      case 'End':
        nextValue = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(clamp(roundToStep(nextValue, min, step), min, max));
  }, [max, min, onChange, step, value]);

  return (
    <div
      ref={rootRef}
      className="audio-mixer-strip-fader"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-value={value}
      data-min={min}
      data-max={max}
      data-step={step}
      title={title}
      style={style}
      onBlur={() => {
        if (draggingRef.current) {
          draggingRef.current = false;
          dragRectRef.current = null;
          onEndDrag();
        }
      }}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
    >
      <span className="audio-mixer-strip-fader-rail" aria-hidden="true" />
      <span ref={thumbRef} className="audio-mixer-strip-fader-thumb" aria-hidden="true" />
    </div>
  );
}
