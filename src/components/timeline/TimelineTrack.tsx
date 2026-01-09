// TimelineTrack component - Individual track row

import React, { memo, useMemo } from 'react';
import type { TimelineTrackProps } from './types';
import type { AnimatableProperty } from '../../types';

// Render keyframe tracks for timeline area (right column) - flat list without folder structure
function TrackPropertyTracks({
  trackId,
  selectedClip,
  clipKeyframes,
  renderKeyframeDiamonds,
}: {
  trackId: string;
  selectedClip: { id: string; effects?: Array<{ id: string; name: string; params: Record<string, unknown> }> } | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  renderKeyframeDiamonds: (trackId: string, property: AnimatableProperty) => React.ReactNode;
}) {
  const clipId = selectedClip?.id;

  // Get keyframes for this clip - use clipKeyframes map to trigger re-render when keyframes change
  const keyframeProperties = useMemo(() => {
    if (!clipId) return new Set<string>();
    const props = new Set<string>();
    const keyframes = clipKeyframes.get(clipId) || [];
    keyframes.forEach((kf) => props.add(kf.property));
    return props;
  }, [clipId, clipKeyframes]);

  // If no clip is selected in this track or no keyframes, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-tracks" />;
  }

  // Convert Set to sorted array for consistent ordering (matching the labels)
  const sortedProperties = Array.from(keyframeProperties).sort((a, b) => {
    const order = ['opacity', 'position.x', 'position.y', 'position.z', 'scale.x', 'scale.y', 'rotation.x', 'rotation.y', 'rotation.z'];
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="track-property-tracks">
      {sortedProperties.map((prop) => (
        <div key={prop} className="keyframe-track-row flat">
          <div className="keyframe-track">
            <div className="keyframe-track-line" />
            {renderKeyframeDiamonds(trackId, prop as AnimatableProperty)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineTrackComponent({
  track,
  clips,
  isDimmed,
  isExpanded,
  dynamicHeight,
  isDragTarget,
  isExternalDragTarget,
  selectedClipIds,
  clipDrag,
  externalDrag,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  renderClip,
  clipKeyframes,
  renderKeyframeDiamonds,
  timeToPixel,
}: TimelineTrackProps) {
  // Get clips belonging to this track
  const trackClips = clips.filter((c) => c.trackId === track.id);
  const selectedTrackClip = trackClips.find((c) => selectedClipIds.has(c.id));

  return (
    <div
      className={`track-lane ${track.type} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      } ${isDragTarget ? 'drag-target' : ''} ${
        isExternalDragTarget ? 'external-drag-target' : ''
      }`}
      style={{ height: dynamicHeight }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      {/* Clip row - the normal clip area */}
      <div className="track-clip-row" style={{ height: track.height }}>
        {/* Render clips belonging to this track */}
        {trackClips.map((clip) => renderClip(clip, track.id))}
        {/* Render clip being dragged TO this track */}
        {clipDrag &&
          clipDrag.currentTrackId === track.id &&
          clipDrag.originalTrackId !== track.id &&
          clips
            .filter((c) => c.id === clipDrag.clipId)
            .map((clip) => renderClip(clip, track.id))}
        {/* External file drag preview - video clip */}
        {externalDrag && externalDrag.trackId === track.id && (
          <div
            className="timeline-clip-preview"
            style={{
              left: timeToPixel(externalDrag.startTime),
              width: timeToPixel(externalDrag.duration ?? 5),
            }}
          >
            <div className="clip-content">
              <span className="clip-name">Drop to add clip</span>
            </div>
          </div>
        )}
        {/* External file drag preview - linked audio clip */}
        {externalDrag &&
          externalDrag.isVideo &&
          externalDrag.audioTrackId === track.id && (
            <div
              className="timeline-clip-preview audio"
              style={{
                left: timeToPixel(externalDrag.startTime),
                width: timeToPixel(externalDrag.duration ?? 5),
              }}
            >
              <div className="clip-content">
                <span className="clip-name">Audio</span>
              </div>
            </div>
          )}
      </div>
      {/* Property rows - only shown when track is expanded */}
      {track.type === 'video' && isExpanded && (
        <TrackPropertyTracks
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          clipKeyframes={clipKeyframes}
          renderKeyframeDiamonds={renderKeyframeDiamonds}
        />
      )}
    </div>
  );
}

export const TimelineTrack = memo(TimelineTrackComponent);
