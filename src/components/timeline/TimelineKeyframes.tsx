/* @refresh reset */
// TimelineKeyframes component - Keyframe diamonds/handles with drag support

import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TimelineKeyframesProps } from './types';
import type { EasingType, AnimatableProperty, RotationInterpolationMode } from '../../types';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { normalizeEasingType } from '../../utils/easing';
import { parseVectorAnimationStateProperty } from '../../types/vectorAnimation';

interface KeyframeData {
  id: string;
  clipId: string;
  time: number;
  property: AnimatableProperty;
  value: number;
  easing: string;
  rotationInterpolation?: RotationInterpolationMode;
  sourceType?: string;
}

interface KeyframeDisplay {
  kf: KeyframeData;
  clip: TimelineKeyframesProps['clips'][0];
  absTime: number;
}

const KEYFRAME_SNAP_THRESHOLD_PX = 10;

// Easing options for context menu
const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
];

const ROTATION_INTERPOLATION_OPTIONS: { value: RotationInterpolationMode; label: string }[] = [
  { value: 'shortest', label: 'Shortest Path' },
  { value: 'continuous', label: 'Continuous / Orbit' },
];

function isRotationProperty(property: AnimatableProperty): boolean {
  return property.startsWith('rotation.');
}

function getEffectiveRotationInterpolation(kf: KeyframeData): RotationInterpolationMode {
  if (kf.rotationInterpolation) {
    return kf.rotationInterpolation;
  }
  return kf.sourceType === 'camera' ? 'shortest' : 'continuous';
}

