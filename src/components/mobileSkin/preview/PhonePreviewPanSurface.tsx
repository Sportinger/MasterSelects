// One-finger pan of the actual-pixels (1:1) preview: the picture is larger than the screen, so the
// finger slides it around. Only mounted in actual-pixels view, where the clip handles are off.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { PHONE_PREVIEW_VIEW_TEST_IDS as IDS } from './phonePreviewViewIds';
import { usePhonePreviewViewStore } from './phonePreviewViewStore';

export function PhonePreviewPanSurface({ clampPan }: { clampPan: (pan: { x: number; y: number }) => { x: number; y: number } }) {
  const dragRef = useRef<{ id: number; x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const pan = usePhonePreviewViewStore((state) => state.pan);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: clampPan(usePhonePreviewViewStore.getState().pan) };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    usePhonePreviewViewStore.getState().setPan(clampPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y }));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className="phone-preview-pan"
      data-testid={IDS.panSurface}
      data-pan={`${Math.round(pan.x)},${Math.round(pan.y)}`}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    />
  );
}
