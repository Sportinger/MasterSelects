import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const SETTINGS_STORAGE_PREFIX = 'editable-draggable-number-settings:';
const LEGACY_BOUNDS_STORAGE_PREFIX = 'editable-draggable-number-bounds:';

interface PersistedSettings {
  min?: number;
  max?: number;
  defaultValue?: number;
}

interface PopoverPlacement {
  top: number;
  left: number;
  transformOrigin: string;
  visibility: 'hidden' | 'visible';
}

export interface EditableDraggableNumberProps {
  value: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  sensitivity?: number;
  decimals?: number;
  suffix?: string;
  min?: number;
  max?: number;
  persistenceKey?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

function clampValue(value: number, min?: number, max?: number): number {
  let nextValue = value;
  if (min !== undefined) nextValue = Math.max(min, nextValue);
  if (max !== undefined) nextValue = Math.min(max, nextValue);
  return nextValue;
}

function getAdaptiveRange(value: number, min?: number, max?: number): number {
  if (
    min !== undefined &&
    max !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max > min
  ) {
    return max - min;
  }

  return Math.max(Math.abs(value), 1) * 4;
}

function getPixelsForFullRange(range: number): number {
  return Math.min(12000, Math.max(700, Math.sqrt(Math.max(range, 1)) * 180));
}

function getPerPixelStep(value: number, sensitivity: number, decimals: number, min?: number, max?: number): number {
  const range = getAdaptiveRange(value, min, max);
  const pixelsForFullRange = getPixelsForFullRange(range);
  const baseStep = range / pixelsForFullRange;
  const sensitivityFactor = Math.max(1, 1 + sensitivity);
  const precisionFloor = Math.pow(10, -Math.max(decimals, 0)) * 0.1;
  return Math.max(precisionFloor, baseStep / sensitivityFactor);
}

function formatEditableValue(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function roundValue(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals + 2);
  return Math.round(value * factor) / factor;
}

function parseOptionalNumber(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.');
  if (normalized.length === 0) return undefined;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function loadPersistedSettings(persistenceKey?: string): PersistedSettings | null {
  if (!persistenceKey) return null;
  try {
    const raw = localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`);
    const legacyRaw = localStorage.getItem(`${LEGACY_BOUNDS_STORAGE_PREFIX}${persistenceKey}`);
    const source = raw ?? legacyRaw;
    if (!source) return null;
    const parsed = JSON.parse(source) as PersistedSettings;
    return {
      min: Number.isFinite(parsed.min) ? parsed.min : undefined,
      max: Number.isFinite(parsed.max) ? parsed.max : undefined,
      defaultValue: Number.isFinite(parsed.defaultValue) ? parsed.defaultValue : undefined,
    };
  } catch {
    return null;
  }
}

function savePersistedSettings(persistenceKey: string, settings: PersistedSettings): void {
  localStorage.setItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`, JSON.stringify(settings));
}

function clearPersistedSettings(persistenceKey: string): void {
  localStorage.removeItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`);
}

export function EditableDraggableNumber({
  value,
  onChange,
  defaultValue,
  sensitivity = 2,
  decimals = 2,
  suffix = '',
  min,
  max,
  persistenceKey,
  onDragStart,
  onDragEnd,
}: EditableDraggableNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const accumulatedDelta = useRef(0);
  const rawDragDistance = useRef(0);
  const startValue = useRef(0);
  const lastClientX = useRef(0);
  const dragStarted = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(() => formatEditableValue(value, decimals));
  const [draftDefaultValue, setDraftDefaultValue] = useState('');
  const [showBoundsPopover, setShowBoundsPopover] = useState(false);
  const [draftMin, setDraftMin] = useState('');
  const [draftMax, setDraftMax] = useState('');
  const [persistedSettings, setPersistedSettings] = useState<PersistedSettings | null>(() => loadPersistedSettings(persistenceKey));
  const [popoverPlacement, setPopoverPlacement] = useState<PopoverPlacement>({
    top: 0,
    left: 0,
    transformOrigin: 'center bottom',
    visibility: 'hidden',
  });

  useEffect(() => {
    setPersistedSettings(loadPersistedSettings(persistenceKey));
  }, [persistenceKey]);

  const effectiveMin = persistedSettings?.min ?? min;
  const effectiveMax = persistedSettings?.max ?? max;
  const effectiveDefaultValue = persistedSettings?.defaultValue ?? defaultValue;

  const controlTitle = useMemo(() => {
    const parts = ['Drag to change', 'Shift-drag coarse', 'Ctrl-drag fine', 'double-click to type'];
    if (effectiveDefaultValue !== undefined) {
      parts.push('right-click to default');
    }
    parts.push('middle-click for range');
    return parts.join(', ');
  }, [effectiveDefaultValue]);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatEditableValue(value, decimals));
    }
  }, [decimals, isEditing, value]);

  useEffect(() => {
    if (!isEditing) return;
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isEditing]);

  const syncBoundsDraft = useCallback(() => {
    setDraftDefaultValue(
      effectiveDefaultValue !== undefined
        ? formatEditableValue(effectiveDefaultValue, decimals)
        : '',
    );
    setDraftMin(effectiveMin !== undefined ? String(effectiveMin) : '');
    setDraftMax(effectiveMax !== undefined ? String(effectiveMax) : '');
  }, [decimals, effectiveDefaultValue, effectiveMax, effectiveMin]);

  const openBoundsPopover = useCallback(() => {
    setIsEditing(false);
    syncBoundsDraft();
    setShowBoundsPopover(true);
  }, [syncBoundsDraft]);

  useEffect(() => {
    setDraftDefaultValue(
      effectiveDefaultValue !== undefined
        ? formatEditableValue(effectiveDefaultValue, decimals)
        : '',
    );
  }, [decimals, effectiveDefaultValue]);

  useEffect(() => {
    if (!showBoundsPopover) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (rootRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) {
        return;
      }
      setShowBoundsPopover(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showBoundsPopover]);

  const updatePopoverPlacement = useCallback(() => {
    const anchor = rootRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth;
    const popoverHeight = popover.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const gap = 6;

    let left = anchorRect.left + (anchorRect.width / 2) - (popoverWidth / 2);
    left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin));

    let top = anchorRect.top - popoverHeight - gap;
    let transformOrigin = 'center bottom';

    if (top < margin) {
      top = anchorRect.bottom + gap;
      transformOrigin = 'center top';
    }

    if (top + popoverHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - popoverHeight - margin);
    }

    setPopoverPlacement({
      top,
      left,
      transformOrigin,
      visibility: 'visible',
    });
  }, []);

  useEffect(() => {
    if (!showBoundsPopover) return;

    setPopoverPlacement((current) => ({ ...current, visibility: 'hidden' }));
    const rafId = window.requestAnimationFrame(updatePopoverPlacement);

    const handleViewportChange = () => {
      updatePopoverPlacement();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [showBoundsPopover, updatePopoverPlacement]);

  const readDragDeltaX = useCallback((event: MouseEvent) => {
    const dx = event.clientX - lastClientX.current;
    lastClientX.current = event.clientX;
    return dx;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isEditing) return;
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      openBoundsPopover();
      return;
    }
    if (showBoundsPopover || e.button !== 0) return;
    e.preventDefault();

    accumulatedDelta.current = 0;
    rawDragDistance.current = 0;
    startValue.current = value;
    lastClientX.current = e.clientX;
    dragStarted.current = false;

    const handleMouseMove = (event: MouseEvent) => {
      if ((event.buttons & 1) !== 1) {
        handleMouseUp();
        return;
      }

      const dx = readDragDeltaX(event);

      if (!dragStarted.current) {
        rawDragDistance.current += dx;
        if (Math.abs(rawDragDistance.current) < 2) {
          return;
        }
        dragStarted.current = true;
        onDragStart?.();
      }

      if (dx === 0) {
        return;
      }

      let modifierMultiplier = 1;
      if (event.shiftKey) modifierMultiplier = 10;
      else if (event.ctrlKey) modifierMultiplier = 0.1;

      accumulatedDelta.current += dx * modifierMultiplier;
      const perPixelStep = getPerPixelStep(startValue.current, sensitivity, decimals, effectiveMin, effectiveMax);
      const deltaValue = accumulatedDelta.current * perPixelStep;
      const unclampedValue = startValue.current + deltaValue;
      const nextValue = clampValue(unclampedValue, effectiveMin, effectiveMax);
      const preciseValue = roundValue(nextValue, decimals);
      onChange(preciseValue);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (dragStarted.current) {
        onDragEnd?.();
      }
      dragStarted.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [
    decimals,
    effectiveMax,
    effectiveMin,
    onChange,
    onDragEnd,
    onDragStart,
    openBoundsPopover,
    readDragDeltaX,
    sensitivity,
    showBoundsPopover,
    isEditing,
    value,
  ]);

  const applyBoundsDraft = useCallback(() => {
    const nextDefaultValueInput = parseOptionalNumber(draftDefaultValue);
    const nextMin = parseOptionalNumber(draftMin);
    const nextMax = parseOptionalNumber(draftMax);

    if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax) {
      return;
    }

    const nextDefaultValue = nextDefaultValueInput !== undefined
      ? clampValue(nextDefaultValueInput, nextMin, nextMax)
      : undefined;

    const nextSettings: PersistedSettings = {
      min: nextMin,
      max: nextMax,
      defaultValue: nextDefaultValue,
    };

    setPersistedSettings(nextSettings);
    if (persistenceKey) {
      savePersistedSettings(persistenceKey, nextSettings);
    }

    const clampedCurrent = clampValue(value, nextSettings.min, nextSettings.max);
    const roundedValue = roundValue(clampedCurrent, decimals);
    if (roundedValue !== value) {
      onChange(roundedValue);
    }

    setShowBoundsPopover(false);
  }, [decimals, draftDefaultValue, draftMax, draftMin, onChange, persistenceKey, value]);

  const resetBounds = useCallback(() => {
    setPersistedSettings(null);
    setDraftDefaultValue(
      defaultValue !== undefined
        ? formatEditableValue(defaultValue, decimals)
        : '',
    );
    setDraftMin(min !== undefined ? String(min) : '');
    setDraftMax(max !== undefined ? String(max) : '');
    if (persistenceKey) {
      clearPersistedSettings(persistenceKey);
    }
  }, [decimals, defaultValue, max, min, persistenceKey]);

  const handleResetToDefault = useCallback(() => {
    if (effectiveDefaultValue === undefined) return;
    const nextValue = clampValue(effectiveDefaultValue, effectiveMin, effectiveMax);
    onChange(nextValue);
    setDraftValue(formatEditableValue(nextValue, decimals));
    setDraftDefaultValue(formatEditableValue(nextValue, decimals));
    setShowBoundsPopover(false);
  }, [decimals, effectiveDefaultValue, effectiveMax, effectiveMin, onChange]);

  const beginEditing = useCallback(() => {
    setShowBoundsPopover(false);
    setDraftValue(formatEditableValue(value, decimals));
    setIsEditing(true);
  }, [decimals, value]);

  const cancelEditing = useCallback(() => {
    setDraftValue(formatEditableValue(value, decimals));
    setIsEditing(false);
  }, [decimals, value]);

  const commitEditing = useCallback(() => {
    const parsedValue = parseOptionalNumber(draftValue);
    if (parsedValue === undefined) {
      cancelEditing();
      return;
    }

    const nextValue = roundValue(
      clampValue(parsedValue, effectiveMin, effectiveMax),
      decimals,
    );
    onChange(nextValue);
    setDraftValue(formatEditableValue(nextValue, decimals));
    setIsEditing(false);
  }, [cancelEditing, decimals, draftValue, effectiveMax, effectiveMin, onChange]);

  const popover = showBoundsPopover && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          className="draggable-number-bounds-popover"
          style={popoverPlacement as CSSProperties}
        >
          <div className="draggable-number-bounds-title">Value Range</div>
          <div className="draggable-number-bounds-row">
            <label>Default</label>
            <input
              type="text"
              inputMode="decimal"
              value={draftDefaultValue}
              placeholder={defaultValue !== undefined ? String(defaultValue) : 'none'}
              onChange={(e) => setDraftDefaultValue(e.target.value)}
            />
          </div>
          <div className="draggable-number-bounds-row">
            <label>Min</label>
            <input
              type="text"
              inputMode="decimal"
              value={draftMin}
              placeholder={min !== undefined ? String(min) : 'none'}
              onChange={(e) => setDraftMin(e.target.value)}
            />
          </div>
          <div className="draggable-number-bounds-row">
            <label>Max</label>
            <input
              type="text"
              inputMode="decimal"
              value={draftMax}
              placeholder={max !== undefined ? String(max) : 'none'}
              onChange={(e) => setDraftMax(e.target.value)}
            />
          </div>
          <div className="draggable-number-bounds-actions">
            {effectiveDefaultValue !== undefined && (
              <button
                type="button"
                className="btn btn-xs"
                onClick={handleResetToDefault}
              >
                Default
              </button>
            )}
            <button type="button" className="btn btn-xs" onClick={resetBounds}>
              Default Caps
            </button>
            <button type="button" className="btn btn-xs btn-active" onClick={applyBoundsDraft}>
              Apply
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <span ref={rootRef} className="draggable-number-anchor">
      {isEditing ? (
        <input
          ref={inputRef}
          className="draggable-number draggable-number-input"
          type="text"
          inputMode="decimal"
          value={draftValue}
          style={{ width: `${Math.max(4, Math.min(18, draftValue.length + 1))}ch` }}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEditing();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEditing();
            }
          }}
          title="Enter value"
        />
      ) : (
        <span
          ref={spanRef}
          className="draggable-number"
          onMouseDown={handleMouseDown}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            beginEditing();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleResetToDefault();
          }}
          title={controlTitle}
        >
          {value.toFixed(decimals)}{suffix}
        </span>
      )}

      {popover}
    </span>
  );
}
