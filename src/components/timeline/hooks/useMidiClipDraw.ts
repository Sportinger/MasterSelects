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

const DEFAULT_CLICK_CLIP_DURATION = 4; // seconds, for a no-drag click
const DRAG_THRESHOLD_PX = 3;

export interface MidiDrawGhost {
  left: number;   // viewport px
  top: number;    // viewport px
  width: number;  // px
  height: number; // px
}

interface UseMidiClipDrawProps {
  trackLanesRef: React.RefObject<HTMLDivElement | null>;
  scrollX: number;
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
  startContentX: number;
}

export function useMidiClipDraw({
  trackLanesRef,
  scrollX,
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
      if (target.closest('.timeline-clip') || target.closest('.track-header')) return;

      const laneEl = target.closest<HTMLElement>('.track-lane[data-track-id]');
      const trackId = laneEl?.dataset.trackId;
      if (!laneEl || !trackId) return;

      const track = tracks.find((t) => t.id === trackId);
      if (!track || track.type !== 'midi' || track.locked) return;

      const container = trackLanesRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const laneRect = laneEl.getBoundingClientRect();

      const startContentX = e.clientX - containerRect.left + scrollX;
      drawRef.current = {
        trackId,
        laneTop: laneRect.top,
        laneHeight: laneRect.height,
        startClientX: e.clientX,
        startContentX,
      };
      setGhost({ left: e.clientX, top: laneRect.top, width: 0, height: laneRect.height });
      e.preventDefault();
      e.stopPropagation();
    },
    [activeTimelineToolId, tracks, trackLanesRef, scrollX],
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

      const container = trackLanesRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const endContentX = e.clientX - containerRect.left + scrollX;

      const startTime = Math.max(0, pixelToTime(Math.min(draw.startContentX, endContentX)));
      const movedPx = Math.abs(e.clientX - draw.startClientX);

      let duration: number;
      if (movedPx < DRAG_THRESHOLD_PX) {
        duration = DEFAULT_CLICK_CLIP_DURATION;
      } else {
        const endTime = Math.max(0, pixelToTime(Math.max(draw.startContentX, endContentX)));
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
    // listeners close over the current scrollX / pixelToTime.
  }, [ghost !== null, trackLanesRef, scrollX, pixelToTime]); // eslint-disable-line react-hooks/exhaustive-deps

  return { midiDrawGhost: ghost, handleMidiDrawMouseDown };
}
