// TimelineHeader component - Track headers (left side)

import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { TimelineHeaderProps } from './types';
import type { AnimatableProperty, ClipTransform, Keyframe, TimelineClip } from '../../types';
import { CurveEditorHeader } from './CurveEditorHeader';
import { useMediaStore } from '../../stores/mediaStore';
import {
  getCameraLookRotationAxis,
  resolveCameraLookAtFixedEyeUpdates,
} from '../../engine/scene/CameraClipControlUtils';

type KeyframeTrackClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
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
    ? ['opacity', 'position.x', 'position.y', 'scale.z', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z']
);

// Get friendly names for properties
const getPropertyLabel = (prop: string, clip?: KeyframeTrackClip | null): string => {
  if (usesCameraPropertyModel(clip)) {
    if (prop === 'position.z') return 'Dist';
    if (prop === 'rotation.x') return 'Pitch';
    if (prop === 'rotation.y') return 'Yaw';
    if (prop === 'scale.z') return 'Move Z';
    if (prop === 'scale.all') return 'Zoom';
  }

  const labels: Record<string, string> = {
    'opacity': 'Opacity',
    'position.x': 'Pos X',
    'position.y': 'Pos Y',
    'position.z': 'Pos Z',
    'scale.all': 'Scale All',
    'scale.x': 'Scale X',
    'scale.y': 'Scale Y',
    'scale.z': 'Scale Z',
    'rotation.x': 'Rot X',
    'rotation.y': 'Rot Y',
    'rotation.z': 'Rot Z',
  };
  if (labels[prop]) return labels[prop];
  if (prop.startsWith('effect.')) {
    const parts = prop.split('.');
    const paramName = parts[parts.length - 1];
    // Audio effect friendly names
    const audioLabels: Record<string, string> = {
      'volume': 'Volume',
      'band31': '31Hz',
      'band62': '62Hz',
      'band125': '125Hz',
      'band250': '250Hz',
      'band500': '500Hz',
      'band1k': '1kHz',
      'band2k': '2kHz',
      'band4k': '4kHz',
      'band8k': '8kHz',
      'band16k': '16kHz',
    };
    return audioLabels[paramName] || paramName;
  }
  return prop;
};

// Get value from transform based on property path
const getValueFromTransform = (transform: ClipTransform, prop: string): number => {
  switch (prop) {
    case 'opacity': return transform.opacity;
    case 'position.x': return transform.position.x;
    case 'position.y': return transform.position.y;
    case 'position.z': return transform.position.z;
    case 'scale.all': return transform.scale.all ?? 1;
    case 'scale.x': return transform.scale.x;
    case 'scale.y': return transform.scale.y;
    case 'scale.z': return transform.scale.z ?? 0;
    case 'rotation.x': return transform.rotation.x;
    case 'rotation.y': return transform.rotation.y;
    case 'rotation.z': return transform.rotation.z;
    default: return 0;
  }
};

// Format value for display
const formatValue = (value: number, prop: string): string => {
  if (prop === 'opacity') return (value * 100).toFixed(0) + '%';
  if (prop.startsWith('rotation')) return value.toFixed(1) + '°';
  if (prop.startsWith('scale')) return (value * 100).toFixed(0) + '%';
  // Audio effect formatting
  if (prop.includes('.volume')) return (value * 100).toFixed(0) + '%';
  if (prop.includes('.band')) return (value > 0 ? '+' : '') + value.toFixed(1) + 'dB';
  return value.toFixed(1);
};

// Get value from effects for effect properties
const getValueFromEffects = (
  effects: Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>,
  prop: string
): number => {
  // Effect properties are formatted as "effect.{effectId}.{paramName}"
  const parts = prop.split('.');
  if (parts.length !== 3 || parts[0] !== 'effect') return 0;

  const effectId = parts[1];
  const paramName = parts[2];

  const effect = effects.find(e => e.id === effectId);
  if (!effect) return 0;

  const value = effect.params[paramName];
  return typeof value === 'number' ? value : 0;
};

