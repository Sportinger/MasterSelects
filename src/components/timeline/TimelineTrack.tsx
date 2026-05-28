// TimelineTrack component - Individual track row

import React, { memo, useMemo, useRef, useEffect, useState } from 'react';
import type { TimelineTrackProps } from './types';
import type { AnimatableProperty, BezierHandle, ClipMask, Keyframe } from '../../types';
import { CurveEditor } from './CurveEditor';
import { parseVectorAnimationInputProperty, parseVectorAnimationStateProperty } from '../../types/vectorAnimation';

const TRACK_VIEWPORT_FALLBACK_PX = 1600;
const TRACK_VIEWPORT_MIN_PX = 1600;
const TRACK_RENDER_OVERSCAN_PX = 1200;
const EPSILON = 0.0001;

type KeyframeTrackClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
  masks?: ClipMask[];
  effects?: Array<{ id: string; name: string; params: Record<string, unknown> }>;
  source?: {
    type?: string;
    gaussianSplatSettings?: {
      render?: {
        useNativeRenderer?: boolean;
      };
    };
  } | null;
};

const usesCameraPropertyModel = (clip: KeyframeTrackClip | null | undefined): boolean => {
  if (!clip?.source) return false;
  return clip.source.type === 'camera';
};

const shouldHide3DOnlyProperties = (clip: KeyframeTrackClip | null | undefined): boolean => {
  return !clip?.is3D && !usesCameraPropertyModel(clip);
};

const getTransformPropertyOrder = (clip: KeyframeTrackClip | null | undefined): string[] => (
  usesCameraPropertyModel(clip)
    ? ['camera.fov', 'camera.near', 'camera.far', 'camera.resolutionWidth', 'camera.resolutionHeight', 'opacity', 'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z']
);

