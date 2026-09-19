import { useEffect, useMemo } from 'react';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';

import { Preview } from '../components/preview';
import { usePlaybackLoop } from '../components/timeline/hooks/usePlaybackLoop';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import type { PreviewPanelSource } from '../types/dock';

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

interface LandingReviewPreviewProps {
  compositionId?: string;
  duration?: number;
}

export function LandingReviewPreview({ compositionId, duration }: LandingReviewPreviewProps) {
  const composition = useMediaStore((state) => state.compositions.find((item) => (
    item.id === (compositionId ?? state.activeCompositionId)
  )));
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const timelineDuration = useTimelineStore((state) => state.duration);
  const play = useTimelineStore((state) => state.play);
  const pause = useTimelineStore((state) => state.pause);
  const setPlayheadPosition = useTimelineStore((state) => state.setPlayheadPosition);
  const source = useMemo<PreviewPanelSource>(() => compositionId
    ? { type: 'composition', compositionId }
    : { type: 'activeComp' }, [compositionId]);
  const reviewEnd = Math.max(0.01, duration ?? timelineDuration);
  const visiblePlayhead = Math.min(playheadPosition, reviewEnd);
  usePlaybackLoop({ isPlaying });

  useEffect(() => {
    if (playheadPosition <= reviewEnd) return;
    if (isPlaying) pause();
    setPlayheadPosition(reviewEnd);
  }, [isPlaying, pause, playheadPosition, reviewEnd, setPlayheadPosition]);

  const togglePlayback = async () => {
    if (isPlaying) {
      pause();
      return;
    }
    if (playheadPosition >= reviewEnd - 0.001) setPlayheadPosition(0);
    await play();
  };

  return (
    <section className="landing-review-preview" aria-label="Edit preview">
      <div
        className="landing-review-preview-frame"
        style={{ aspectRatio: `${composition?.width ?? 16} / ${composition?.height ?? 9}` }}
      >
        <Preview
          panelId={`landing-review-preview:${compositionId ?? 'active'}`}
          showTransparencyGrid={false}
          source={source}
        />
      </div>
      <div className="landing-review-preview-transport">
        <button
          aria-label={isPlaying ? 'Pause review preview' : 'Play review preview'}
          onClick={() => void togglePlayback().catch(() => undefined)}
          type="button"
        >
          {isPlaying ? <IconPlayerPauseFilled aria-hidden="true" /> : <IconPlayerPlayFilled aria-hidden="true" />}
        </button>
        <input
          aria-label="Review preview playhead"
          max={reviewEnd}
          min={0}
          onChange={(event) => setPlayheadPosition(Number(event.currentTarget.value))}
          step={0.01}
          type="range"
          value={visiblePlayhead}
        />
        <span>{formatTime(visiblePlayhead)} / {formatTime(reviewEnd)}</span>
      </div>
    </section>
  );
}
