// Split compare line on the phone preview: while the editor's split compare is on
// (splitCompareStore, the same switch the engine reads), the picture shows the untreated clip left
// of the line and the clip with its effects right of it. Drag the line with a finger; arrow keys
// move it for keyboards. Preview only: the export never contains the compare (RenderDispatcher).

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { useSplitCompareStore } from '../../../stores/splitCompareStore';
import type { PhoneRect } from './phonePreviewGeometry';
import { PHONE_PREVIEW_VIEW_TEST_IDS as IDS } from './phonePreviewViewIds';

export function PhoneSplitCompareHandle({ rect }: { rect: PhoneRect }) {
  const enabled = useSplitCompareStore((state) => state.enabled);
  const position = useSplitCompareStore((state) => state.position);
  const setPosition = useSplitCompareStore((state) => state.setPosition);
  const draggingRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  if (!enabled || rect.width <= 0 || rect.height <= 0) return null;

  const moveTo = (clientX: number) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    setPosition((clientX - box.left) / box.width);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    moveTo(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== event.pointerId) return;
    event.preventDefault();
    moveTo(event.clientX);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== event.pointerId) return;
    draggingRef.current = null;
    event.currentTarget.blur();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setPosition(position + (event.key === 'ArrowLeft' ? -0.02 : 0.02));
  };

  return (
    <div ref={stageRef} className="phone-compare" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
      <span className="phone-compare__label phone-compare__label--before" style={{ right: `${(1 - position) * 100}%` }}>Before</span>
      <span className="phone-compare__label phone-compare__label--after" style={{ left: `${position * 100}%` }}>After</span>
      <div
        className="phone-compare__handle"
        data-testid={IDS.compareHandle}
        data-position={position.toFixed(3)}
        style={{ left: `${position * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Compare line: untreated on the left, with effects on the right"
        aria-valuemin={2}
        aria-valuemax={98}
        aria-valuenow={Math.round(position * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <span className="phone-compare__grip" aria-hidden="true" />
      </div>
    </div>
  );
}