type PropertyKeyframeDragSession = {
  pointerId: number;
  visited: Set<string>;
};

let propertyKeyframeDragSession: PropertyKeyframeDragSession | null = null;

function endPropertyKeyframeDrag() {
  propertyKeyframeDragSession = null;
  window.removeEventListener('pointerup', endPropertyKeyframeDrag);
  window.removeEventListener('pointercancel', endPropertyKeyframeDrag);
  window.removeEventListener('blur', endPropertyKeyframeDrag);
}

// Single property row with value display and keyframe controls
function PropertyRow({
  prop,
  clipId,
  trackId,
  clip,
  keyframes,
  playheadPosition,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  isCurveExpanded,
  isKeyframeRowHovered,
  onToggleCurveExpanded,
  onKeyframeRowHover,
}: {
  prop: string;
  clipId: string;
  trackId: string;
  clip: KeyframeTrackClip;
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>;
  playheadPosition: number;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  isCurveExpanded: boolean;
  isKeyframeRowHovered: boolean;
  onToggleCurveExpanded: () => void;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ y: 0, value: 0 });
  const ignoreNextKeyframeButtonClick = useRef(false);
  const keyframeButtonDragId = `${clipId}:${prop}`;

  // Get keyframes for this property only, sorted by time
  const propKeyframes = useMemo(() =>
    keyframes.filter(kf => kf.property === prop).sort((a, b) => a.time - b.time),
    [keyframes, prop]
  );

  // Calculate clip-local time
  const clipLocalTime = playheadPosition - clip.startTime;
  const isWithinClip = clipLocalTime >= 0 && clipLocalTime <= clip.duration;

  // Get current interpolated value (keyframes in deps triggers recalc when values change)
  const currentValue = useMemo(() => {
    if (!isWithinClip) return 0;
    // Effect properties use getInterpolatedEffects
    if (prop.startsWith('effect.')) {
      const effects = getInterpolatedEffects(clipId, clipLocalTime);
      return getValueFromEffects(effects, prop);
    }
    // Transform properties use getInterpolatedTransform
    const transform = getInterpolatedTransform(clipId, clipLocalTime);
    return getValueFromTransform(transform, prop);
  }, [clipId, clipLocalTime, isWithinClip, getInterpolatedTransform, getInterpolatedEffects, prop]);

  // Find prev/next keyframes relative to playhead
  const prevKeyframe = useMemo(() => {
    for (let i = propKeyframes.length - 1; i >= 0; i--) {
      if (propKeyframes[i].time < clipLocalTime) return propKeyframes[i];
    }
    return null;
  }, [propKeyframes, clipLocalTime]);

  const nextKeyframe = useMemo(() => {
    for (const kf of propKeyframes) {
      if (kf.time > clipLocalTime) return kf;
    }
    return null;
  }, [propKeyframes, clipLocalTime]);

  // Check if there's a keyframe at current time
  const hasKeyframeAtPlayhead = propKeyframes.some(kf => Math.abs(kf.time - clipLocalTime) < 0.01);

  // Get base sensitivity based on property type
  const getBaseSensitivity = () => {
    if (prop === 'opacity') return 0.005; // 0-1 range
    if (usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y')) return 0.01;
    if (usesCameraPropertyModel(clip) && prop === 'position.z') return 0.05;
    if (usesCameraPropertyModel(clip) && prop === 'scale.z') return 0.1;
    if (prop.startsWith('scale')) return 0.005; // typically 0-2 range
    if (prop.startsWith('rotation')) return 0.5; // degrees
    if (prop.startsWith('position')) return 1; // pixels
    // Audio effect properties
    if (prop.includes('.volume')) return 0.005; // 0-1 range
    if (prop.includes('.band')) return 0.1; // dB range (-12 to 12)
    return 0.1;
  };

  // Get default value for property
  const getDefaultValue = () => {
    if (prop === 'opacity') return 1;
    if (usesCameraPropertyModel(clip) && prop === 'scale.z') return 0;
    if (prop.startsWith('scale')) return 1;
    if (prop.startsWith('rotation')) return 0;
    if (prop.startsWith('position')) return 0;
    // Audio effect properties
    if (prop.includes('.volume')) return 1; // 100%
    if (prop.includes('.band')) return 0; // 0 dB (no boost/cut)
    return 0;
  };

  const applyPropertyValue = (value: number) => {
    if (!isWithinClip) return;

    const cameraLookAxis = usesCameraPropertyModel(clip)
      ? getCameraLookRotationAxis(prop)
      : null;
    if (!cameraLookAxis) {
      setPropertyValue(clipId, prop as AnimatableProperty, value);
      return;
    }

    const activeComp = useMediaStore.getState().getActiveComposition?.();
    const transform = getInterpolatedTransform(clipId, clipLocalTime);
    const updates = resolveCameraLookAtFixedEyeUpdates(
      clip as TimelineClip,
      transform,
      { [cameraLookAxis]: value },
      {
        width: activeComp?.width ?? 1920,
        height: activeComp?.height ?? 1080,
      },
    );

    if (!updates) {
      setPropertyValue(clipId, prop as AnimatableProperty, value);
      return;
    }

    updates.forEach(({ property, value: updateValue }) => {
      addKeyframe(clipId, property, updateValue);
    });
  };

  // Reset to default value (right-click)
  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isWithinClip) return;
    applyPropertyValue(getDefaultValue());
  };

  // Handle value scrubbing (left-click drag)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStart.current = { y: e.clientY, value: currentValue };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = dragStart.current.y - moveEvent.clientY;
      let sensitivity = getBaseSensitivity();
      if (moveEvent.shiftKey && moveEvent.altKey) sensitivity *= 0.1; // Slow mode
      else if (moveEvent.shiftKey) sensitivity *= 10; // Fast mode

      const newValue = dragStart.current.value + deltaY * sensitivity;
      applyPropertyValue(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Jump to previous keyframe
  const jumpToPrev = () => {
    if (prevKeyframe) {
      setPlayheadPosition(clip.startTime + prevKeyframe.time);
    }
  };

  // Jump to next keyframe
  const jumpToNext = () => {
    if (nextKeyframe) {
      setPlayheadPosition(clip.startTime + nextKeyframe.time);
    }
  };

  // Add/toggle keyframe at current position
  const toggleKeyframe = useCallback(() => {
    if (!isWithinClip) return;
    addKeyframe(clipId, prop as AnimatableProperty, currentValue);
  }, [addKeyframe, clipId, currentValue, isWithinClip, prop]);

  const applyKeyframeButtonForDrag = useCallback(() => {
    const session = propertyKeyframeDragSession;
    if (!session || session.visited.has(keyframeButtonDragId)) return;

    session.visited.add(keyframeButtonDragId);
    toggleKeyframe();
  }, [keyframeButtonDragId, toggleKeyframe]);

  const handleKeyframeButtonPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    ignoreNextKeyframeButtonClick.current = true;

    endPropertyKeyframeDrag();
    propertyKeyframeDragSession = {
      pointerId: e.pointerId,
      visited: new Set([keyframeButtonDragId]),
    };
    window.addEventListener('pointerup', endPropertyKeyframeDrag);
    window.addEventListener('pointercancel', endPropertyKeyframeDrag);
    window.addEventListener('blur', endPropertyKeyframeDrag);

    toggleKeyframe();
  }, [keyframeButtonDragId, toggleKeyframe]);

  const handleKeyframeButtonPointerEnter = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const session = propertyKeyframeDragSession;
    if (!session) return;

    if ((e.buttons & 1) !== 1 || e.pointerId !== session.pointerId) {
      endPropertyKeyframeDrag();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    applyKeyframeButtonForDrag();
  }, [applyKeyframeButtonForDrag]);

  const handleKeyframeButtonClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (ignoreNextKeyframeButtonClick.current) {
      ignoreNextKeyframeButtonClick.current = false;
      e.preventDefault();
      return;
    }

    toggleKeyframe();
  }, [toggleKeyframe]);

  // Handle double-click to toggle curve editor
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCurveExpanded();
  };

  return (
    <>
      <div
        className={`property-label-row flat ${isDragging ? 'dragging' : ''} ${isCurveExpanded ? 'curve-expanded' : ''} ${isKeyframeRowHovered ? 'keyframe-row-highlighted' : ''}`}
        onMouseEnter={() => onKeyframeRowHover?.(trackId, prop as AnimatableProperty, true)}
        onMouseLeave={() => onKeyframeRowHover?.(trackId, prop as AnimatableProperty, false)}
        onDoubleClick={handleDoubleClick}
        title="Double-click to toggle curve editor"
      >
        <span className="property-label">{getPropertyLabel(prop, clip)}</span>
        <div className="property-keyframe-controls">
          <button
            className={`kf-nav-btn ${prevKeyframe ? '' : 'disabled'}`}
            onClick={jumpToPrev}
            title="Previous keyframe"
          >
            ◀
          </button>
          <button
            className={`kf-add-btn ${hasKeyframeAtPlayhead ? 'has-keyframe' : ''}`}
            onPointerDown={handleKeyframeButtonPointerDown}
            onPointerEnter={handleKeyframeButtonPointerEnter}
            onClick={handleKeyframeButtonClick}
            title={hasKeyframeAtPlayhead ? 'Keyframe exists' : 'Add keyframe'}
          >
            ◆
          </button>
          <button
            className={`kf-nav-btn ${nextKeyframe ? '' : 'disabled'}`}
            onClick={jumpToNext}
            title="Next keyframe"
          >
            ▶
          </button>
        </div>
        <span
          className="property-value"
          onMouseDown={handleMouseDown}
          onContextMenu={handleRightClick}
          title="Drag to scrub, Right-click to reset"
        >
          {isWithinClip
            ? (
                usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y' || prop === 'position.z' || prop === 'scale.z')
                  ? currentValue.toFixed(3)
                  : formatValue(currentValue, prop)
              )
            : '—'}
        </span>
      </div>
      {isCurveExpanded && (
        <CurveEditorHeader
          property={prop as AnimatableProperty}
          keyframes={propKeyframes as Keyframe[]}
          onClose={onToggleCurveExpanded}
        />
      )}
    </>
  );
}

