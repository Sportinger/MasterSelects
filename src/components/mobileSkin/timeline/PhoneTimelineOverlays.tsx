// Overlays of the phone timeline drawn in content coordinates (t * zoom), so the navigation hook
// moves them with the ruler / clip layer and panning never re-renders them:
// - the composition's in/out range as a band on the ruler and two lines across the lanes,
// - the beat grid on the ruler (bars and beats of the editor's tempo map) while a Bars ruler lane
//   exists, i.e. exactly when the editor snaps to beats,
// - the snap line of a running move/trim gesture.

import { useMemo } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { PHONE_TIMELINE_CONTROLS_TEST_IDS as IDS } from '../timelineTools/phoneTimelineToolsTestIds';
import { phoneBeatMarks } from './phoneBeatMarks';
import type { PhoneTimeWindow } from './phoneTimelineGeometry';
import { usePhoneClipEditPreviewStore } from './usePhoneClipEditGesture';

export function PhoneRulerOverlays({ zoom, timeWindow }: { zoom: number; timeWindow: PhoneTimeWindow }) {
  const inPoint = useTimelineStore((state) => state.inPoint);
  const outPoint = useTimelineStore((state) => state.outPoint);
  const duration = useTimelineStore((state) => state.duration);
  const grid = useTimelineStore((state) => state.rulerLanes.some((lane) => lane.format === 'bars'));
  const tempoMap = useTimelineStore((state) => state.tempoMap);
  const marks = useMemo(() => (grid ? phoneBeatMarks(tempoMap, timeWindow, zoom) : []), [grid, tempoMap, timeWindow, zoom]);
  const hasRange = inPoint !== null || outPoint !== null;
  const start = inPoint ?? 0;
  const end = outPoint ?? duration;

  return (
    <>
      {marks.map((mark) => (
        <span
          key={mark.time}
          className={`phone-timeline__beat${mark.downbeat ? ' phone-timeline__beat--bar' : ''}`}
          data-testid={IDS.beat}
          data-time={mark.time}
          data-downbeat={mark.downbeat ? 'true' : 'false'}
          style={{ left: mark.time * zoom }}
        />
      ))}
      {hasRange && end > start ? (
        <span
          className="phone-timeline__range"
          data-testid={IDS.rangeBand}
          data-in={inPoint ?? ''}
          data-out={outPoint ?? ''}
          style={{ left: start * zoom, width: (end - start) * zoom }}
        />
      ) : null}
    </>
  );
}

/** In/out lines across the lanes and the snap line of a running gesture (clip layer). */
export function PhoneLaneOverlays({ zoom, height }: { zoom: number; height: number }) {
  const inPoint = useTimelineStore((state) => state.inPoint);
  const outPoint = useTimelineStore((state) => state.outPoint);
  const snapTime = usePhoneClipEditPreviewStore((state) => state.preview?.snapTime ?? null);
  return (
    <>
      {inPoint !== null ? <span className="phone-timeline__range-line" style={{ left: inPoint * zoom, height }} aria-hidden="true" /> : null}
      {outPoint !== null ? <span className="phone-timeline__range-line" style={{ left: outPoint * zoom, height }} aria-hidden="true" /> : null}
      {snapTime !== null ? (
        <span className="phone-timeline__snap-line" data-testid="phone-timeline-snap-line" data-time={snapTime}
          style={{ left: snapTime * zoom, height }} aria-hidden="true" />
      ) : null}
    </>
  );
}
