import type { PointerEvent as ReactPointerEvent } from 'react';

/** The ⋮ grip at the left of a track header: drags the track (with its clips) without waiting for a hold. */
export function TrackReorderGrip({ onPointerDown }: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <div className="track-reorder-handle" title="Drag to reorder (or hold the header)" onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()}>
      <span className="track-reorder-grip" aria-hidden="true">{'\u22EE'}</span>
    </div>
  );
}
