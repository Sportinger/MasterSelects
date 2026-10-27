// Touch handles of the phone output editor: the outline of every enabled slice and mask on the stage,
// and four large corner handles on the selected one. Input tab: the source region (inputCorners);
// Output tab: the corner-pin warp. The handles call the slice store's own actions, the same ones the
// desktop Output Manager overlays use.

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import { useSliceStore } from '../../../stores/sliceStore';
import type { Point2D } from '../../../types/outputSlice';
import { clientToNormalized, cornersOnTab } from './phoneOutputGeometry';
import { usePhoneOutputStore } from './phoneOutputStore';
import { PHONE_OUTPUT_TEST_IDS as IDS } from './phoneOutputTestIds';

const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];
const HANDLE_PX = 44;

interface Drag { pointerId: number; corner: number; offsetX: number; offsetY: number }

export function PhoneOutputHandles({ targetId, boxRef }: { targetId: string; boxRef: RefObject<HTMLDivElement | null> }) {
  const config = useSliceStore((state) => state.configs.get(targetId));
  const tab = useSliceStore((state) => state.activeTab);
  const zoom = usePhoneOutputStore((state) => state.view.zoom);
  const drag = useRef<Drag | null>(null);
  if (!config) return null;
  const selected = config.slices.find((item) => item.id === config.selectedSliceId) ?? null;
  const selectedCorners = selected && selected.enabled ? cornersOnTab(selected, tab) : null;

  const moveCorner = (corner: number, point: Point2D) => {
    if (!selected) return;
    const store = useSliceStore.getState();
    if (tab === 'input') store.setInputCorner(targetId, selected.id, corner, point);
    else store.setCornerPinCorner(targetId, selected.id, corner, point);
  };

  const pointFor = (event: ReactPointerEvent) => {
    const box = boxRef.current;
    return box ? clientToNormalized(box.getBoundingClientRect(), event.clientX, event.clientY) : null;
  };

  const onDown = (corner: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const point = pointFor(event);
    const current = selectedCorners?.[corner];
    if (!point || !current) return;
    drag.current = { pointerId: event.pointerId, corner, offsetX: current.x - point.x, offsetY: current.y - point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = pointFor(event);
    if (point) moveCorner(active.corner, { x: point.x + active.offsetX, y: point.y + active.offsetY });
  };
  const onEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.pointerType !== 'mouse') event.currentTarget.blur();
  };

  const select = (id: string) => useSliceStore.getState().selectSlice(targetId, id);
  const size = HANDLE_PX / Math.max(zoom, 0.01);

  return (
    <>
      <svg className="phone-output__outlines" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {config.slices.map((item, index) => {
          const corners = item.enabled ? cornersOnTab(item, tab) : null;
          if (!corners) return null;
          const points = corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
          return (
            <polygon
              key={item.id}
              data-testid={IDS.outline}
              data-item-id={item.id}
              className={`phone-output__outline phone-output__outline--${item.type}${item.id === selected?.id ? ' is-selected' : ''}`}
              style={{ ['--outline-index' as string]: index }}
              points={points}
              vectorEffect="non-scaling-stroke"
              onPointerUp={(event) => { if (event.pointerType !== 'mouse' || event.button === 0) select(item.id); }}
            />
          );
        })}
      </svg>
      {selected && selectedCorners ? selectedCorners.map((corner, index) => (
        <button
          key={index}
          type="button"
          className={`phone-output__handle phone-output__handle--${selected.type}`}
          data-testid={IDS.handle}
          data-corner={index}
          aria-label={`${selected.name}: move the ${CORNER_NAMES[index]} corner of the ${tab === 'input' ? 'source region' : 'output'}`}
          style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%`, width: size, height: size }}
          onPointerDown={onDown(index)}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          onLostPointerCapture={onEnd}
        >
          <span className="phone-output__handle-dot" aria-hidden="true" />
        </button>
      )) : null}
    </>
  );
}