// Render keyframe tracks for timeline area (right column) - flat list without folder structure
function TrackPropertyTracks({
  trackId,
  selectedClip,
  clipKeyframes,
  renderKeyframeDiamonds,
  expandedCurveProperties,
  activeTimelineToolId,
  selectedKeyframeIds,
  onSelectKeyframe,
  onMoveKeyframe,
  onUpdateBezierHandle,
  addKeyframe,
  timeToPixel,
  pixelToTime,
}: {
  trackId: string;
  selectedClip: KeyframeTrackClip | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  renderKeyframeDiamonds: (trackId: string, property: AnimatableProperty) => React.ReactNode;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  activeTimelineToolId: TimelineTrackProps['activeTimelineToolId'];
  selectedKeyframeIds: Set<string>;
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  onMoveKeyframe: (keyframeId: string, newTime: number) => void;
  onUpdateBezierHandle: (keyframeId: string, handle: 'in' | 'out', position: BezierHandle) => void;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  timeToPixel: (time: number) => number;
  pixelToTime: (pixel: number) => number;
}) {
  const clipId = selectedClip?.id;

  // Get keyframes for this clip - use clipKeyframes map to trigger re-render when keyframes change
  const keyframeProperties = useMemo(() => {
    if (!clipId) return new Set<string>();
    const props = new Set<string>();
    const keyframes = clipKeyframes.get(clipId) || [];
    keyframes.forEach((kf) => props.add(kf.property));
    // Hide 3D-only properties (rotation X/Y, position Z, scale Z) when clip is not 3D
    if (shouldHide3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [clipId, clipKeyframes, selectedClip]);

  // Track container ref for getting width
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // If no clip is selected in this track or no keyframes, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-tracks" ref={containerRef} />;
  }

  // Convert Set to sorted array for consistent ordering (matching the labels)
  const sortedProperties = Array.from(keyframeProperties).sort((a, b) => {
    const order = getTransformPropertyOrder(selectedClip);
    const aIdx = order.indexOf(a);
    const bIdx = order.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    const aLottieState = parseVectorAnimationStateProperty(a);
    const bLottieState = parseVectorAnimationStateProperty(b);
    if (aLottieState && bLottieState) return 0;
    if (aLottieState) return -1;
    if (bLottieState) return 1;
    const aLottieInput = parseVectorAnimationInputProperty(a);
    const bLottieInput = parseVectorAnimationInputProperty(b);
    if (aLottieInput && bLottieInput) return aLottieInput.inputName.localeCompare(bLottieInput.inputName);
    if (aLottieInput) return -1;
    if (bLottieInput) return 1;
    return a.localeCompare(b);
  });

  // Get expanded curve properties for this track
  const trackCurveProps = expandedCurveProperties.get(trackId);

  // Get all keyframes for this clip
  const allKeyframes = clipKeyframes.get(selectedClip.id) || [];

  const resolvePenKeyframeValue = (
    keyframes: Array<{ time: number; value: number }>,
    time: number,
  ): number => {
    const sorted = keyframes.toSorted((a, b) => a.time - b.time);
    if (sorted.length === 0) return 0;
    if (time <= sorted[0].time) return sorted[0].value;
    const last = sorted[sorted.length - 1];
    if (time >= last.time) return last.value;

    for (let index = 1; index < sorted.length; index += 1) {
      const next = sorted[index];
      if (time > next.time) continue;
      const previous = sorted[index - 1];
      const span = Math.max(EPSILON, next.time - previous.time);
      const progress = Math.max(0, Math.min(1, (time - previous.time) / span));
      return previous.value + (next.value - previous.value) * progress;
    }

    return last.value;
  };

  const handlePenKeyframeMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    property: AnimatableProperty,
    propertyKeyframes: Array<{ time: number; value: number }>,
  ) => {
    if (activeTimelineToolId !== 'pen-keyframe') return;
    if (event.button !== 0 || !selectedClip) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const absoluteTime = pixelToTime(event.clientX - rect.left);
    const localTime = Math.max(0, Math.min(selectedClip.duration, absoluteTime - selectedClip.startTime));
    const value = resolvePenKeyframeValue(propertyKeyframes, localTime);
    addKeyframe(selectedClip.id, property, value, localTime, 'linear');
  };

  return (
    <div className="track-property-tracks" ref={containerRef}>
      {sortedProperties.map((prop) => {
        const isCurveExpanded = trackCurveProps?.has(prop as AnimatableProperty) ?? false;
        const propKeyframes = allKeyframes.filter(kf => kf.property === prop);

        return (
          <div key={prop} className={`keyframe-track-row flat ${isCurveExpanded ? 'curve-expanded' : ''}`}>
            <div
              className="keyframe-track"
              onMouseDown={(event) => handlePenKeyframeMouseDown(event, prop as AnimatableProperty, propKeyframes)}
            >
              <div className="keyframe-track-line" />
              {renderKeyframeDiamonds(trackId, prop as AnimatableProperty)}
            </div>
            {isCurveExpanded && (
              <CurveEditor
                trackId={trackId}
                clipId={selectedClip.id}
                property={prop as AnimatableProperty}
                keyframes={propKeyframes as Keyframe[]}
                clipStartTime={selectedClip.startTime}
                clipDuration={selectedClip.duration}
                width={containerWidth}
                selectedKeyframeIds={selectedKeyframeIds}
                onSelectKeyframe={onSelectKeyframe}
                onMoveKeyframe={(id, newTime, _newValue) => {
                  onMoveKeyframe(id, newTime);
                }}
                onUpdateBezierHandle={onUpdateBezierHandle}
                timeToPixel={timeToPixel}
                pixelToTime={pixelToTime}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelineTrackComponent({
  track,
  trackColor,
  clips,
  isDimmed,
  isExpanded,
  baseHeight,
  dynamicHeight,
  isDragTarget,
  isExternalDragTarget,
  selectedClipIds,
  selectedKeyframeIds,
  activeTimelineToolId,
  clipDrag,
  clipTrim,
  externalDrag,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onResizeStart,
  isResizeActive = false,
  renderClip,
  clipKeyframes,
  renderKeyframeDiamonds,
  timeToPixel,
  pixelToTime,
  zoom,
  scrollX,
  expandedCurveProperties,
  onSelectKeyframe,
  onMoveKeyframe,
  onUpdateBezierHandle,
  addKeyframe,
}: TimelineTrackProps) {
  // Deduplicate by clip id so transient store/render races do not produce duplicate React keys.
  const allTrackClips = useMemo(() => {
    const uniqueClips = new Map<string, typeof clips[number]>();
    clips.forEach((clip) => {
      if (clip.trackId !== track.id || uniqueClips.has(clip.id)) return;
      uniqueClips.set(clip.id, clip);
    });
    return Array.from(uniqueClips.values());
  }, [clips, track.id]);
  const viewportWidth = typeof window === 'undefined'
    ? TRACK_VIEWPORT_FALLBACK_PX
    : Math.max(TRACK_VIEWPORT_MIN_PX, window.innerWidth);
  const visibleStartTime = Math.max(0, (scrollX - TRACK_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001));
  const visibleEndTime = (scrollX + viewportWidth + TRACK_RENDER_OVERSCAN_PX) / Math.max(zoom, 0.001);
  const trackClips = useMemo(() => {
    const draggedClipIds = new Set<string>();
    if (clipDrag) {
      draggedClipIds.add(clipDrag.clipId);
      clipDrag.multiSelectClipIds?.forEach((clipId) => draggedClipIds.add(clipId));
    }

    return allTrackClips.filter((clip) => {
      if (selectedClipIds.has(clip.id) || draggedClipIds.has(clip.id) || clipTrim?.clipId === clip.id) {
        return true;
      }
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      return clipEnd >= visibleStartTime && clipStart <= visibleEndTime;
    });
  }, [allTrackClips, clipDrag, clipTrim?.clipId, selectedClipIds, visibleEndTime, visibleStartTime]);
  const trackClipIds = useMemo(() => new Set(allTrackClips.map((clip) => clip.id)), [allTrackClips]);
  const selectedTrackClip = allTrackClips.find((c) => selectedClipIds.has(c.id));
  const trackLaneStyle = {
    height: dynamicHeight,
    ...(trackColor ? { '--track-color': trackColor } : {}),
  } as React.CSSProperties & { '--track-color'?: string };
  const isMutedTrack = track.type === 'audio' && (track.audioState?.muted ?? track.muted) === true;
  const isHiddenTrack = track.type === 'video' && track.visible === false;
  const renderExternalPreview = (
    className: string,
    left: number,
    width: number,
    label: string,
    thumbnailUrl?: string,
  ) => (
    <div
      className={`${className}${thumbnailUrl ? ' has-thumbnail' : ''}`}
      style={{
        left,
        width,
      }}
    >
      {thumbnailUrl && (
        <div
          className="timeline-clip-preview-thumbnail"
          style={{ backgroundImage: `url("${thumbnailUrl.replace(/"/g, '\\"')}")` }}
        />
      )}
      <div className="clip-content">
        <span className="clip-name">{label}</span>
      </div>
    </div>
  );

  return (
    <div
      className={`track-lane ${track.type} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      } ${isDragTarget ? 'drag-target' : ''} ${
        isExternalDragTarget ? 'external-drag-target' : ''
      } ${track.locked ? 'locked' : ''} ${isMutedTrack ? 'track-muted' : ''} ${
        isHiddenTrack ? 'track-hidden' : ''
      } ${isResizeActive ? 'resizing' : ''}`}
      data-track-id={track.id}
      data-dock-layout-child-anim-id={`timeline-track-lane:${track.id}`}
      style={trackLaneStyle}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      {/* Clip row - the normal clip area */}
      <div className="track-clip-row" style={{ height: baseHeight }}>
        {/* Render clips belonging to this track */}
        {trackClips.map((clip) => renderClip(clip, track.id))}
        {/* Render clip being dragged TO this track */}
        {clipDrag &&
          clipDrag.currentTrackId === track.id &&
          clipDrag.originalTrackId !== track.id &&
          clips
            .filter((c) => c.id === clipDrag.clipId && !trackClipIds.has(c.id))
            .map((clip) => renderClip(clip, track.id))}
        {/* External file drag preview - video clip */}
        {externalDrag && externalDrag.trackId === track.id && renderExternalPreview(
          'timeline-clip-preview',
          timeToPixel(externalDrag.startTime),
          timeToPixel(externalDrag.duration ?? 5),
          externalDrag.label ?? 'Drop to add clip',
          externalDrag.thumbnailUrl,
        )}
        {/* External file drag preview - linked audio clip (when hovering video track) */}
        {externalDrag &&
          externalDrag.audioTrackId === track.id && renderExternalPreview(
            'timeline-clip-preview audio',
            timeToPixel(externalDrag.startTime),
            timeToPixel(externalDrag.duration ?? 5),
            'Audio (linked)',
          )}
        {/* External file drag preview - linked video clip (when hovering audio track) */}
        {externalDrag &&
          externalDrag.videoTrackId === track.id && renderExternalPreview(
            'timeline-clip-preview video',
            timeToPixel(externalDrag.startTime),
            timeToPixel(externalDrag.duration ?? 5),
            externalDrag.label ?? 'Video',
            externalDrag.thumbnailUrl,
          )}
      </div>
      {/* Property rows - only shown when track is expanded (for both video and audio) */}
      {(track.type === 'video' || track.type === 'audio') && isExpanded && (
        <TrackPropertyTracks
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          clipKeyframes={clipKeyframes}
          renderKeyframeDiamonds={renderKeyframeDiamonds}
          expandedCurveProperties={expandedCurveProperties}
          activeTimelineToolId={activeTimelineToolId}
          selectedKeyframeIds={selectedKeyframeIds}
          onSelectKeyframe={onSelectKeyframe}
          onMoveKeyframe={onMoveKeyframe}
          onUpdateBezierHandle={onUpdateBezierHandle}
          addKeyframe={addKeyframe}
          timeToPixel={timeToPixel}
          pixelToTime={pixelToTime}
        />
      )}
      {onResizeStart && (
        <div
          className={`track-resize-handle track-resize-handle-lane ${isResizeActive ? 'active' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize track height"
          onPointerDown={(event) => onResizeStart(event, track.id)}
        />
      )}
    </div>
  );
}

export const TimelineTrack = memo(TimelineTrackComponent);
