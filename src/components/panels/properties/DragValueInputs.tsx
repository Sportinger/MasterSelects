// Pointer-drag value input primitives for Properties Panel tabs:
// a pointer-locked precision slider and the legacy drag-to-scrub number.
import { useRef, useCallback } from 'react';

// Precision slider with modifier key support
interface PrecisionSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function PrecisionSlider({ min, max, step: _step, value, onChange, defaultValue, onDragStart, onDragEnd }: PrecisionSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const accumulatedDelta = useRef(0);
  const startValue = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    accumulatedDelta.current = 0;
    startValue.current = value;
    onDragStart?.();

    const element = sliderRef.current;
    if (element) element.requestPointerLock();

    const handleMouseMove = (e: MouseEvent) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const range = max - min;
      const pixelsPerUnit = rect.width / range;
      let speedMultiplier = 1;
      if (e.ctrlKey) speedMultiplier = 0.01;
      else if (e.shiftKey) speedMultiplier = 0.1;

      accumulatedDelta.current += e.movementX * speedMultiplier;
      const deltaValue = accumulatedDelta.current / pixelsPerUnit;
      const newValue = Math.max(min, Math.min(max, startValue.current + deltaValue));
      const preciseValue = Math.round(newValue * 1000000) / 1000000;
      onChange(preciseValue);
    };

    const handleMouseUp = () => {
      document.exitPointerLock();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      onDragEnd?.();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [value, min, max, onChange, onDragStart, onDragEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue !== undefined) onChange(defaultValue);
  }, [defaultValue, onChange]);

  const fillPercent = ((value - min) / (max - min)) * 100;

  return (
    <div
      ref={sliderRef}
      className="precision-slider"
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={defaultValue !== undefined ? "Right-click to reset to default" : undefined}
    >
      <div className="precision-slider-track">
        <div className="precision-slider-fill" style={{ width: `${fillPercent}%` }} />
        <div className="precision-slider-thumb" style={{ left: `${fillPercent}%` }} />
      </div>
    </div>
  );
}

// Draggable number input
interface LegacyDraggableNumberProps {
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  sensitivity?: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function LegacyDraggableNumber({ value, onChange, defaultValue, sensitivity = 2, decimals = 2, suffix = '', min, max, onDragStart, onDragEnd }: LegacyDraggableNumberProps) {
  const inputRef = useRef<HTMLSpanElement>(null);
  const accumulatedDelta = useRef(0);
  const startValue = useRef(0);
  const lastClientX = useRef(0);
  const hasPointerLock = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    accumulatedDelta.current = 0;
    startValue.current = value;
    lastClientX.current = e.clientX;
    hasPointerLock.current = false;
    onDragStart?.();

    // Try pointer lock (hides cursor, infinite drag range) — but don't rely on it
    const element = inputRef.current;
    if (element) {
      try {
        const result = element.requestPointerLock();
        // Modern browsers return a Promise
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(
            () => { hasPointerLock.current = true; },
            () => { hasPointerLock.current = false; },
          );
        } else {
          // Older browsers: check synchronously after a tick
          requestAnimationFrame(() => {
            hasPointerLock.current = document.pointerLockElement === element;
          });
        }
      } catch {
        hasPointerLock.current = false;
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      let speedMultiplier = 1;
      if (e.ctrlKey) speedMultiplier = 0.01;
      else if (e.shiftKey) speedMultiplier = 0.1;

      // Use movementX when pointer lock is active, clientX delta as fallback
      let dx: number;
      if (hasPointerLock.current && document.pointerLockElement) {
        dx = e.movementX;
      } else {
        dx = e.clientX - lastClientX.current;
        lastClientX.current = e.clientX;
      }

      accumulatedDelta.current += dx * speedMultiplier;
      const deltaValue = accumulatedDelta.current / sensitivity;
      let newValue = startValue.current + deltaValue;
      // Clamp to min/max if specified
      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);
      const preciseValue = Math.round(newValue * Math.pow(10, decimals + 2)) / Math.pow(10, decimals + 2);
      onChange(preciseValue);
    };

    const handleMouseUp = () => {
      if (hasPointerLock.current || document.pointerLockElement) {
        document.exitPointerLock();
      }
      hasPointerLock.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      onDragEnd?.();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [value, sensitivity, decimals, onChange, min, max, onDragStart, onDragEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (defaultValue !== undefined) onChange(defaultValue);
  }, [defaultValue, onChange]);

  return (
    <span
      ref={inputRef}
      className="draggable-number"
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={defaultValue !== undefined ? "Drag to change, right-click to reset" : "Drag to change"}
    >
      {value.toFixed(decimals)}{suffix}
    </span>
  );
}
