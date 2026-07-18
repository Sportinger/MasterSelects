import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { renderHostPort } from '../../services/render/renderHostPort';
import type { SceneCameraConfig, SceneViewport } from '../../engine/scene/types';
import {
  buildCameraPreviewSceneObject,
  collectPreviewSceneObjects,
  resolveAxisScreenHandle,
  type PreviewSceneObject,
  type SceneAxisScreenHandle,
  type SceneGizmoAxis,
  type SceneGizmoMode,
} from './sceneObjectOverlayMath';
import {
  SceneAxisGizmoLayers,
  SceneCameraWireframeSvg,
  SceneGizmoToolbar,
  SceneObjectHandles,
  SceneRotateGizmo,
  SceneWorldGridSvg,
} from './sceneOverlay/SceneOverlayChrome';
import {
  AXES,
  buildCameraWireframePaths,
  resolveDisplayObjects,
} from './sceneOverlay/sceneOverlayDisplayPlans';
import {
  buildProjectedRotateRing,
  buildWorldGridPaths,
} from './sceneOverlay/sceneOverlayProjectionPlans';
import {
  cloneTransform,
  getDragSpeedMultiplier,
  resolveTransformPropertyUpdates,
} from './sceneOverlay/sceneOverlayTransformPlans';
import { createAxisPlaneDrag } from './sceneOverlay/sceneOverlayDragGeometry';
import { applyDragTransform } from './sceneOverlay/sceneOverlayDragTransformPlans';
import { useSceneOverlayGizmoHandlers } from './sceneOverlay/useSceneOverlayGizmoHandlers';
import { useSceneOverlayKeybindings } from './sceneOverlay/useSceneOverlayKeybindings';
import type {
  ClipTransformPatch,
  DisplayCameraWireframePath,
  DisplayWorldGridPath,
  DragRuntime,
  DragState,
  ProjectedRotateRing,
  SceneGizmoDragStartParams,
  WorldGridPlane,
} from './sceneOverlay/sceneOverlayTypes';

interface SceneObjectOverlayProps {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipId: string | null;
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  canvasSize: { width: number; height: number };
  viewport: SceneViewport;
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  previewCameraOverride?: SceneCameraConfig | null;
  editCameraClip?: TimelineClip | null;
  editCameraTransform?: ClipTransform | null;
  showOnlyEditCamera?: boolean;
  showWorldGrid?: boolean;
  worldGridPlane?: WorldGridPlane;
  toolbarPortalTarget?: HTMLElement | null;
  enabled: boolean;
}

const OVERLAY_REFRESH_MS = 125;

function applySceneObjectTransform(clipId: string, transform: ClipTransformPatch): void {
  const store = useTimelineStore.getState();
  const updates = resolveTransformPropertyUpdates(transform);
  const useKeyframePath = updates.some(([property]) =>
    store.hasKeyframes(clipId, property) || store.isRecording(clipId, property),
  );

  if (useKeyframePath) {
    for (const [property, value] of updates) {
      store.setPropertyValue(clipId, property, value);
    }
  } else {
    store.updateClipTransform(clipId, transform);
  }
  renderHostPort.requestRender();
}

function resetSceneObjectTransform(
  clipId: string,
  mode: SceneGizmoMode,
  transform: ClipTransformPatch,
): void {
  startBatch(`Reset scene ${mode}`);
  applySceneObjectTransform(clipId, transform);
  endBatch();
}

