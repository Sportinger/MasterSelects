// After Effects-style pick whip for clip parenting.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface PickWhipProps {
  clipId: string;
  clipName: string;
  parentClipId: string | undefined;
  parentClipName: string | undefined;
  isDragging: boolean;
  disabled?: boolean;
  diagnostic?: string;
  onSetParent: (clipId: string, parentClipId: string | null) => void;
  onDragStart: (clipId: string, startX: number, startY: number) => void;
  onDragEnd: () => void;
}

export function PickWhip({
  clipId,
  clipName,
  parentClipId,
  parentClipName,
  isDragging,
  disabled = false,
  diagnostic,
  onSetParent,
  onDragStart,
  onDragEnd,
}: PickWhipProps) {
  const iconRef = useRef<HTMLButtonElement>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) {
      onDragStart(clipId, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }, [clipId, disabled, onDragStart]);

  const handleClear = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSetParent(clipId, null);
  }, [clipId, onSetParent]);

  const hasParent = Boolean(parentClipId);
  const parentLabel = parentClipName || parentClipId;
  const dragTitle = disabled
    ? diagnostic || 'Unlock the track before parenting.'
    : hasParent
      ? `Parented to ${parentLabel}. Drag to choose another parent.`
      : `Drag ${clipName} onto another clip to set its parent.`;

  return (
    <div className={`clip-parenting-actions ${isDragging ? 'dragging' : ''} ${hasParent ? 'has-parent' : ''}`}>
      <button
        ref={iconRef}
        type="button"
        className="pick-whip"
        aria-label={`Set parent for ${clipName}`}
        aria-pressed={isDragging}
        disabled={disabled}
        title={dragTitle}
        onPointerDown={handlePointerDown}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && isDragging) onDragEnd();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" className="pick-whip-icon" aria-hidden="true">
          <path
            d="M8 2C5 2 3 4 3 7s2 5 5 5c2 0 3.5-1 4-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity={hasParent ? 1 : 0.6}
          />
          <circle
            cx="12"
            cy="9.5"
            r={hasParent ? 2 : 1.5}
            fill={hasParent ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeOpacity={hasParent ? 1 : 0.6}
          />
        </svg>
      </button>
      {hasParent && (
        <button
          type="button"
          className="pick-whip-clear"
          aria-label={`Clear parent for ${clipName}`}
          disabled={disabled}
          title={`Clear parent ${parentLabel}`}
          onPointerDown={handleClear}
        >
          ×
        </button>
      )}
    </div>
  );
}