// Render property labels for track header (left column) - flat list without folder structure
function TrackPropertyLabels({
  trackId,
  selectedClip,
  clipKeyframes,
  playheadPosition,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  expandedCurveProperties,
  onToggleCurveExpanded,
  hoveredKeyframeRow,
  onKeyframeRowHover,
}: {
  trackId: string;
  selectedClip: KeyframeTrackClip | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  playheadPosition: number;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  onToggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  hoveredKeyframeRow?: { trackId: string; property: AnimatableProperty } | null;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
}) {
  const clipId = selectedClip?.id;
  const keyframes = useMemo(
    () => (clipId ? clipKeyframes.get(clipId) || [] : []),
    [clipId, clipKeyframes],
  );

  // Get keyframes for this clip - use clipKeyframes map to trigger re-render when keyframes change
  const keyframeProperties = useMemo(() => {
    const props = new Set<string>();
    keyframes.forEach((kf) => props.add(kf.property));
    // Hide 3D-only properties when clip is not 3D
    if (shouldHide3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [keyframes, selectedClip]);

  // If no clip is selected in this track, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-labels" />;
  }

  // Convert Set to sorted array for consistent ordering
  const sortedProperties = Array.from(keyframeProperties).sort((a, b) => {
    // Transform properties order
    const transformOrder = getTransformPropertyOrder(selectedClip);
    // Audio effect properties order (volume first, then bands by frequency)
    const audioParamOrder = ['volume', 'band31', 'band62', 'band125', 'band250', 'band500', 'band1k', 'band2k', 'band4k', 'band8k', 'band16k'];

    const aIdx = transformOrder.indexOf(a);
    const bIdx = transformOrder.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    // For effect properties, extract the param name and sort
    if (a.startsWith('effect.') && b.startsWith('effect.')) {
      const aParam = a.split('.').pop() || '';
      const bParam = b.split('.').pop() || '';
      const aAudioIdx = audioParamOrder.indexOf(aParam);
      const bAudioIdx = audioParamOrder.indexOf(bParam);
      if (aAudioIdx !== -1 && bAudioIdx !== -1) return aAudioIdx - bAudioIdx;
      if (aAudioIdx !== -1) return -1;
      if (bAudioIdx !== -1) return 1;
    }

    return a.localeCompare(b);
  });

  // Check if property has curve editor expanded
  const trackCurveProps = expandedCurveProperties.get(trackId);

  return (
    <div className="track-property-labels">
      {sortedProperties.map((prop) => {
        const isCurveExpanded = trackCurveProps?.has(prop as AnimatableProperty) ?? false;
        const isKeyframeRowHovered =
          hoveredKeyframeRow?.trackId === trackId &&
          hoveredKeyframeRow.property === prop;
        return (
          <PropertyRow
            key={prop}
            prop={prop}
            clipId={selectedClip.id}
            trackId={trackId}
            clip={selectedClip}
            keyframes={keyframes}
            playheadPosition={playheadPosition}
            getInterpolatedTransform={getInterpolatedTransform}
            getInterpolatedEffects={getInterpolatedEffects}
            addKeyframe={addKeyframe}
            setPlayheadPosition={setPlayheadPosition}
            setPropertyValue={setPropertyValue}
            isCurveExpanded={isCurveExpanded}
            isKeyframeRowHovered={isKeyframeRowHovered}
            onToggleCurveExpanded={() => onToggleCurveExpanded(trackId, prop as AnimatableProperty)}
            onKeyframeRowHover={onKeyframeRowHover}
          />
        );
      })}
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
  playheadPosition,
  onToggleExpand,
  onToggleSolo,
  onToggleMuted,
  onToggleVisible,
  onRenameTrack,
  onContextMenu,
  onWheel,
  clipKeyframes,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  expandedCurveProperties,
  onToggleCurveExpanded,
  hoveredKeyframeRow,
  onKeyframeRowHover,
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
    // Both video and audio tracks can expand
    if (track.type === 'video' || track.type === 'audio') {
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
      onContextMenu={onContextMenu}
    >
      <div
        className="track-header-top"
        style={{ height: track.height, cursor: (track.type === 'video' || track.type === 'audio') ? 'pointer' : 'default' }}
        onClick={handleHeaderClick}
      >
        <div className="track-header-main">
          {/* Video and audio tracks always get expand arrow */}
          {(track.type === 'video' || track.type === 'audio') && (
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
          {/* Pick Whip disabled */}
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
      {/* Property labels - shown when track is expanded (for both video and audio with keyframes) */}
      {(track.type === 'video' || track.type === 'audio') && isExpanded && (
        <TrackPropertyLabels
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          clipKeyframes={clipKeyframes}
          playheadPosition={playheadPosition}
          getInterpolatedTransform={getInterpolatedTransform}
          getInterpolatedEffects={getInterpolatedEffects}
          addKeyframe={addKeyframe}
          setPlayheadPosition={setPlayheadPosition}
          setPropertyValue={setPropertyValue}
          expandedCurveProperties={expandedCurveProperties}
          onToggleCurveExpanded={onToggleCurveExpanded}
          hoveredKeyframeRow={hoveredKeyframeRow}
          onKeyframeRowHover={onKeyframeRowHover}
        />
      )}
    </div>
  );
}

export const TimelineHeader = memo(TimelineHeaderComponent);
