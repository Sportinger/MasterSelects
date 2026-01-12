// Mobile Timeline - Touch-optimized timeline

import { useRef, useState, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';

interface MobileTimelineProps {
  precisionMode: boolean;
}

export function MobileTimeline({ precisionMode }: MobileTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isDraggingClip, setIsDraggingClip] = useState(false);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [trimMode, setTrimMode] = useState<'start' | 'end' | null>(null);
  const lastTapRef = useRef<{ time: number; clipId: string | null }>({ time: 0, clipId: null });

  // Timeline state
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const playheadPosition = useTimelineStore((s) => s.playheadPosition);
  const duration = useTimelineStore((s) => s.duration);
  const zoom = useTimelineStore((s) => s.zoom);
  const scrollX = useTimelineStore((s) => s.scrollX);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);

  // Actions
  const setPlayheadPosition = useTimelineStore((s) => s.setPlayheadPosition);
  const selectClips = useTimelineStore((s) => s.selectClips);
  const moveClip = useTimelineStore((s) => s.moveClip);
  const trimClip = useTimelineStore((s) => s.trimClip);
  const setZoom = useTimelineStore((s) => s.setZoom);

  // Media files for thumbnails
  const files = useMediaStore((s) => s.files);

  // Pixels per second
  const pixelsPerSecond = 50 * zoom;

  // Time to X position
  const timeToX = useCallback((time: number) => {
    return time * pixelsPerSecond - scrollX;
  }, [pixelsPerSecond, scrollX]);

  // X to time
  const xToTime = useCallback((x: number) => {
    return (x + scrollX) / pixelsPerSecond;
  }, [pixelsPerSecond, scrollX]);

  // Handle tap on clip
  const handleClipTap = useCallback((clipId: string, e: React.TouchEvent) => {
    const now = Date.now();
    const lastTap = lastTapRef.current;

    // Double-tap detection (within 300ms on same clip)
    if (now - lastTap.time < 300 && lastTap.clipId === clipId) {
      // Double-tap - start dragging clip
      setIsDraggingClip(true);
      setDraggedClipId(clipId);
      lastTapRef.current = { time: 0, clipId: null };
    } else {
      // Single tap - select clip
      selectClips([clipId]);
      lastTapRef.current = { time: now, clipId };
    }

    e.stopPropagation();
  }, [selectClips]);

  // Handle touch on clip edge for trimming
  const handleClipEdgeTap = useCallback((clipId: string, edge: 'start' | 'end', e: React.TouchEvent) => {
    setTrimMode(edge);
    setDraggedClipId(clipId);
    selectClips([clipId]);
    e.stopPropagation();
  }, [selectClips]);

  // Handle timeline touch
  const handleTimelineTouch = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = touch.clientX - rect.left;
      const time = xToTime(x);

      // If not on a clip, move playhead
      setPlayheadPosition(Math.max(0, Math.min(time, duration)));
      setIsDraggingPlayhead(true);
    }
  }, [xToTime, setPlayheadPosition, duration]);

  // Handle touch move
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch to zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const prevDistance = (containerRef.current as any)?._pinchDistance;
      if (prevDistance) {
        const scale = distance / prevDistance;
        setZoom(Math.max(0.1, Math.min(10, zoom * scale)));
      }
      (containerRef.current as any)._pinchDistance = distance;
      return;
    }

    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = touch.clientX - rect.left;
    let time = xToTime(x);

    // Precision mode - slower movement
    if (precisionMode && isDraggingPlayhead) {
      const lastX = (containerRef.current as any)?._lastTouchX || x;
      const delta = (x - lastX) * 0.2; // 5x slower
      time = playheadPosition + delta / pixelsPerSecond;
      (containerRef.current as any)._lastTouchX = x;
    }

    if (isDraggingPlayhead) {
      setPlayheadPosition(Math.max(0, Math.min(time, duration)));
    } else if (isDraggingClip && draggedClipId) {
      const clip = clips.find((c) => c.id === draggedClipId);
      if (clip) {
        const newStartTime = Math.max(0, time - clip.duration / 2);
        moveClip(draggedClipId, newStartTime, clip.trackId);
      }
    } else if (trimMode && draggedClipId) {
      const clip = clips.find((c) => c.id === draggedClipId);
      if (clip) {
        if (trimMode === 'start') {
          const delta = time - clip.startTime;
          trimClip(draggedClipId, delta, 0);
        } else {
          const newDuration = time - clip.startTime;
          trimClip(draggedClipId, 0, newDuration - clip.duration);
        }
      }
    }
  }, [
    isDraggingPlayhead, isDraggingClip, draggedClipId, trimMode,
    xToTime, setPlayheadPosition, duration, precisionMode,
    playheadPosition, pixelsPerSecond, clips, moveClip, trimClip, zoom, setZoom
  ]);

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    setIsDraggingPlayhead(false);
    setIsDraggingClip(false);
    setDraggedClipId(null);
    setTrimMode(null);
    delete (containerRef.current as any)?._pinchDistance;
    delete (containerRef.current as any)?._lastTouchX;
  }, []);

  // Render track with clips
  const renderTrack = (trackId: string) => {
    const trackClips = clips.filter((c) => c.trackId === trackId);

    return (
      <div key={trackId} className="mobile-timeline-track">
        {trackClips.map((clip) => {
          const left = timeToX(clip.startTime);
          const width = clip.duration * pixelsPerSecond;
          const isSelected = selectedClipIds.has(clip.id);
          const mediaFileId = clip.source?.mediaFileId;
          const mediaFile = mediaFileId ? files.find((f) => f.id === mediaFileId) : null;
          const sourceType = clip.source?.type || 'video';

          return (
            <div
              key={clip.id}
              className={`mobile-timeline-clip ${isSelected ? 'selected' : ''} ${sourceType}`}
              style={{
                left: `${left}px`,
                width: `${width}px`,
              }}
              onTouchStart={(e) => handleClipTap(clip.id, e)}
            >
              {/* Trim handles */}
              <div
                className="mobile-clip-handle start"
                onTouchStart={(e) => handleClipEdgeTap(clip.id, 'start', e)}
              />
              <div className="mobile-clip-content">
                <span className="mobile-clip-name">
                  {clip.name || mediaFile?.name || 'Clip'}
                </span>
              </div>
              <div
                className="mobile-clip-handle end"
                onTouchStart={(e) => handleClipEdgeTap(clip.id, 'end', e)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="mobile-timeline"
      onTouchStart={handleTimelineTouch}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Time ruler */}
      <div className="mobile-timeline-ruler">
        {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
          <div
            key={i}
            className="mobile-timeline-ruler-mark"
            style={{ left: `${timeToX(i)}px` }}
          >
            <span>{i}s</span>
          </div>
        ))}
      </div>

      {/* Tracks */}
      <div className="mobile-timeline-tracks">
        {tracks.map((track) => renderTrack(track.id))}
      </div>

      {/* Playhead */}
      <div
        className="mobile-timeline-playhead"
        style={{ left: `${timeToX(playheadPosition)}px` }}
      >
        <div className="mobile-playhead-head" />
        <div className="mobile-playhead-line" />
      </div>
    </div>
  );
}
