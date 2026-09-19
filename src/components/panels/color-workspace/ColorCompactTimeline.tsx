import { useEffect, useMemo, useRef, type PointerEvent } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import './ColorClipStrip.css';

const COLOR_TIMELINE_TRACK_HEADER_WIDTH = 38;
const COLOR_TIMELINE_FRAME_RATE = 30;
const RESOLVE_TIMELINE_START_SECONDS = 60 * 60;

function formatTimelineTick(seconds: number): string {
  const totalFrames = Math.max(
    0,
    Math.round((seconds + RESOLVE_TIMELINE_START_SECONDS) * COLOR_TIMELINE_FRAME_RATE),
  );
  const frames = totalFrames % COLOR_TIMELINE_FRAME_RATE;
  const totalSeconds = Math.floor(totalFrames / COLOR_TIMELINE_FRAME_RATE);
  const wholeSeconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, wholeSeconds, frames]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
}

export function ColorCompactTimeline() {
  const activeScrubPointerId = useRef<number | null>(null);
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const selectTimelineClip = useTimelineStore(state => state.selectClip);
  const setDraggingPlayhead = useTimelineStore(state => state.setDraggingPlayhead);
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);

  useEffect(() => () => {
    activeScrubPointerId.current = null;
    setDraggingPlayhead(false);
  }, [setDraggingPlayhead]);

  const videoTracks = useMemo(
    () => tracks.filter(track => track.type === 'video'),
    [tracks],
  );
  const stackedVideoTracks = useMemo(
    () => videoTracks
      .map((track, index) => ({ label: `V${index + 1}`, track }))
      .toReversed(),
    [videoTracks],
  );
  const clipsByTrack = useMemo(() => new Map(videoTracks.map(track => [
    track.id,
    clips
      .filter(clip => clip.trackId === track.id)
      .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)),
  ] as const)), [clips, videoTracks]);
  const videoClips = useMemo(
    () => videoTracks.flatMap(track => clipsByTrack.get(track.id) ?? []),
    [clipsByTrack, videoTracks],
  );
  const duration = Math.max(1, ...videoClips.map(clip => clip.startTime + clip.duration));
  const focusedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : [...selectedClipIds][0];
  const timeTicks = Array.from({ length: 7 }, (_, index) => duration * index / 6);

  const selectClip = (clipId: string, startTime: number) => {
    selectTimelineClip(clipId);
    setPlayheadPosition(startTime);
  };
  const seekFromClientX = (clientX: number, timelineElement: HTMLElement) => {
    const rect = timelineElement.getBoundingClientRect();
    const laneWidth = Math.max(1, rect.width - COLOR_TIMELINE_TRACK_HEADER_WIDTH);
    const normalized = Math.max(0, Math.min(
      1,
      (clientX - rect.left - COLOR_TIMELINE_TRACK_HEADER_WIDTH) / laneWidth,
    ));
    setPlayheadPosition(normalized * duration);
  };
  const beginTimelineScrub = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    activeScrubPointerId.current = event.pointerId;
    setDraggingPlayhead(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX, event.currentTarget);
  };
  const continueTimelineScrub = (event: PointerEvent<HTMLElement>) => {
    if (
      activeScrubPointerId.current !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)
    ) return;
    seekFromClientX(event.clientX, event.currentTarget);
  };
  const endTimelineScrub = (event: PointerEvent<HTMLElement>) => {
    if (activeScrubPointerId.current !== event.pointerId) return;
    activeScrubPointerId.current = null;
    setDraggingPlayhead(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginPlayheadScrub = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const timelineElement = event.currentTarget.closest<HTMLElement>('.color-composition-mini-timeline');
    if (!timelineElement) return;
    event.preventDefault();
    event.stopPropagation();
    activeScrubPointerId.current = event.pointerId;
    setDraggingPlayhead(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX, timelineElement);
  };
  const continuePlayheadScrub = (event: PointerEvent<HTMLButtonElement>) => {
    if (activeScrubPointerId.current !== event.pointerId) return;
    const timelineElement = event.currentTarget.closest<HTMLElement>('.color-composition-mini-timeline');
    if (timelineElement) seekFromClientX(event.clientX, timelineElement);
  };
  const endPlayheadScrub = (event: PointerEvent<HTMLButtonElement>) => {
    if (activeScrubPointerId.current !== event.pointerId) return;
    activeScrubPointerId.current = null;
    setDraggingPlayhead(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      aria-label="Compact color timeline"
      className="color-composition-mini-timeline"
      onLostPointerCapture={endTimelineScrub}
      onPointerCancel={endTimelineScrub}
      onPointerDown={beginTimelineScrub}
      onPointerMove={continueTimelineScrub}
      onPointerUp={endTimelineScrub}
    >
      <div className="color-composition-ruler" aria-hidden="true">
        <span className="color-composition-ruler-spacer" />
        <div>
          {timeTicks.map(time => (
            <span key={time} style={{ left: `${(time / duration) * 100}%` }}>{formatTimelineTick(time)}</span>
          ))}
        </div>
      </div>

      <div className="color-composition-tracks">
        {stackedVideoTracks.map(({ label, track }) => (
          <div className="color-composition-track" key={track.id}>
            <span className="color-composition-track-label">{label}</span>
            <div className="color-composition-track-lane">
              {(clipsByTrack.get(track.id) ?? []).map(clip => {
                const selected = clip.id === focusedClipId;
                return (
                  <button
                    aria-pressed={selected}
                    className={`color-composition-clip${selected ? ' selected' : ''}`}
                    key={clip.id}
                    onClick={() => selectClip(clip.id, clip.startTime)}
                    style={{
                      left: `${(clip.startTime / duration) * 100}%`,
                      width: `${Math.max(0.7, (clip.duration / duration) * 100)}%`,
                    }}
                    title={`${clip.name} · ${formatTimelineTick(clip.startTime)}`}
                    type="button"
                  >
                    <b>{clip.name}</b>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <span className="color-composition-playhead-lane">
        <button
          aria-label="Scrub mini timeline"
          className="color-composition-playhead"
          onLostPointerCapture={endPlayheadScrub}
          onPointerCancel={endPlayheadScrub}
          onPointerDown={beginPlayheadScrub}
          onPointerMove={continuePlayheadScrub}
          onPointerUp={endPlayheadScrub}
          style={{ left: `${Math.max(0, Math.min(100, playheadPosition / duration * 100))}%` }}
          type="button"
        >
          <span aria-hidden="true" className="color-composition-playhead-shadow" />
        </button>
      </span>
    </section>
  );
}
