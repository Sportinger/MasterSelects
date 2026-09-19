import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

const THUMB_WIDTH_PX = 7;
const FINE_POINTER_HIT_RADIUS_PX = 6;
const COARSE_POINTER_HIT_RADIUS_PX = 22;

interface DragState {
  pointerId: number;
  removeWindowListeners: () => void;
  startClientX: number;
  startValue: number;
}

interface HandleOnlyRangeProps {
  'aria-label': string;
  disabled?: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  onDragEnd?: () => void;
  onDragStart?: () => void;
  step: number;
  value: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return clamp(value, min, max);
  const stepped = min + Math.round((value - min) / step) * step;
  return clamp(Number(stepped.toFixed(10)), min, max);
}

function thumbCenterX(slider: HTMLElement, value: number, min: number, max: number): number {
  const rect = slider.getBoundingClientRect();
  const range = max - min;
  const ratio = range > 0 ? clamp((value - min) / range, 0, 1) : 0;
  const usableWidth = Math.max(0, rect.width - THUMB_WIDTH_PX);
  return rect.left + THUMB_WIDTH_PX / 2 + ratio * usableWidth;
}

/**
 * Native range input with deterministic pointer handling. A drag can only
 * begin on the current thumb, so tapping the track never jumps the value.
 */
export function HandleOnlyRange({
  disabled = false,
  max,
  min,
  onChange,
  onDragEnd,
  onDragStart,
  step,
  value,
  ...ariaProps
}: HandleOnlyRangeProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  const onDragEndRef = useRef(onDragEnd);
  onChangeRef.current = onChange;
  onDragEndRef.current = onDragEnd;

  useEffect(() => () => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    dragState.removeWindowListeners();
    dragStateRef.current = null;
    onDragEndRef.current?.();
  }, []);

  const clampedValue = clamp(value, min, max);
  const range = max - min;
  const valueRatio = range > 0 ? (clampedValue - min) / range : 0;
  const sliderStyle = {
    '--handle-only-range-position': `${valueRatio * 100}%`,
  } as CSSProperties;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | null = null;
    const increment = step * (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue = clampedValue - increment;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue = clampedValue + increment;
    if (event.key === 'Home') nextValue = min;
    if (event.key === 'End') nextValue = max;
    if (nextValue === null) return;
    event.preventDefault();
    onChange(roundToStep(nextValue, min, max, step));
  };

  return (
    <div
      {...ariaProps}
      ref={sliderRef}
      aria-disabled={disabled || undefined}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={clampedValue}
      className="handle-only-range"
      data-dock-tab-swipe-ignore="true"
      data-touch-dragging={isTouchDragging ? 'true' : undefined}
      onClick={event => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onPointerDown={event => {
        if (disabled || dragStateRef.current || event.button !== 0 || event.isPrimary === false) return;

        const hitRadius = event.pointerType === 'touch' || event.pointerType === 'pen'
          ? COARSE_POINTER_HIT_RADIUS_PX
          : FINE_POINTER_HIT_RADIUS_PX;
        const isOnHandle = Math.abs(event.clientX - thumbCenterX(event.currentTarget, clampedValue, min, max)) <= hitRadius;

        // Suppress the native range behavior both on the track and on the
        // thumb. The custom drag below avoids the browser's track-jump first.
        event.preventDefault();
        if (!isOnHandle) return;

        const ownerWindow = event.currentTarget.ownerDocument.defaultView ?? window;
        const dragState: DragState = {
          pointerId: event.pointerId,
          removeWindowListeners: () => undefined,
          startClientX: event.clientX,
          startValue: clampedValue,
        };
        const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
          if (dragStateRef.current !== dragState || pointerEvent.pointerId !== dragState.pointerId) return;
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();

          const slider = sliderRef.current;
          if (!slider) return;
          const usableWidth = Math.max(1, slider.getBoundingClientRect().width - THUMB_WIDTH_PX);
          const nextValue = dragState.startValue
            + ((pointerEvent.clientX - dragState.startClientX) / usableWidth) * (max - min);
          onChangeRef.current(roundToStep(nextValue, min, max, step));
        };
        const finishDrag = (pointerEvent?: globalThis.PointerEvent) => {
          if (dragStateRef.current !== dragState) return;
          if (pointerEvent && pointerEvent.pointerId !== dragState.pointerId) return;
          if (pointerEvent) {
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();
          }
          dragState.removeWindowListeners();
          dragStateRef.current = null;
          setIsTouchDragging(false);
          onDragEndRef.current?.();
        };
        const handleWindowBlur = () => finishDrag();
        dragState.removeWindowListeners = () => {
          ownerWindow.removeEventListener('pointermove', handlePointerMove, true);
          ownerWindow.removeEventListener('pointerup', finishDrag, true);
          ownerWindow.removeEventListener('pointercancel', finishDrag, true);
          ownerWindow.removeEventListener('blur', handleWindowBlur);
        };
        ownerWindow.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
        ownerWindow.addEventListener('pointerup', finishDrag, { capture: true, passive: false });
        ownerWindow.addEventListener('pointercancel', finishDrag, { capture: true, passive: false });
        ownerWindow.addEventListener('blur', handleWindowBlur);
        dragStateRef.current = dragState;
        setIsTouchDragging(event.pointerType === 'touch');
        onDragStart?.();
      }}
      role="slider"
      style={sliderStyle}
      tabIndex={disabled ? -1 : 0}
    >
      <span aria-hidden="true" className="handle-only-range-track">
        <span className="handle-only-range-thumb" />
      </span>
    </div>
  );
}
