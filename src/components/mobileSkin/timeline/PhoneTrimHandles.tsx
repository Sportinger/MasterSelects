// Two trim handles on the selected clip tile. Each is drawn ~12 px wide just outside the clip
// edge, with a 44 px touch target centred on the edge. Dragging is handled by
// usePhoneClipEditGesture (the handles only carry data-phone-trim-edge / data-clip-id); arrow keys
// trim by one frame for keyboard users, as one undo step each.

import type { KeyboardEvent } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types';
import { sanitizeTimelineFrameRate } from '../../../utils/timelineFrameQuantization';
import { PHONE_M1_TEST_IDS } from '../contracts';
import { commitPhoneClipTrim, computePhoneTrimTiming } from '../actions/phoneClipEditActions';
import { usePhoneUiStore } from '../state/phoneUiStore';

export const PHONE_TRIM_HIT_WIDTH = 44;

interface PhoneTrimHandlesProps {
  /** Clip geometry to draw (the live trim preview while dragging). */
  clip: Pick<TimelineClip, 'id' | 'name' | 'startTime' | 'duration'>;
  zoom: number;
  laneHeight: number;
  windowStart: number;
  windowEnd: number;
  /** Edge currently being dragged, highlighted. */
  activeEdge?: 'start' | 'end';
}

function nudgeTrim(clipId: string, edge: 'start' | 'end', frames: number): void {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return;
  const media = useMediaStore.getState();
  const fps = sanitizeTimelineFrameRate(media.compositions.find((comp) => comp.id === media.activeCompositionId)?.frameRate);
  const timing = computePhoneTrimTiming(clip, edge, frames / fps, timeline.clips);
  if (Math.abs(timing.newDuration - clip.duration) < 1e-9 && Math.abs(timing.newStartTime - clip.startTime) < 1e-9) {
    usePhoneUiStore.getState().showToast(`The ${edge === 'start' ? 'start' : 'end'} cannot move further.`, 'info');
    return;
  }
  const result = commitPhoneClipTrim(clipId, timing);
  if (!result.ok) usePhoneUiStore.getState().showToast(result.message, 'error');
}

export function PhoneTrimHandles({ clip, zoom, laneHeight, windowStart, windowEnd, activeEdge }: PhoneTrimHandlesProps) {
  const end = clip.startTime + clip.duration;
  const edges: Array<{ edge: 'start' | 'end'; time: number }> = [
    { edge: 'start', time: clip.startTime },
    { edge: 'end', time: end },
  ];
  const hitHeight = Math.max(44, laneHeight + 8);

  const onKeyDown = (edge: 'start' | 'end') => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    nudgeTrim(clip.id, edge, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1));
  };

  return (
    <>
      {edges.map(({ edge, time }) => {
        // Handles outside the rendered window are off screen anyway.
        if (time < windowStart || time > windowEnd) return null;
        return (
          <div
            key={edge}
            className={`phone-trim-handle phone-trim-handle--${edge}${activeEdge === edge ? ' phone-trim-handle--active' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Trim ${edge === 'start' ? 'start' : 'end'} of ${clip.name}. Drag, or use the arrow keys to move one frame.`}
            data-testid={edge === 'start' ? PHONE_M1_TEST_IDS.trimHandleStart : PHONE_M1_TEST_IDS.trimHandleEnd}
            data-phone-trim-edge={edge}
            data-clip-id={clip.id}
            style={{
              left: time * zoom - PHONE_TRIM_HIT_WIDTH / 2,
              width: PHONE_TRIM_HIT_WIDTH,
              top: (laneHeight - hitHeight) / 2,
              height: hitHeight,
            }}
            onKeyDown={onKeyDown(edge)}
          >
            <span className="phone-trim-handle__bar" style={{ height: Math.max(8, laneHeight - 4) }} aria-hidden="true" />
          </div>
        );
      })}
    </>
  );
}
