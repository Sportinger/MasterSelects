// TimelineHeader component - Track headers (left side)

import { memo, useMemo, useState, useRef, useEffect } from 'react';
import type { TimelineHeaderProps } from './types';
import type { AnimatableProperty } from '../../types';

// Render property labels for track header (left column) - flat list without folder structure
function TrackPropertyLabels({
  selectedClip,
  getClipKeyframes,
}: {
  selectedClip: { id: string; effects?: Array<{ id: string; name: string; params: Record<string, unknown> }> } | null;
  getClipKeyframes: (clipId: string) => Array<{
    id: string;
    clipId: string;
    time: number;
    property: AnimatableProperty;
    value: number;
    easing: string;
  }>;
}) {
  const clipId = selectedClip?.id;

  // Memoize all keyframe properties
  const keyframeProperties = useMemo(() => {
    if (!clipId) return new Set<string>();
    const props = new Set<string>();
    const keyframes = getClipKeyframes(clipId);
    keyframes.forEach((kf) => props.add(kf.property));
    return props;
  }, [clipId, getClipKeyframes]);

  // If no clip is selected in this track, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-labels" />;
  }

  // Get friendly names for properties
  const getPropertyLabel = (prop: string): string => {
    const labels: Record<string, string> = {
      'opacity': 'Opacity',
      'position.x': 'Pos X',
      'position.y': 'Pos Y',
      'position.z': 'Pos Z',
      'scale.x': 'Scale X',
      'scale.y': 'Scale Y',
      'rotation.x': 'Rot X',
      'rotation.y': 'Rot Y',
      'rotation.z': 'Rot Z',
    };
    if (labels[prop]) return labels[prop];
    // Handle effect properties: effect.{id}.{param} -> param name
    if (prop.startsWith('effect.')) {
      const parts = prop.split('.');
      return parts[parts.length - 1];
    }
    return prop;
  };

  // Convert Set to sorted array for consistent ordering
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
    <div className="track-property-labels">
      {sortedProperties.map((prop) => (
        <div key={prop} className="property-label-row flat">
          <span className="property-label">{getPropertyLabel(prop)}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineHeaderComponent({
  track,
  isDimmed,
  isExpanded,
  dynamicHeight,
  hasKeyframes,
  selectedClipIds,
  clips,
  onToggleExpand,
  onToggleSolo,
  onToggleMuted,
  onToggleVisible,
  onRenameTrack,
  onWheel,
  getClipKeyframes,
}: TimelineHeaderProps) {
  // Get the first selected clip in this track
  const trackClips = clips.filter((c) => c.trackId === track.id);
  const selectedTrackClip = trackClips.find((c) => selectedClipIds.has(c.id));

  // Editing state for track name
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle double-click on name to edit
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(track.name);
    setIsEditing(true);
  };

  // Handle finishing edit
  const handleFinishEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.name) {
      onRenameTrack(trimmed);
    }
    setIsEditing(false);
  };

  // Handle key press in input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(track.name);
    }
  };

  // Handle click on header main area (except buttons) to toggle expand
  const handleHeaderClick = (e: React.MouseEvent) => {
    // Don't toggle if editing or if click was on a button
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.track-controls')) return;
    if (track.type === 'video') {
      onToggleExpand();
    }
  };

  return (
    <div
      className={`track-header ${track.type} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      }`}
      style={{ height: dynamicHeight }}
      onWheel={onWheel}
    >
      <div
        className="track-header-top"
        style={{ height: track.height, cursor: track.type === 'video' ? 'pointer' : 'default' }}
        onClick={handleHeaderClick}
      >
        <div className="track-header-main">
          {/* Only video tracks get expand arrow */}
          {track.type === 'video' && (
            <span
              className={`track-expand-arrow ${isExpanded ? 'expanded' : ''} ${
                hasKeyframes ? 'has-keyframes' : ''
              }`}
              title={isExpanded ? 'Collapse properties' : 'Expand properties'}
            >
              {'\u25B6'}
            </span>
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="track-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFinishEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="track-name"
              onDoubleClick={handleDoubleClick}
              title="Double-click to rename"
            >
              {track.name}
            </span>
          )}
        </div>
        <div className="track-controls">
          <button
            className={`btn-icon ${track.solo ? 'solo-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
            title={track.solo ? 'Solo On' : 'Solo Off'}
          >
            S
          </button>
          {track.type === 'audio' && (
            <button
              className={`btn-icon ${track.muted ? 'muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
              title={track.muted ? 'Unmute' : 'Mute'}
            >
              {track.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
            </button>
          )}
          {track.type === 'video' && (
            <button
              className={`btn-icon ${!track.visible ? 'hidden' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
              title={track.visible ? 'Hide' : 'Show'}
            >
              {track.visible ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
            </button>
          )}
        </div>
      </div>
      {/* Property labels - shown when track is expanded */}
      {track.type === 'video' && isExpanded && (
        <TrackPropertyLabels
          selectedClip={selectedTrackClip || null}
          getClipKeyframes={getClipKeyframes}
        />
      )}
    </div>
  );
}

export const TimelineHeader = memo(TimelineHeaderComponent);
