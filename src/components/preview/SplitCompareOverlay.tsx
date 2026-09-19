import { useCallback, useRef } from 'react';
import { useSplitCompareStore } from '../../stores/splitCompareStore';
import './SplitCompareOverlay.css';

export function SplitCompareOverlay(): React.JSX.Element {
  const enabled = useSplitCompareStore((state) => state.enabled);
  const position = useSplitCompareStore((state) => state.position);
  const setEnabled = useSplitCompareStore((state) => state.setEnabled);
  const setPosition = useSplitCompareStore((state) => state.setPosition);
  const handleRef = useRef<HTMLDivElement>(null);

  const moveHandle = useCallback((clientX: number) => {
    const parent = handleRef.current?.parentElement;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    setPosition((clientX - bounds.left) / Math.max(1, bounds.width));
  }, [setPosition]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    moveHandle(event.clientX);
  }, [moveHandle]);

  return (
    <>
      <button
        type="button"
        className="split-compare-toggle"
        aria-label="Compare effects with untreated source"
        aria-pressed={enabled}
        onClick={() => setEnabled(!enabled)}
      >
        Compare
      </button>
      {enabled && (
        <div
          ref={handleRef}
          className="split-compare-handle"
          style={{ left: `${position * 100}%` }}
          role="slider"
          aria-label="Effect comparison split"
          aria-valuemin={2}
          aria-valuemax={98}
          aria-valuenow={Math.round(position * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveHandle(event.clientX);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setPosition(position + (event.key === 'ArrowLeft' ? -0.02 : 0.02));
            }
          }}
        />
      )}
    </>
  );
}
