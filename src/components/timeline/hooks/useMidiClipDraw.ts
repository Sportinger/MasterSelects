// useMidiClipDraw — pencil-tool drawing of MIDI clip regions (issue #182).
//
// When the `midi-draw` tool is active, click-dragging on empty space of a MIDI
// track lane paints a new MIDI clip spanning the dragged time range. Free
// placement, no grid snapping (per the locked-in plan decision). A plain click
// (no drag) creates a default-length clip at the click position.
//
// Mirrors the empty-area pointer model of useMarqueeSelection, but renders its
// drag preview as a viewport-fixed ghost so it needs no scroll-container math.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineTrack } from '../../../types';
import type { TimelineToolId } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import { isTimelineActiveTarget } from '../utils/timelineActiveTargets';

const DEFAULT_CLICK_CLIP_DURATION = 4; // seconds, for a no-drag click
const DRAG_THRESHOLD_PX = 3;

export interface MidiDrawGhost {
  left: number;   // viewport px
  top: number;    // viewport px
  width: number;  // px
  height: number; // px
}

interface UseMidiClipDrawProps {
  tracks: TimelineTrack[];
  activeTimelineToolId: TimelineToolId;
  pixelToTime: (pixel: number) => number;
}

interface UseMidiClipDrawReturn {
  midiDrawGhost: MidiDrawGhost | null;
  handleMidiDrawMouseDown: (e: React.MouseEvent) => void;
}

interface ActiveDraw {
  trackId: string;
  laneTop: number;     // viewport px
  laneHeight: number;  // px
  startClientX: number;
  // The lane's clip-row element. Its current left edge is the time-zero origin
  // (already scroll- and header-offset-corrected), so content px = clientX -
  // rowEl.getBoundingClientRect().left. Re-read on mouseup so a mid-draw scroll
  // stays correct. Mirrors the proven empty-area handler in TimelineTrack.
  rowEl: HTMLElement;
}

export function useMidiClipDraw({
  tracks,
  activeTimelineToolId,
  pixelToTime,
}: UseMidiClipDrawProps): UseMidiClipDrawReturn {
  const [ghost, setGhost] = useState<MidiDrawGhost | null>(null);
  const drawRef = useRef<ActiveDraw | null>(null);

  const handleMidiDrawMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (activeTimelineToolId !== 'midi-draw') return;

      const target = e.target as HTMLElement;
      // Only draw on empty lane space, not on existing clips/handles.
      if (isTimelineActiveTarget(target) || target.closest('.track-header')) return;

      const laneEl = target.closest<HTMLElement>('.track-lane[data-track-id]');
      const trackId = laneEl?.dataset.trackId;
      if (!laneEl || !trackId) return;

      const track = tracks.find((t) => t.id === trackId);
      if (!track || track.type !== 'midi' || track.locked) return;

      // Measure time against the clip row's left edge (time-zero origin), not the
      // outer track stack — the stack includes the header column, which otherwise
      // shifts the new clip right by trackHeaderWidth / zoom seconds.
      const rowEl = laneEl.querySelector<HTMLElement>('.track-clip-row') ?? laneEl;
      const laneRect = laneEl.getBoundingClientRect();

      drawRef.current = {
        trackId,
        laneTop: laneRect.top,
        laneHeight: laneRect.height,
        startClientX: e.clientX,
        rowEl,
      };
      setGhost({ left: e.clientX, top: laneRect.top, width: 0, height: laneRect.height });
      e.preventDefault();
      e.stopPropagation();
    },
    [activeTimelineToolId, tracks],
  );

  useEffect(() => {
    if (!drawRef.current) return;

    const handleMove = (e: MouseEvent) => {
      const draw = drawRef.current;
      if (!draw) return;
      const left = Math.min(draw.startClientX, e.clientX);
      const width = Math.abs(e.clientX - draw.startClientX);
      setGhost({ left, top: draw.laneTop, width, height: draw.laneHeight });
    };

    const handleUp = (e: MouseEvent) => {
      const draw = drawRef.current;
      drawRef.current = null;
      setGhost(null);
      if (!draw) return;

      // The row's live left edge is time-zero (scroll already baked in).
      const originLeft = draw.rowEl.getBoundingClientRect().left;
      const startContentX = draw.startClientX - originLeft;
      const endContentX = e.clientX - originLeft;

      const startTime = Math.max(0, pixelToTime(Math.min(startContentX, endContentX)));
      const movedPx = Math.abs(e.clientX - draw.startClientX);

      let duration: number;
      if (movedPx < DRAG_THRESHOLD_PX) {
        duration = DEFAULT_CLICK_CLIP_DURATION;
      } else {
        const endTime = Math.max(0, pixelToTime(Math.max(startContentX, endContentX)));
        duration = Math.max(0.05, endTime - startTime);
      }

      const clipId = useTimelineStore.getState().addMidiClip(draw.trackId, startTime, duration);
      if (clipId) {
        useTimelineStore.getState().selectClip(clipId, false);
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    // Re-bind whenever a draw begins (ghost transitions from null) so the
    // listeners close over the current pixelToTime.
  }, [ghost !== null, pixelToTime]); // eslint-disable-line react-hooks/exhaustive-deps

  return { midiDrawGhost: ghost, handleMidiDrawMouseDown };
}