export function SceneObjectOverlay({
  clips,
  tracks,
  selectedClipId,
  selectClip,
  canvasSize,
  viewport,
  compositionId,
  sceneNavClipId,
  previewCameraOverride,
  editCameraClip,
  editCameraTransform,
  showOnlyEditCamera = false,
  showWorldGrid = false,
  worldGridPlane = 'xz',
  toolbarPortalTarget,
  enabled,
}: SceneObjectOverlayProps) {
  const [mode, setMode] = useState<SceneGizmoMode>('move');
  const setSceneGizmoMode = useEngineStore((state) => state.setSceneGizmoMode);
  const setSceneGizmoHoveredAxis = useEngineStore((state) => state.setSceneGizmoHoveredAxis);
  const [hoveredAxis, setHoveredAxis] = useState<SceneGizmoAxis | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineSnapshotTick, setTimelineSnapshotTick] = useState(0);
  const endedDragRef = useRef(false);
  const hoveredAxisRef = useRef<SceneGizmoAxis | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRuntimeRef = useRef<DragRuntime>({
    target: null,
    hasPointerLock: false,
    accumulatedX: 0,
    accumulatedY: 0,
    lastClientX: 0,
    lastClientY: 0,
    rotationRingLastAngle: null,
    rotationRingAccumulatedRadians: 0,
    rotationAngularLastAngle: null,
    rotationAngularAccumulatedRadians: 0,
  });

  const releasePointerLock = useCallback(() => {
    const { target } = dragRuntimeRef.current;
    if (target && document.pointerLockElement === target) {
      document.exitPointerLock();
    }
    dragRuntimeRef.current.hasPointerLock = false;
    dragRuntimeRef.current.target = null;
  }, []);

  const requestPointerLock = useCallback((target: HTMLElement, fallbackTarget?: HTMLElement) => {
    if (!target.requestPointerLock) return;

    try {
      const result = target.requestPointerLock();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => {
            if (dragRuntimeRef.current.target === target) {
              dragRuntimeRef.current.hasPointerLock = document.pointerLockElement === target;
            }
          },
          () => {
            if (fallbackTarget && fallbackTarget !== target) {
              dragRuntimeRef.current.target = fallbackTarget;
              requestPointerLock(fallbackTarget);
            } else if (dragRuntimeRef.current.target === target) {
              dragRuntimeRef.current.hasPointerLock = false;
            }
          },
        );
      } else {
        requestAnimationFrame(() => {
          if (dragRuntimeRef.current.target === target) {
            dragRuntimeRef.current.hasPointerLock = document.pointerLockElement === target;
          }
        });
      }
    } catch {
      if (fallbackTarget && fallbackTarget !== target) {
        dragRuntimeRef.current.target = fallbackTarget;
        requestPointerLock(fallbackTarget);
      } else {
        dragRuntimeRef.current.hasPointerLock = false;
      }
    }
  }, []);

  const updateHoveredAxis = useCallback((axis: SceneGizmoAxis | null) => {
    if (hoveredAxisRef.current === axis) return;
    hoveredAxisRef.current = axis;
    setHoveredAxis(axis);
    setSceneGizmoHoveredAxis(axis);
    renderHostPort.requestRender();
  }, [setSceneGizmoHoveredAxis]);

  const handleAxisHover = useCallback((axis: SceneGizmoAxis | null) => {
    if (axis === null && dragRuntimeRef.current.target) {
      return;
    }
    updateHoveredAxis(axis);
  }, [updateHoveredAxis]);

  useEffect(() => () => {
    hoveredAxisRef.current = null;
    setSceneGizmoHoveredAxis(null);
    renderHostPort.requestRender();
  }, [setSceneGizmoHoveredAxis]);

  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      if (useTimelineStore.getState().isPlaying) return;
      setTimelineSnapshotTick((tick) => (tick + 1) % 1000000);
    }, OVERLAY_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setSceneGizmoMode(mode);
    updateHoveredAxis(null);
    renderHostPort.requestRender();
  }, [enabled, mode, setSceneGizmoMode, updateHoveredAxis]);

  const { camera, objects } = useMemo(
    () => {
      void timelineSnapshotTick;
      const { clipKeyframes, playheadPosition } = useTimelineStore.getState();
      const collected = collectPreviewSceneObjects({
        clips,
        tracks,
        clipKeyframes,
        playheadPosition,
        viewport,
        canvasSize,
        compositionId,
        sceneNavClipId,
        previewCameraOverride,
      });
      const editCameraObject = editCameraClip && editCameraTransform
        ? buildCameraPreviewSceneObject(editCameraClip, editCameraTransform, collected.camera, viewport, canvasSize)
        : null;
      let mergedObjects: PreviewSceneObject[];
      if (showOnlyEditCamera) {
        mergedObjects = editCameraObject ? [editCameraObject] : [];
      } else if (editCameraObject) {
        mergedObjects = [
          editCameraObject,
          ...collected.objects.filter((object) => object.clipId !== editCameraObject.clipId),
        ];
      } else {
        mergedObjects = collected.objects;
      }
      return { camera: collected.camera, objects: mergedObjects };
    },
    [
      canvasSize,
      clips,
      compositionId,
      editCameraClip,
      editCameraTransform,
      previewCameraOverride,
      sceneNavClipId,
      showOnlyEditCamera,
      timelineSnapshotTick,
      tracks,
      viewport,
    ],
  );

  const selectedObject = useMemo(
    () => objects.find((object) => object.clipId === selectedClipId) ?? null,
    [objects, selectedClipId],
  );
  const displayObjects = useMemo(
    () => resolveDisplayObjects(objects, canvasSize),
    [canvasSize, objects],
  );
  const cameraWireframePaths = useMemo<DisplayCameraWireframePath[]>(
    () => buildCameraWireframePaths(objects, camera, canvasSize, selectedClipId),
    [camera, canvasSize, objects, selectedClipId],
  );
  const worldGridPaths = useMemo<DisplayWorldGridPath[]>(
    () => (showWorldGrid ? buildWorldGridPaths(camera, canvasSize, worldGridPlane) : []),
    [camera, canvasSize, showWorldGrid, worldGridPlane],
  );

  const axisHandles = useMemo<SceneAxisScreenHandle[]>(() => {
    if (!selectedObject || !selectedObject.screen.visible) return [];
    return AXES.map((axis) => resolveAxisScreenHandle(
      axis,
      selectedObject.worldPosition,
      camera,
      canvasSize,
      selectedObject.axisBasis[axis],
    ));
  }, [camera, canvasSize, selectedObject]);
  const rotateRings = useMemo<ProjectedRotateRing[]>(() => {
    if (!selectedObject || !selectedObject.screen.visible) return [];
    return axisHandles
      .map((handle) => buildProjectedRotateRing(handle, selectedObject, camera, canvasSize))
      .filter((ring): ring is ProjectedRotateRing => ring !== null);
  }, [axisHandles, camera, canvasSize, selectedObject]);

  const getObjectTransform = useCallback((object: PreviewSceneObject, clip: TimelineClip): ClipTransform => {
    if (object.kind === 'camera' && editCameraClip?.id === object.clipId && editCameraTransform) {
      return cloneTransform(editCameraTransform);
    }
    return cloneTransform(clip.transform);
  }, [editCameraClip?.id, editCameraTransform]);

  const applyObjectTransform = useCallback((clipId: string, transform: ClipTransformPatch) => {
    applySceneObjectTransform(clipId, transform);
  }, []);

  const resetObjectTransform = useCallback((
    clipId: string,
    modeToReset: SceneGizmoMode,
    transform: ClipTransformPatch,
  ) => {
    resetSceneObjectTransform(clipId, modeToReset, transform);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragState) return;
    releasePointerLock();
    if (!dragState.transient && !endedDragRef.current) {
      endedDragRef.current = true;
      endBatch();
    }
    setDragState(null);
    updateHoveredAxis(null);
  }, [dragState, releasePointerLock, updateHoveredAxis]);

  useEffect(() => {
    if (enabled && selectedObject?.screen.visible) return;
    updateHoveredAxis(null);
  }, [enabled, selectedObject?.clipId, selectedObject?.screen.visible, updateHoveredAxis]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerLockChange = () => {
      const { target } = dragRuntimeRef.current;
      dragRuntimeRef.current.hasPointerLock = target !== null && document.pointerLockElement === target;
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const runtime = dragRuntimeRef.current;
      const pointerLockActive = runtime.target !== null && document.pointerLockElement === runtime.target;
      runtime.hasPointerLock = pointerLockActive;

      let deltaX: number;
      let deltaY: number;
      if (pointerLockActive) {
        deltaX = event.movementX;
        deltaY = event.movementY;
      } else {
        deltaX = event.clientX - runtime.lastClientX;
        deltaY = event.clientY - runtime.lastClientY;
        runtime.lastClientX = event.clientX;
        runtime.lastClientY = event.clientY;
      }

      const speedMultiplier = getDragSpeedMultiplier(event);
      runtime.accumulatedX += deltaX * speedMultiplier;
      runtime.accumulatedY += deltaY * speedMultiplier;

      const screenDistance =
        runtime.accumulatedX * dragState.direction.x +
        runtime.accumulatedY * dragState.direction.y;
      applyDragTransform(dragState, screenDistance, {
        x: runtime.accumulatedX,
        y: runtime.accumulatedY,
      }, runtime, applyObjectTransform);
    };

    const handleMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      endDrag();
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockChange);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      releasePointerLock();
    };
  }, [applyObjectTransform, dragState, endDrag, releasePointerLock]);

  useSceneOverlayKeybindings({
    enabled,
    selectedObject,
    onModeChange: setMode,
  });

  const startGizmoDrag = useCallback((params: SceneGizmoDragStartParams) => {
    const clip = clips.find((candidate) => candidate.id === params.object.clipId);
    if (!clip) return;

    const transient = false;
    const lockTarget = overlayRef.current ?? document.body;
    const overlayRect = overlayRef.current?.getBoundingClientRect();
    const fallbackTarget = params.currentTarget instanceof HTMLElement ? params.currentTarget : undefined;
    const axisPlaneDrag = mode === 'move' && params.axis !== 'all' && overlayRect
      ? createAxisPlaneDrag({
          client: { x: params.clientX, y: params.clientY },
          camera,
          canvasRect: {
            left: overlayRect.left,
            top: overlayRect.top,
            width: overlayRect.width,
            height: overlayRect.height,
          },
          worldPosition: params.object.worldPosition,
          axisVector: params.axisVector,
        })
      : undefined;
    endedDragRef.current = false;
    dragRuntimeRef.current = {
      target: lockTarget,
      hasPointerLock: false,
      accumulatedX: 0,
      accumulatedY: 0,
      lastClientX: params.clientX,
      lastClientY: params.clientY,
      rotationRingLastAngle: params.rotationStartRingAngle ?? null,
      rotationRingAccumulatedRadians: 0,
      rotationAngularLastAngle: null,
      rotationAngularAccumulatedRadians: 0,
    };
    requestPointerLock(lockTarget, fallbackTarget);
    if (!transient) {
      startBatch(`Scene ${mode}`);
    }
    updateHoveredAxis(params.axis === 'all' ? null : params.axis);
    setDragState({
      clipId: params.object.clipId,
      mode,
      axis: params.axis,
      kind: params.object.kind,
      transformSpace: params.object.transformSpace,
      startTransform: getObjectTransform(params.object, clip),
      transient,
      direction: params.direction,
      axisVector: params.axisVector,
      pixelsPerUnit: params.pixelsPerUnit,
      freePixelsPerUnit: params.freePixelsPerUnit,
      ...(axisPlaneDrag ? { axisPlaneDrag } : {}),
      ...(params.rotationRingClientRect && params.rotationRingPoints && params.rotationStartRingAngle !== undefined
        ? {
            rotationRingClientRect: params.rotationRingClientRect,
            rotationRingPoints: params.rotationRingPoints,
            rotationStartRingAngle: params.rotationStartRingAngle,
          }
        : {}),
      ...(overlayRect
        ? {
            rotationCenterClient: {
              x: overlayRect.left + params.object.screen.x,
              y: overlayRect.top + params.object.screen.y,
            },
            rotationStartPointerClient: {
              x: params.clientX,
              y: params.clientY,
            },
          }
        : {}),
      viewport,
    });
  }, [camera, clips, getObjectTransform, mode, requestPointerLock, updateHoveredAxis, viewport]);

  const {
    handleAxisMouseDown,
    handleAxisDoubleClick,
    handleRotateRingMouseMove,
    handleRotateRingMouseDown,
    handleRotateRingDoubleClick,
    handleCenterPointerDown,
    handleCenterDoubleClick,
  } = useSceneOverlayGizmoHandlers({
    clips,
    selectedClipId,
    selectedObject,
    mode,
    axisHandles,
    rotateRings,
    selectClip,
    getObjectTransform,
    resetObjectTransform,
    startGizmoDrag,
    updateHoveredAxis,
  });

  if (!enabled || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return null;
  }

  if (objects.length === 0 && worldGridPaths.length === 0) {
    return null;
  }

  const toolbar = selectedObject && selectedObject.screen.visible ? (
    <SceneGizmoToolbar mode={mode} onModeChange={setMode} />
  ) : null;

  return (
    <div
      ref={overlayRef}
      className="preview-scene-object-overlay"
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
      <SceneWorldGridSvg canvasSize={canvasSize} paths={worldGridPaths} />
      <SceneCameraWireframeSvg canvasSize={canvasSize} paths={cameraWireframePaths} />
      {selectedObject && selectedObject.screen.visible && (
        <>
          {mode === 'rotate' ? (
            <SceneRotateGizmo
              selectedObject={selectedObject}
              rotateRings={rotateRings}
              hoveredAxis={hoveredAxis}
              onMouseMove={handleRotateRingMouseMove}
              onMouseDown={handleRotateRingMouseDown}
              onDoubleClick={handleRotateRingDoubleClick}
              onMouseLeave={() => handleAxisHover(null)}
            />
          ) : (
            <SceneAxisGizmoLayers
              mode={mode}
              axisHandles={axisHandles}
              hoveredAxis={hoveredAxis}
              onAxisHover={handleAxisHover}
              onAxisMouseDown={handleAxisMouseDown}
              onAxisDoubleClick={handleAxisDoubleClick}
            />
          )}
        </>
      )}

      <SceneObjectHandles
        objects={displayObjects}
        selectedClipId={selectedClipId}
        mode={mode}
        onPointerDown={handleCenterPointerDown}
        onDoubleClick={handleCenterDoubleClick}
      />
      {toolbarPortalTarget && toolbar ? createPortal(toolbar, toolbarPortalTarget) : null}
    </div>
  );
}
