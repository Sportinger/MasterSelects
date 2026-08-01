import { useCallback, useMemo, useRef, useState } from 'react';
import {
  parseMaskProperty,
  type AnimatableProperty,
} from '../../../types/animationProperties';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipTransform } from '../../../types/timelineCore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  getCameraLookRotationAxis,
  resolveCameraLookAtFixedEyeUpdates,
} from '../../../engine/scene/CameraClipControlUtils';
import {
  formatHeaderPropertyValue,
  getHeaderPropertyCurrentValue,
  getHeaderPropertyDefaultValue,
  getHeaderPropertyLabel,
  getHeaderPropertySensitivity,
  getMaskPathValue,
  type KeyframeTrackClip,
  usesCameraPropertyModel,
} from '../utils/timelineHeaderPropertyModel';

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

export function TimelineHeaderPropertyRow({
  addKeyframe,
  clip,
  clipId,
  getInterpolatedEffects,
  getInterpolatedTransform,
  isAudioTrack,
  isCurveExpanded,
  isKeyframeRowHovered,
  keyframes,
  onKeyframeRowHover,
  onToggleCurveExpanded,
  playheadPosition,
  prop,
  setPlayheadPosition,
  setPropertyValue,
  trackId,
}: {
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  clip: KeyframeTrackClip;
  clipId: string;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  isAudioTrack: boolean;
  isCurveExpanded: boolean;
  isKeyframeRowHovered: boolean;
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
  onToggleCurveExpanded: () => void;
  playheadPosition: number;
  prop: string;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  trackId: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ y: 0, value: 0 });
  const ignoreNextKeyframeButtonClick = useRef(false);
  const keyframeButtonDragId = `${clipId}:${prop}`;

  const propKeyframes = useMemo(() =>
    keyframes.filter(kf => kf.property === prop).sort((a, b) => a.time - b.time),
    [keyframes, prop]
  );

  const clipLocalTime = playheadPosition - clip.startTime;
  const isWithinClip = clipLocalTime >= 0 && clipLocalTime <= clip.duration;

  const currentValue = useMemo(() => getHeaderPropertyCurrentValue({
    clip,
    clipId,
    clipLocalTime,
    getInterpolatedEffects,
    getInterpolatedTransform,
    isWithinClip,
    keyframes,
    prop,
  }), [clip, clipId, clipLocalTime, isWithinClip, getInterpolatedTransform, getInterpolatedEffects, keyframes, prop]);

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

  const hasKeyframeAtPlayhead = propKeyframes.some(kf => Math.abs(kf.time - clipLocalTime) < 0.01);

  const applyPropertyValue = (value: number) => {
    if (!isWithinClip) return;
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') return;

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

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isWithinClip) return;
    if (parseMaskProperty(prop)?.property === 'path') return;
    applyPropertyValue(getHeaderPropertyDefaultValue(prop, clip));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (parseMaskProperty(prop)?.property === 'path') return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStart.current = { y: e.clientY, value: currentValue };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = dragStart.current.y - moveEvent.clientY;
      let sensitivity = getHeaderPropertySensitivity(prop, clip);
      if (moveEvent.shiftKey && moveEvent.altKey) sensitivity *= 0.1;
      else if (moveEvent.shiftKey) sensitivity *= 10;

      applyPropertyValue(dragStart.current.value + deltaY * sensitivity);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const jumpToPrev = () => {
    if (prevKeyframe) {
      setPlayheadPosition(clip.startTime + prevKeyframe.time);
    }
  };

  const jumpToNext = () => {
    if (nextKeyframe) {
      setPlayheadPosition(clip.startTime + nextKeyframe.time);
    }
  };

  const toggleKeyframe = useCallback(() => {
    if (!isWithinClip) return;
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') {
      const store = useTimelineStore.getState();
      const runtimeMask = store
        .getInterpolatedMasks(clipId, clipLocalTime)
        ?.find(mask => mask.id === maskProperty.maskId);
      const pathValue = runtimeMask ? getMaskPathValue(runtimeMask) : undefined;
      store.addMaskPathKeyframe(clipId, maskProperty.maskId, pathValue, clipLocalTime);
      return;
    }
    addKeyframe(clipId, prop as AnimatableProperty, currentValue);
  }, [addKeyframe, clipId, clipLocalTime, currentValue, isWithinClip, prop]);

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
        title="Double-click to open in Graph"
      >
        <span className="property-label">{getHeaderPropertyLabel(prop, clip, isAudioTrack)}</span>
        <div className="property-keyframe-controls">
          <button
            className={`kf-nav-btn ${prevKeyframe ? '' : 'disabled'}`}
            onClick={jumpToPrev}
            title="Previous keyframe"
          >
            {'\u25C0'}
          </button>
          <button
            className={`kf-add-btn ${hasKeyframeAtPlayhead ? 'has-keyframe' : ''}`}
            onPointerDown={handleKeyframeButtonPointerDown}
            onPointerEnter={handleKeyframeButtonPointerEnter}
            onClick={handleKeyframeButtonClick}
            title={hasKeyframeAtPlayhead ? 'Keyframe exists' : 'Add keyframe'}
          >
            {'\u25C6'}
          </button>
          <button
            className={`kf-nav-btn ${nextKeyframe ? '' : 'disabled'}`}
            onClick={jumpToNext}
            title="Next keyframe"
          >
            {'\u25B6'}
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
                usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y' || prop === 'position.z')
                  ? currentValue.toFixed(3)
                  : formatHeaderPropertyValue(currentValue, prop, clip)
              )
            : '\u2014'}
        </span>
      </div>
    </>
  );
}
