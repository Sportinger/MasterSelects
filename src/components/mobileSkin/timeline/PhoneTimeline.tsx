// Phone timeline: a FIXED centre playhead with the active composition's tracks running beneath
// it. Reads the editor's timeline store only (no second timeline model). Gestures belong to
// usePhoneTimelineNavigation; transition buttons sit at every cut (PhoneCutButtons); tiles re-render only when the rendered time window, the zoom, the
// clips or the selection change.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { getLabelHex } from '../../panels/media/labelColors';
import { resolveClipContextMenuLabelTarget } from '../../timeline/utils/clipContextMenu';
import { sanitizeTimelineFrameRate } from '../../../utils/timelineFrameQuantization';
import { PHONE_TEST_IDS } from '../contracts';
import { findPhoneCuts } from '../transition/phoneTransitionCuts';
import { PhoneClipStrip } from './PhoneClipStrip';
import { buildPhoneLanes } from './phoneLaneLayout';
import { PhoneCutButtons } from './PhoneCutButtons';
import { PhoneTimelineControls } from './PhoneTimelineControls';
import { PhoneLaneOverlays, PhoneRulerOverlays } from './PhoneTimelineOverlays';
import {
  formatRulerTime, rulerTicks, rulerTickStep, timelineContentEnd, visibleClipsInWindow,
} from './phoneTimelineGeometry';
import { usePhoneClipVisualWarmup } from './usePhoneClipVisuals';
import { usePhoneTimelineNavigation } from './usePhoneTimelineNavigation';
import './PhoneTimeline.css';

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function PhoneTimeline() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lanesViewportRef = useRef<HTMLDivElement | null>(null);
  const clipLayerRef = useRef<HTMLDivElement | null>(null);
  const rulerLayerRef = useRef<HTMLDivElement | null>(null);
  const laneBackLayerRef = useRef<HTMLDivElement | null>(null);

  const tracks = useTimelineStore((state) => state.tracks);
  const clips = useTimelineStore((state) => state.clips);
  const duration = useTimelineStore((state) => state.duration);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds) ?? EMPTY_SELECTION;
  const primaryClipId = useTimelineStore((state) => state.primarySelectedClipId);
  const handleClipId = primaryClipId && selectedClipIds.has(primaryClipId) ? primaryClipId : null;
  const activeComp = useMediaStore((state) => state.compositions.find((comp) => comp.id === state.activeCompositionId));
  const frameRate = sanitizeTimelineFrameRate(activeComp?.frameRate);
  const thumbnailAspect = activeComp && activeComp.height > 0 ? activeComp.width / activeComp.height : 16 / 9;

  const surfaceSize = useElementSize(surfaceRef);
  const lanesViewportSize = useElementSize(lanesViewportRef);
  const focus = useTimelineStore((state) => state.trackFocusMode);
  const thumbnailsOn = useTimelineStore((state) => state.thumbnailsEnabled);
  const waveformsOn = useTimelineStore((state) => state.waveformsEnabled);
  const { lanes, height: laneContentHeight } = useMemo(() => buildPhoneLanes(tracks, focus), [tracks, focus]);
  const laneClips = useMemo(() => {
    const trackIds = new Set(lanes.map((lane) => lane.trackId));
    return clips.filter((clip) => trackIds.has(clip.trackId));
  }, [clips, lanes]);
  const contentEnd = timelineContentEnd(laneClips, duration);
  const cutsByTrack = useMemo(() => findPhoneCuts(laneClips), [laneClips]);
  const clipsById = useMemo(() => new Map(laneClips.map((clip) => [clip.id, clip])), [laneClips]);

  const { timeWindow, zoom } = usePhoneTimelineNavigation({
    surfaceRef,
    layers: { clips: clipLayerRef, ruler: rulerLayerRef, laneBacks: laneBackLayerRef, lanesViewport: lanesViewportRef },
    width: surfaceSize.width,
    contentEnd,
    frameRate,
    lanes,
    laneContentHeight,
    lanesViewportHeight: lanesViewportSize.height,
    clips: laneClips,
  });

  const visibleClips = useMemo(() => visibleClipsInWindow(laneClips, timeWindow), [laneClips, timeWindow]);
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const clip of visibleClips) {
      const list = map.get(clip.trackId);
      if (list) list.push(clip);
      else map.set(clip.trackId, [clip]);
    }
    return map;
  }, [visibleClips]);
  const visualsVersion = usePhoneClipVisualWarmup(visibleClips);
  // Source label colours (the desktop context menu's target), as one string so tiles re-render only on change.
  const labelKey = useMediaStore((state) => visibleClips.map((clip) => `${clip.id}=${resolveClipContextMenuLabelTarget(clip, state).currentColor}`).join(','));
  const labelColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const pair of labelKey ? labelKey.split(',') : []) {
      const [id, color] = pair.split('=');
      if (color && color !== 'none') map.set(id, getLabelHex(color as Parameters<typeof getLabelHex>[0]));
    }
    return map;
  }, [labelKey]);

  const tickStep = rulerTickStep(zoom);
  const ticks = useMemo(() => rulerTicks(timeWindow, tickStep, Math.max(contentEnd, duration)), [contentEnd, duration, tickStep, timeWindow]);

  return (
    <div className="phone-timeline" data-testid={PHONE_TEST_IDS.timeline} data-visible-clip-count={visibleClips.length}>
      <div
        ref={surfaceRef}
        className="phone-timeline__surface"
        data-testid={PHONE_TEST_IDS.timelineSurface}
        data-touch-goo="off"
        role="group"
        aria-label="Timeline. Swipe to scrub, pinch to zoom, tap a clip to select it. Arrow keys step frames."
        tabIndex={0}
      >
        <div className="phone-timeline__ruler" aria-hidden="true">
          <div ref={rulerLayerRef} className="phone-timeline__layer">
            <PhoneRulerOverlays zoom={zoom} timeWindow={timeWindow} />
            {ticks.map((time) => (
              <span key={time} className="phone-timeline__tick" style={{ left: time * zoom }}>
                {formatRulerTime(time, tickStep)}
              </span>
            ))}
          </div>
        </div>
        <div ref={lanesViewportRef} className="phone-timeline__lanes">
          <div ref={laneBackLayerRef} className="phone-timeline__lane-backs" aria-hidden="true">
            {lanes.map((lane) => (
              <div
                key={lane.trackId}
                className={`phone-timeline__lane-back phone-timeline__lane-back--${lane.kind}${lane.main ? ' phone-timeline__lane-back--main' : ''}`}
                style={{ top: lane.top, height: lane.height }}
              />
            ))}
          </div>
          <div ref={clipLayerRef} className="phone-timeline__layer phone-timeline__clips">
            <span className="phone-timeline__bound" style={{ left: 0, height: laneContentHeight }} aria-hidden="true" />
            <span className="phone-timeline__bound" style={{ left: contentEnd * zoom, height: laneContentHeight }} aria-hidden="true" />
            {lanes.map((lane) => (
              <PhoneClipStrip
                key={lane.trackId}
                lane={lane}
                clips={clipsByTrack.get(lane.trackId) ?? []}
                selectedClipIds={selectedClipIds}
                zoom={zoom}
                timeWindow={timeWindow}
                visualsVersion={visualsVersion}
                thumbnailAspect={thumbnailAspect}
                labelColors={labelColors}
                thumbnails={thumbnailsOn}
                waveforms={waveformsOn}
              />
            ))}
            <PhoneLaneOverlays zoom={zoom} height={laneContentHeight} />
            <PhoneCutButtons
              lanes={lanes}
              cutsByTrack={cutsByTrack}
              clipsById={clipsById}
              zoom={zoom}
              timeWindow={timeWindow}
              handleClipId={handleClipId}
            />
          </div>
          {laneClips.length === 0 && (
            <p className="phone-timeline__empty">No clips in this composition yet. Add media to start editing.</p>
          )}
        </div>
        <div className="phone-timeline__playhead" data-testid={PHONE_TEST_IDS.playhead} aria-hidden="true" />
      </div>
      <PhoneTimelineControls />
    </div>
  );
}
