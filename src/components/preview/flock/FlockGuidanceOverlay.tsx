import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SceneCameraConfig, SceneViewport } from '../../../engine/scene/types';
import { resolveRenderableSharedSceneCamera } from '../../../engine/scene/SceneCameraUtils';
import { resolveSceneClipTransform } from '../../../engine/scene/SceneTimelineUtils';
import { readAnimatedFlockParam } from '../../../services/flock/flockAnimatedParams';
import { cancelHistoryBatch, endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { TimelineClip } from '../../../types/timeline';
import {
  buildFlockOutlinePaths,
  collectFlockGuidanceHandles,
  type FlockGuidanceHandle,
} from './flockGuidanceHandles';
import {
  buildFlockSimToWorldMatrix,
  dragSimPosition,
  flockNudgeDelta,
  flockVectorComponentWrites,
  isViewportUsable,
  projectSimPoint,
  type CanvasSize,
  type Vec3,
} from './flockGuidanceOverlayMath';
import './FlockGuidanceOverlay.css';

export interface FlockGuidanceOverlayProps {
  clip: TimelineClip | null;
  canvasSize: CanvasSize;
  viewport: SceneViewport;
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  previewCameraOverride?: SceneCameraConfig | null;
  enabled: boolean;
}

interface DragState {
  handleId: string;
  pointerId: number;
  startSim: Vec3;
  lastSim: Vec3;
  grabOffset: { x: number; y: number };
}

const HANDLE_RADIUS = 5;
const HIT_RADIUS = 11;

/**
 * Preview handles for flock guidance positions (emitters, attractors, vortex,
 * clusters, obstacles, boundary, paths). One drag or one key nudge is one undo
 * step; writes go through setPropertyValue so keyed parameters record
 * source-time keyframes and unkeyed ones update the definition.
 */
export function FlockGuidanceOverlay({
  clip,
  canvasSize,
  viewport,
  compositionId,
  sceneNavClipId,
  previewCameraOverride,
  enabled,
}: FlockGuidanceOverlayProps) {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const clipKeyframes = useTimelineStore((state) => state.clipKeyframes);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const getSourceTimeForClip = useTimelineStore((state) => state.getSourceTimeForClip);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const liveClip = clip ? clips.find((candidate) => candidate.id === clip.id) ?? null : null;
  const locked = !!liveClip && tracks.find((track) => track.id === liveClip.trackId)?.locked === true;
  const active = !!liveClip
    && liveClip.source?.type === 'flock'
    && !!liveClip.flock
    && playheadPosition >= liveClip.startTime
    && playheadPosition < liveClip.startTime + liveClip.duration;
  const visible = enabled && active && !locked && !isPlaying && isViewportUsable(viewport) && canvasSize.width > 0;

  const scene = useMemo(() => {
    if (!visible || !liveClip?.flock) return null;
    const clipLocalTime = playheadPosition - liveClip.startTime;
    const camera = resolveRenderableSharedSceneCamera(viewport, playheadPosition, {
      clips,
      tracks,
      clipKeyframes,
      compositionId,
      sceneNavClipId,
      previewCameraOverride,
    });
    const transform = resolveSceneClipTransform(liveClip, clipLocalTime, playheadPosition, { clips, clipKeyframes });
    const simToWorld = buildFlockSimToWorldMatrix(transform);
    const keyframes = clipKeyframes.get(liveClip.id);
    const handles = collectFlockGuidanceHandles(liveClip.flock, (property) => (
      readAnimatedFlockParam(liveClip, keyframes, property, clipLocalTime, getSourceTimeForClip)
    ));
    return { camera, simToWorld, handles };
  }, [visible, liveClip, playheadPosition, viewport, clips, tracks, clipKeyframes, compositionId, sceneNavClipId, previewCameraOverride, getSourceTimeForClip]);

  if (!scene || !liveClip) return null;
  const clipId = liveClip.id;

  const localPointer = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const scaleX = rect && rect.width > 0 ? canvasSize.width / rect.width : 1;
    const scaleY = rect && rect.height > 0 ? canvasSize.height / rect.height : 1;
    return {
      x: (event.clientX - (rect?.left ?? 0)) * scaleX,
      y: (event.clientY - (rect?.top ?? 0)) * scaleY,
    };
  };

  const applyWrites = (handle: FlockGuidanceHandle, from: Vec3, to: Vec3) => {
    for (const write of flockVectorComponentWrites(handle.ownerNodeId, handle.paramKey, from, to)) {
      setPropertyValue(clipId, write.property as AnimatableProperty, write.value);
    }
  };

  const finishDrag = (target: Element | null, pointerId: number | null) => {
    if (target && pointerId !== null && 'releasePointerCapture' in target) {
      try {
        (target as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(pointerId);
      } catch {
        // capture may already be gone
      }
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  const onPointerDown = (handle: FlockGuidanceHandle, event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const screen = projectSimPoint(scene.simToWorld, handle.sim, scene.camera, canvasSize);
    const pointer = localPointer(event);
    startBatch(`Move ${handle.label}`);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom / unsupported capture
    }
    dragRef.current = {
      handleId: handle.id,
      pointerId: event.pointerId,
      startSim: [...handle.sim] as Vec3,
      lastSim: [...handle.sim] as Vec3,
      grabOffset: { x: pointer.x - screen.x, y: pointer.y - screen.y },
    };
    setDraggingId(handle.id);
  };

  const onPointerMove = (handle: FlockGuidanceHandle, event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.handleId !== handle.id || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const pointer = localPointer(event);
    const next = dragSimPosition({
      camera: scene.camera,
      canvasSize,
      simToWorld: scene.simToWorld,
      startSim: drag.startSim,
      pointer: { x: pointer.x - drag.grabOffset.x, y: pointer.y - drag.grabOffset.y },
    });
    if (!next) return;
    applyWrites(handle, drag.lastSim, next);
    drag.lastSim = next;
  };

  const onPointerUp = (handle: FlockGuidanceHandle, event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.handleId !== handle.id || drag.pointerId !== event.pointerId) return;
    endBatch();
    finishDrag(event.currentTarget, event.pointerId);
    // Pointer activation must not leave a lingering focus state on the handle.
    const focusTarget = event.currentTarget as unknown as HTMLElement;
    if (typeof focusTarget.blur === 'function') focusTarget.blur();
  };

  const onLostPointerCapture = (handle: FlockGuidanceHandle) => {
    const drag = dragRef.current;
    if (!drag || drag.handleId !== handle.id) return;
    endBatch();
    finishDrag(null, null);
  };

  const onKeyDown = (handle: FlockGuidanceHandle, event: ReactKeyboardEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (event.key === 'Escape' && drag && drag.handleId === handle.id) {
      event.preventDefault();
      applyWrites(handle, drag.lastSim, drag.startSim);
      cancelHistoryBatch();
      finishDrag(event.currentTarget, drag.pointerId);
      return;
    }
    if (drag) return;
    const delta = flockNudgeDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    const next: Vec3 = [handle.sim[0] + delta[0], handle.sim[1] + delta[1], handle.sim[2] + delta[2]];
    startBatch(`Nudge ${handle.label}`);
    applyWrites(handle, handle.sim, next);
    endBatch();
  };

  return (
    <svg
      ref={svgRef}
      className="flock-guidance-overlay"
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
      data-flock-guidance-overlay={clipId}
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
      {scene.handles.map((handle) => (
        handle.outline
          ? buildFlockOutlinePaths(handle.outline, scene.simToWorld, scene.camera, canvasSize).map((path, index) => (
              <path key={`${handle.id}-outline-${index}`} className="flock-guidance-outline" d={path} />
            ))
          : null
      ))}
      {scene.handles.map((handle) => {
        const screen = projectSimPoint(scene.simToWorld, handle.sim, scene.camera, canvasSize);
        if (!screen.visible || screen.depth <= 0) return null;
        return (
          <g
            key={handle.id}
            className="flock-guidance-handle"
            role="button"
            tabIndex={0}
            aria-label={`Move ${handle.label}`}
            aria-description="Drag to move on the camera plane. Arrow keys nudge X/Y, Page Up/Down nudge Z, Shift for larger steps."
            data-flock-handle-id={handle.id}
            data-screen-x={screen.x.toFixed(2)}
            data-screen-y={screen.y.toFixed(2)}
            data-dragging={draggingId === handle.id ? 'true' : 'false'}
            onPointerDown={(event) => onPointerDown(handle, event)}
            onPointerMove={(event) => onPointerMove(handle, event)}
            onPointerUp={(event) => onPointerUp(handle, event)}
            onPointerCancel={(event) => onPointerUp(handle, event)}
            onLostPointerCapture={() => onLostPointerCapture(handle)}
            onKeyDown={(event) => onKeyDown(handle, event)}
          >
            <circle cx={screen.x} cy={screen.y} r={HIT_RADIUS} fill="transparent" />
            <circle className="flock-guidance-handle-dot" cx={screen.x} cy={screen.y} r={HANDLE_RADIUS} />
            <circle className="flock-guidance-focus-ring" cx={screen.x} cy={screen.y} r={HIT_RADIUS} />
            <text className="flock-guidance-label" x={screen.x + HIT_RADIUS + 2} y={screen.y - HIT_RADIUS + 4}>
              {handle.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