function TimelineKeyframesComponent({
  trackId,
  property,
  clips,
  selectedKeyframeIds,
  clipKeyframes,
  clipDrag,
  onSelectKeyframe,
  onMoveKeyframe,
  onUpdateKeyframe,
  onToggleCurveExpanded,
  timeToPixel,
  pixelToTime,
  isRowHovered = false,
  onKeyframeRowHover,
}: TimelineKeyframesProps) {
  // Drag state - includes original times for all selected keyframes
  const [dragState, setDragState] = useState<{
    keyframeId: string;
    clipId: string;
    startX: number;
    originalTimes: Map<string, { time: number; clipId: string }>; // keyframeId -> original time + clipId
    startTime: number;
    clipStartTime: number;
  } | null>(null);

  // AI keyframe animation feedback
  const [aiAnimatedKeyframes, setAiAnimatedKeyframes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const handler = (e: Event) => {
      const { action } = (e as CustomEvent).detail;
      if (action === 'add') {
        // Animate the most recently added keyframe for any clip in this track
        const allKfs = clips.flatMap(c => (clipKeyframes.get(c.id) || []).map(kf => ({ ...kf, clipId: c.id })));
        const latest = allKfs[allKfs.length - 1];
        if (latest) {
          setAiAnimatedKeyframes(prev => new Set([...prev, latest.id]));
          setTimeout(() => {
            setAiAnimatedKeyframes(prev => {
              const next = new Set(prev);
              next.delete(latest.id);
              return next;
            });
          }, 350);
        }
      }
    };
    window.addEventListener('ai-keyframe-feedback', handler);
    return () => window.removeEventListener('ai-keyframe-feedback', handler);
  }, [clips, clipKeyframes]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetKeyframeIds: string[];
    currentEasing: EasingType | null;
    rotationTargetKeyframeIds: string[];
    currentRotationInterpolation: RotationInterpolationMode | null;
  } | null>(null);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  );

  // Get all clips on this track
  const trackClips = useMemo(
    () => clips.filter((c) => c.trackId === trackId),
    [clips, trackId]
  );

  // Get all keyframes once and group by clip/property (without position calculation)
  const allKeyframes = useMemo(() => {
    const result: KeyframeDisplay[] = [];

    trackClips.forEach((clip) => {
      const kfs = clipKeyframes.get(clip.id) || [];
      kfs
        .filter((k) => k.property === property)
        .forEach((kf) => {
          result.push({
            kf,
            clip,
            absTime: clip.startTime + kf.time, // Base time, will be adjusted in render if dragging
          });
        });
    });

    return result;
  }, [trackClips, property, clipKeyframes]);

  const keyframeLookup = useMemo(() => {
    const result = new Map<string, KeyframeData>();

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = clips.find((candidate) => candidate.id === clipId);
      keyframes.forEach((kf) => {
        result.set(kf.id, { ...kf, clipId, sourceType: clip?.source?.type });
      });
    });

    return result;
  }, [clipKeyframes, clips]);

  const getClipSourceType = useCallback((clipId: string): string | undefined => {
    return clips.find((clip) => clip.id === clipId)?.source?.type;
  }, [clips]);

  const getEditableEasingTarget = useCallback((kf: KeyframeData): KeyframeData => {
    const propKeyframes = (clipKeyframes.get(kf.clipId) || [])
      .filter(candidate => candidate.property === kf.property)
      .sort((a, b) => a.time - b.time);
    const keyframeIndex = propKeyframes.findIndex(candidate => candidate.id === kf.id);

    if (keyframeIndex === -1) {
      return kf;
    }

    const target = keyframeIndex === propKeyframes.length - 1 && keyframeIndex > 0
      ? propKeyframes[keyframeIndex - 1]
      : propKeyframes[keyframeIndex];

    return {
      ...target,
      clipId: kf.clipId,
      sourceType: getClipSourceType(kf.clipId),
    };
  }, [clipKeyframes, getClipSourceType]);

  const hasOutgoingPropertySegment = useCallback((kf: KeyframeData): boolean => {
    const propKeyframes = (clipKeyframes.get(kf.clipId) || [])
      .filter(candidate => candidate.property === kf.property)
      .sort((a, b) => a.time - b.time);
    const keyframeIndex = propKeyframes.findIndex(candidate => candidate.id === kf.id);

    return keyframeIndex >= 0 && keyframeIndex < propKeyframes.length - 1;
  }, [clipKeyframes]);

  const getContextMenuTargets = useCallback((clickedKeyframe: KeyframeData) => {
    const shouldApplyToSelection =
      selectedKeyframeIds.has(clickedKeyframe.id) &&
      selectedKeyframeIds.size > 1;

    const sourceIds = shouldApplyToSelection
      ? Array.from(selectedKeyframeIds)
      : [clickedKeyframe.id];

    const sourceKeyframes: KeyframeData[] = [];
    const seenSourceIds = new Set<string>();
    const targetKeyframes: KeyframeData[] = [];
    const seenTargetIds = new Set<string>();

    for (const keyframeId of sourceIds) {
      const sourceKeyframe = keyframeLookup.get(keyframeId);
      if (!sourceKeyframe) continue;

      if (!seenSourceIds.has(sourceKeyframe.id)) {
        seenSourceIds.add(sourceKeyframe.id);
        sourceKeyframes.push(sourceKeyframe);
      }

      const targetKeyframe = getEditableEasingTarget(sourceKeyframe);
      if (seenTargetIds.has(targetKeyframe.id)) continue;

      seenTargetIds.add(targetKeyframe.id);
      targetKeyframes.push(targetKeyframe);
    }

    if (targetKeyframes.length === 0) {
      const fallbackTarget = getEditableEasingTarget(clickedKeyframe);
      targetKeyframes.push(fallbackTarget);
    }
    if (sourceKeyframes.length === 0) {
      sourceKeyframes.push(clickedKeyframe);
    }

    const targetKeyframeIds = targetKeyframes.map((targetKeyframe) => targetKeyframe.id);

    const easingValues = targetKeyframes
      .map((targetKeyframe) => targetKeyframe.easing)
      .filter((easing): easing is string => Boolean(easing))
      .map((easing) => normalizeEasingType(easing, 'linear'));

    const currentEasing = easingValues.length > 0 && easingValues.every((easing) => easing === easingValues[0])
      ? easingValues[0]
      : null;

    const rotationTargetKeyframes = sourceKeyframes.filter((targetKeyframe) =>
      isRotationProperty(targetKeyframe.property) && hasOutgoingPropertySegment(targetKeyframe),
    );
    const rotationValues = rotationTargetKeyframes.map(getEffectiveRotationInterpolation);
    const currentRotationInterpolation =
      rotationValues.length > 0 && rotationValues.every((mode) => mode === rotationValues[0])
        ? rotationValues[0]
        : null;

    return {
      targetKeyframeIds,
      currentEasing,
      rotationTargetKeyframeIds: rotationTargetKeyframes.map((targetKeyframe) => targetKeyframe.id),
      currentRotationInterpolation,
    };
  }, [getEditableEasingTarget, hasOutgoingPropertySegment, keyframeLookup, selectedKeyframeIds]);

  const getRotationPathDisplayMode = useCallback((
    kf: KeyframeData,
    clip: KeyframeDisplay['clip'],
  ): RotationInterpolationMode | null => {
    if (!isRotationProperty(kf.property)) {
      return null;
    }

    const keyframe = {
      ...kf,
      clipId: clip.id,
      sourceType: clip.source?.type,
    };
    if (!hasOutgoingPropertySegment(keyframe)) {
      return null;
    }

    return getEffectiveRotationInterpolation(keyframe);
  }, [hasOutgoingPropertySegment]);

  // Calculate effective start time for a clip (handles drag preview)
  // This is called during render to always use latest clipDrag state
  const getEffectiveClipStartTime = (clip: KeyframeDisplay['clip']): number => {
    if (clipDrag && clipDrag.clipId === clip.id && clipDrag.snappedTime !== null) {
      return clipDrag.snappedTime;
    }
    return clip.startTime;
  };

  // Handle keyframe drag
  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    kf: KeyframeDisplay['kf'],
    clip: KeyframeDisplay['clip']
  ) => {
    if (e.button !== 0) return; // Left click only
    e.preventDefault();
    e.stopPropagation();

    // Determine the effective selection for this drag
    const wasAlreadySelected = selectedKeyframeIds.has(kf.id);

    // Select the keyframe (if not already selected)
    if (!wasAlreadySelected) {
      onSelectKeyframe(kf.id, e.shiftKey);
    }

    // Capture original times for all keyframes that should move
    const originalTimes = new Map<string, { time: number; clipId: string }>();

    // Always include the dragged keyframe
    originalTimes.set(kf.id, { time: kf.time, clipId: clip.id });

    // Only include other selected keyframes if the clicked keyframe was
    // already selected (multi-drag) — NOT when clicking a new keyframe,
    // because the store selection updated but our closure still has stale IDs
    if (wasAlreadySelected || e.shiftKey) {
      for (const selectedId of selectedKeyframeIds) {
        if (selectedId === kf.id) continue;
        for (const [clipId, keyframes] of clipKeyframes.entries()) {
          const selectedKf = keyframes.find(k => k.id === selectedId);
          if (selectedKf) {
            originalTimes.set(selectedId, { time: selectedKf.time, clipId });
            break;
          }
        }
      }
    }

    // Start drag
    setDragState({
      keyframeId: kf.id,
      clipId: clip.id,
      startX: e.clientX,
      startTime: kf.time,
      clipStartTime: clip.startTime,
      originalTimes,
    });
  }, [onSelectKeyframe, selectedKeyframeIds, clipKeyframes]);

  // Handle drag movement
  useEffect(() => {
    if (!dragState) return;

    const getSnappedTimeDelta = (timeDelta: number) => {
      const movingIds = new Set(dragState.originalTimes.keys());
      let snappedTimeDelta = timeDelta;
      let bestDistancePx = KEYFRAME_SNAP_THRESHOLD_PX;

      for (const [keyframeId, original] of dragState.originalTimes.entries()) {
        const clip = clips.find(c => c.id === original.clipId);
        if (!clip) continue;

        const proposedTime = Math.max(0, Math.min(clip.duration, original.time + timeDelta));
        const proposedPixel = timeToPixel(clip.startTime + proposedTime);
        const clipTargets = clipKeyframes.get(original.clipId) || [];

        for (const target of clipTargets) {
          if (movingIds.has(target.id) || target.id === keyframeId) continue;

          const targetPixel = timeToPixel(clip.startTime + target.time);
          const distancePx = Math.abs(targetPixel - proposedPixel);

          if (distancePx <= bestDistancePx) {
            bestDistancePx = distancePx;
            snappedTimeDelta = target.time - original.time;
          }
        }
      }

      return snappedTimeDelta;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX;

      // Convert pixel delta to time delta
      const currentPixel = timeToPixel(dragState.clipStartTime + dragState.startTime);
      const newPixel = currentPixel + deltaX;
      const newAbsTime = pixelToTime(newPixel);

      // Calculate time delta from original position
      const rawTimeDelta = newAbsTime - (dragState.clipStartTime + dragState.startTime);
      const timeDelta = e.shiftKey ? getSnappedTimeDelta(rawTimeDelta) : rawTimeDelta;

      // Move all selected keyframes by the same time delta
      for (const [keyframeId, original] of dragState.originalTimes.entries()) {
        const clip = clips.find(c => c.id === original.clipId);
        if (!clip) continue;

        const newTime = original.time + timeDelta;
        const clampedTime = Math.max(0, Math.min(clip.duration, newTime));
        onMoveKeyframe(keyframeId, clampedTime);
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, timeToPixel, pixelToTime, clips, clipKeyframes, onMoveKeyframe]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((
    e: React.MouseEvent,
    kf: KeyframeDisplay['kf']
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const {
      targetKeyframeIds,
      currentEasing,
      rotationTargetKeyframeIds,
      currentRotationInterpolation,
    } = getContextMenuTargets(kf);

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetKeyframeIds,
      currentEasing,
      rotationTargetKeyframeIds,
      currentRotationInterpolation,
    });
  }, [getContextMenuTargets]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragState(null);
    onToggleCurveExpanded(trackId, property);
  }, [onToggleCurveExpanded, trackId, property]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Handle easing selection
  const handleEasingSelect = useCallback((easing: EasingType) => {
    if (contextMenu) {
      contextMenu.targetKeyframeIds.forEach((keyframeId) => {
        onUpdateKeyframe(keyframeId, { easing });
      });
      setContextMenu(null);
    }
  }, [contextMenu, onUpdateKeyframe]);

  const handleRotationInterpolationSelect = useCallback((rotationInterpolation: RotationInterpolationMode) => {
    if (contextMenu) {
      contextMenu.rotationTargetKeyframeIds.forEach((keyframeId) => {
        onUpdateKeyframe(keyframeId, { rotationInterpolation });
      });
      setContextMenu(null);
    }
  }, [contextMenu, onUpdateKeyframe]);

  return (
    <>
      {allKeyframes.map(({ kf, clip }) => {
        // Calculate position directly in render to use latest clipDrag state
        const effectiveStartTime = getEffectiveClipStartTime(clip);
        const absTime = effectiveStartTime + kf.time;
        const xPos = timeToPixel(absTime);
        const isSelected = selectedKeyframeIds.has(kf.id);
        const isDragging = dragState?.keyframeId === kf.id;
        const easing = normalizeEasingType(kf.easing, 'linear');
        const isStateChange = Boolean(parseVectorAnimationStateProperty(kf.property));
        const rotationPathDisplayMode = getRotationPathDisplayMode(kf, clip);
        const rotationPathLabel = rotationPathDisplayMode === 'continuous'
          ? 'C'
          : rotationPathDisplayMode === 'shortest'
            ? 'S'
            : null;
        const rotationTitle = rotationPathDisplayMode
          ? `\nRotation path: ${rotationPathDisplayMode === 'shortest' ? 'Shortest Path' : 'Continuous / Orbit'}`
          : '';

        return (
          <div
            key={kf.id}
            className={`keyframe-diamond easing-${easing} ${rotationPathDisplayMode ? `rotation-path-${rotationPathDisplayMode}` : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isRowHovered ? 'row-highlighted' : ''} ${isStateChange ? 'state-change' : ''} ${aiAnimatedKeyframes.has(kf.id) ? 'ai-keyframe-added' : ''}`}
            style={{ left: `${xPos}px` }}
            onMouseDown={(e) => handleMouseDown(e, kf, clip)}
            onDoubleClick={handleDoubleClick}
            onMouseEnter={() => onKeyframeRowHover?.(trackId, property, true)}
            onMouseLeave={() => onKeyframeRowHover?.(trackId, property, false)}
            onContextMenu={(e) => handleContextMenu(e, kf)}
            title={`${property}: ${kf.value.toFixed(3)} @ ${absTime.toFixed(2)}s\nEasing: ${easing}${rotationTitle}\nDrag to move (Shift snaps to clip keyframes)\nRight-click to change segment options`}
          >
            {rotationPathLabel && (
              <span className="keyframe-rotation-path-label" aria-hidden="true">
                {rotationPathLabel}
              </span>
            )}
          </div>
        );
      })}

      {/* Context Menu for easing selection - rendered via portal to avoid transform issues */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="keyframe-context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition?.x ?? contextMenu.x,
            top: contextMenuPosition?.y ?? contextMenu.y,
            zIndex: 10000,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="context-menu-title">
            {contextMenu.targetKeyframeIds.length > 1 ? 'Easing (Multiple)' : 'Easing'}
          </div>
          {EASING_OPTIONS.map((option) => (
            <div
              key={option.value}
              className={`context-menu-item ${contextMenu.currentEasing === option.value ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => handleEasingSelect(option.value)}
            >
              {option.label}
              {contextMenu.currentEasing === option.value && <span className="checkmark">&#10003;</span>}
            </div>
          ))}
          {contextMenu.rotationTargetKeyframeIds.length > 0 && (
            <>
              <div className="context-menu-subtitle">Rotation Path</div>
              {ROTATION_INTERPOLATION_OPTIONS.map((option) => (
                <div
                  key={option.value}
                  className={`context-menu-item ${contextMenu.currentRotationInterpolation === option.value ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => handleRotationInterpolationSelect(option.value)}
                >
                  {option.label}
                  {contextMenu.currentRotationInterpolation === option.value && <span className="checkmark">&#10003;</span>}
                </div>
              ))}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// Don't use memo here - we need immediate re-renders when clipDrag changes for smooth keyframe movement
export const TimelineKeyframes = TimelineKeyframesComponent;
