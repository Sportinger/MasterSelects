// Pick whip drag overlays (clip and track parenting cables)

import { PhysicsCable } from '../PhysicsCable';

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  status?: 'idle' | 'valid' | 'blocked';
  diagnostic?: string;
}

interface PickWhipCablesProps {
  pickWhipDrag: DragState | null;
  trackPickWhipDrag: DragState | null;
}

export function PickWhipCables({ pickWhipDrag, trackPickWhipDrag }: PickWhipCablesProps) {
  return (
    <>
      {/* Pick whip drag line - physics cable (clip parenting) */}
      {pickWhipDrag && (
        <svg
          className={`pick-whip-drag-overlay ${pickWhipDrag.status ?? 'idle'}`}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <PhysicsCable
            startX={pickWhipDrag.startX}
            startY={pickWhipDrag.startY}
            endX={pickWhipDrag.currentX}
            endY={pickWhipDrag.currentY}
            isPreview={true}
          />
        </svg>
      )}
      {pickWhipDrag?.diagnostic && (
        <div
          className={`pick-whip-diagnostic ${pickWhipDrag.status ?? 'idle'}`}
          role="status"
          aria-live="polite"
          style={{ left: pickWhipDrag.currentX + 14, top: pickWhipDrag.currentY + 14 }}
        >
          {pickWhipDrag.diagnostic}
        </div>
      )}

      {/* Track pick whip drag line - physics cable (layer parenting) */}
      {trackPickWhipDrag && (
        <svg
          className="pick-whip-drag-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <PhysicsCable
            startX={trackPickWhipDrag.startX}
            startY={trackPickWhipDrag.startY}
            endX={trackPickWhipDrag.currentX}
            endY={trackPickWhipDrag.currentY}
            isPreview={true}
          />
        </svg>
      )}
    </>
  );
}
