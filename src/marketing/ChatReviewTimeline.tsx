import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { IconMovie, IconWaveSine } from '@tabler/icons-react';

import { useTimelineStore } from '../stores/timeline';
import {
  projectChatReviewLanes,
  type ChatReviewLaneClip,
} from './chatReviewTimelineProjection';

function formatRulerTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function clipStyle(clip: ChatReviewLaneClip, duration: number) {
  return {
    left: `${(clip.startTime / duration) * 100}%`,
    width: `${Math.max((clip.duration / duration) * 100, 0.4)}%`,
  };
}

function sampleWaveform(samples: readonly number[], targetCount = 48): number[] {
  if (samples.length <= targetCount) return [...samples];
  const bucketSize = samples.length / targetCount;
  return Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    return Math.max(...samples.slice(start, end).map((sample) => Math.abs(sample)));
  });
}

function ReviewWaveform({ samples }: { samples?: readonly number[] }) {
  const bars = samples?.length
    ? sampleWaveform(samples)
    : [0.28, 0.52, 0.35, 0.72, 0.44, 0.62, 0.3, 0.57, 0.4, 0.68, 0.34, 0.5];
  return (
    <svg aria-hidden="true" className="chat-review-waveform" viewBox={`0 0 ${bars.length} 1`} preserveAspectRatio="none">
      {bars.map((sample, index) => {
        const height = Math.max(0.12, Math.min(0.92, sample));
        return <line key={index} x1={index + 0.5} x2={index + 0.5} y1={(1 - height) / 2} y2={(1 + height) / 2} />;
      })}
    </svg>
  );
}

interface ReviewLaneProps {
  clips: ChatReviewLaneClip[];
  duration: number;
  kind: 'audio' | 'video';
  onSeek: (time: number) => void;
  playheadPosition: number;
  trackRef?: RefObject<HTMLDivElement | null>;
}

function ReviewLane({ clips, duration, kind, onSeek, playheadPosition, trackRef }: ReviewLaneProps) {
  const Icon = kind === 'video' ? IconMovie : IconWaveSine;
  const label = kind === 'video' ? 'Video' : 'Audio';
  const handleLaneClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration)));
  };

  return (
    <div className="chat-review-lane" role="group" aria-label={`${label} cut`}>
      <div className="chat-review-lane-label"><Icon aria-hidden="true" /><span>{label}</span></div>
      <div className="chat-review-lane-track" onClick={handleLaneClick} ref={trackRef}>
        {clips.map((clip) => {
          const active = playheadPosition >= clip.startTime
            && playheadPosition < clip.startTime + clip.duration;
          return (
            <button
              aria-label={`Seek to ${clip.name} at ${formatRulerTime(clip.startTime)}`}
              className={`chat-review-clip is-${kind}${active ? ' is-active' : ''}`}
              key={clip.id}
              onClick={() => onSeek(clip.startTime)}
              style={clipStyle(clip, duration)}
              title={clip.name}
              type="button"
            >
              {kind === 'video' ? (
                <>
                  {clip.thumbnail && <span className="chat-review-clip-thumb" style={{ backgroundImage: `url(${clip.thumbnail})` }} />}
                  <span className="chat-review-clip-name">{clip.name}</span>
                </>
              ) : <ReviewWaveform samples={clip.waveform} />}
            </button>
          );
        })}
        {clips.length === 0 && <span className="chat-review-lane-empty">No {label.toLowerCase()} clips</span>}
      </div>
    </div>
  );
}

export function ChatReviewTimeline({ duration }: { duration?: number }) {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const timelineDuration = useTimelineStore((state) => state.duration);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const pause = useTimelineStore((state) => state.pause);
  const setDraggingPlayhead = useTimelineStore((state) => state.setDraggingPlayhead);
  const setPlayheadPosition = useTimelineStore((state) => state.setPlayheadPosition);
  const draggingPlayheadRef = useRef(false);
  const videoTrackRef = useRef<HTMLDivElement>(null);
  const lanes = useMemo(() => projectChatReviewLanes(clips, tracks), [clips, tracks]);
  const projectedEnd = Math.max(
    ...[...lanes.video, ...lanes.audio].map((clip) => clip.startTime + clip.duration),
    0,
  );
  const editEnd = Math.max(
    0.01,
    duration ?? (projectedEnd > 0 ? Math.min(timelineDuration, projectedEnd) : timelineDuration),
  );
  const ticks = Array.from({ length: 5 }, (_, index) => (editEnd * index) / 4);
  const playheadPercent = Math.max(0, Math.min(100, (playheadPosition / editEnd) * 100));
  const seekTo = (time: number) => {
    if (isPlaying) pause();
    setPlayheadPosition(Math.max(0, Math.min(editEnd, time)));
  };
  const seekFromClientX = (clientX: number) => {
    const rect = videoTrackRef.current?.getBoundingClientRect();
    if (!rect) return;
    seekTo(((clientX - rect.left) / Math.max(1, rect.width)) * editEnd);
  };
  const beginPlayheadDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingPlayheadRef.current = true;
    setDraggingPlayhead(true);
    seekFromClientX(event.clientX);
  };
  const movePlayhead = (event: PointerEvent<HTMLSpanElement>) => {
    if (!draggingPlayheadRef.current) return;
    event.preventDefault();
    seekFromClientX(event.clientX);
  };
  const finishPlayheadDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    draggingPlayheadRef.current = false;
    setDraggingPlayhead(false);
    setPlayheadPosition(useTimelineStore.getState().playheadPosition);
  };
  const movePlayheadWithKeyboard = (event: KeyboardEvent<HTMLSpanElement>) => {
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekTo(playheadPosition + (event.key === 'ArrowLeft' ? -step : step));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      seekTo(event.key === 'Home' ? 0 : editEnd);
    }
  };

  return (
    <div className="chat-review-timeline" aria-label="Simplified edit timeline">
      <div className="chat-review-ruler" aria-hidden="true">
        <span className="chat-review-ruler-spacer" />
        <div>{ticks.map((time) => <span key={time} style={{ left: `${(time / editEnd) * 100}%` }}>{formatRulerTime(time)}</span>)}</div>
      </div>
      <div className="chat-review-lanes">
        <ReviewLane clips={lanes.video} duration={editEnd} kind="video" onSeek={seekTo} playheadPosition={playheadPosition} trackRef={videoTrackRef} />
        <ReviewLane clips={lanes.audio} duration={editEnd} kind="audio" onSeek={seekTo} playheadPosition={playheadPosition} />
        <span
          aria-label="Review timeline playhead"
          aria-valuemax={editEnd}
          aria-valuemin={0}
          aria-valuenow={Math.min(playheadPosition, editEnd)}
          className="chat-review-playhead"
          onKeyDown={movePlayheadWithKeyboard}
          onPointerCancel={finishPlayheadDrag}
          onPointerDown={beginPlayheadDrag}
          onPointerMove={movePlayhead}
          onPointerUp={finishPlayheadDrag}
          role="slider"
          style={{ left: `calc(var(--chat-review-label-offset) + (100% - var(--chat-review-label-offset)) * ${playheadPercent / 100})` }}
          tabIndex={0}
          title="Drag to scrub the edit"
        >
          <i />
        </span>
      </div>
    </div>
  );
}
