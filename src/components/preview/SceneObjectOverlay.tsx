import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { engine } from '../../engine/WebGPUEngine';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
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
  SceneObjectContextMenu,
  SceneObjectHandles,
  SceneRotateGizmo,
  SceneWorldGridSvg,
} from './sceneOverlay/SceneOverlayChrome';
import {
  AXES,
  buildCameraWireframePaths,
  CENTER_SCALE_DIRECTION,
  getAveragePixelsPerUnit,
  resolveCenterFreePixelsPerUnit,
  resolveDisplayObjects,
} from './sceneOverlay/sceneOverlayDisplayPlans';
import {
  buildProjectedRotateRing,
  buildWorldGridPaths,
  getPointToRingAngle,
  getRotateRingEventPoint,
  resolveNearestRotateRing,
} from './sceneOverlay/sceneOverlayProjectionPlans';
import {
  buildAxisResetTransform,
  buildCenterResetTransform,
  cloneTransform,
  getDragSpeedMultiplier,
  resolveTransformPropertyUpdates,
} from './sceneOverlay/sceneOverlayTransformPlans';
import { createAxisPlaneDrag } from './sceneOverlay/sceneOverlayDragGeometry';
import { applyDragTransform } from './sceneOverlay/sceneOverlayDragTransformPlans';
import type {
  ClipTransformPatch,
  DisplayCameraWireframePath,
  DisplayWorldGridPath,
  DragRuntime,
  DragState,
  ObjectContextMenuState,
  ProjectedRotateRing,
  ProjectedRotateRingPoint,
  SceneGizmoDragAxis,
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
  canSetObjectOrbitPivot?: boolean;
  onSetObjectOrbitPivot?: (object: PreviewSceneObject) => boolean;
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
  engine.requestRender();
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
  canSetObjectOrbitPivot = false,
  onSetObjectOrbitPivot,
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
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [objectContextMenu, setObjectContextMenu] = useState<ObjectContextMenuState | null>(null);
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
    engine.requestRender();
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
    engine.requestRender();
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
    engine.requestRender();
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
    if (!objectContextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setObjectContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setObjectContextMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [objectContextMenu]);

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

  useEffect(() => {
    if (!enabled || !selectedObject) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'KeyW') {
        event.preventDefault();
        setMode('move');
      } else if (event.code === 'KeyE') {
        event.preventDefault();
        setMode('rotate');
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        setMode('scale');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, selectedObject]);

  const handleObjectPointerDown = useCallback((event: ReactPointerEvent, object: PreviewSceneObject) => {
    event.preventDefault();
    event.stopPropagation();
    selectClip(object.clipId, event.shiftKey);
  }, [selectClip]);

  const openObjectContextMenu = useCallback((event: ReactMouseEvent<Element>, object: PreviewSceneObject) => {
    if (!canSetObjectOrbitPivot || object.kind === 'camera') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const overlayRect = overlayRef.current?.getBoundingClientRect();
    setObjectContextMenu({
      x: overlayRect ? event.clientX - overlayRect.left : event.clientX,
      y: overlayRect ? event.clientY - overlayRect.top : event.clientY,
      object,
    });
  }, [canSetObjectOrbitPivot]);

  const setContextMenuObjectOrbitPivot = useCallback(() => {
    if (!objectContextMenu) return;
    onSetObjectOrbitPivot?.(objectContextMenu.object);
    setObjectContextMenu(null);
  }, [objectContextMenu, onSetObjectOrbitPivot]);

  const startGizmoDrag = useCallback((params: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
    object: PreviewSceneObject;
    axis: SceneGizmoDragAxis;
    direction: { x: number; y: number };
    axisVector: { x: number; y: number; z: number };
    pixelsPerUnit: number;
    freePixelsPerUnit: { x: number; y: number };
    rotationRingClientRect?: DragState['rotationRingClientRect'];
    rotationRingPoints?: ProjectedRotateRingPoint[];
    rotationStartRingAngle?: number;
  }) => {
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

  const handleAxisMouseDown = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(selectedObject);
      return;
    }

    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: handle.axis,
      direction: handle.direction,
      axisVector: handle.axisVector,
      pixelsPerUnit: handle.pixelsPerUnit,
      freePixelsPerUnit: { x: handle.pixelsPerUnit, y: handle.pixelsPerUnit },
    });
  }, [onSetObjectOrbitPivot, selectedObject, startGizmoDrag]);

  const handleAxisDoubleClick = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (!selectedObject) return;

    if (onSetObjectOrbitPivot?.(selectedObject)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const clip = clips.find((candidate) => candidate.id === selectedObject.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      selectedObject.clipId,
      mode,
      buildAxisResetTransform(mode, handle.axis, selectedObject, getObjectTransform(selectedObject, clip)),
    );
  }, [clips, getObjectTransform, mode, onSetObjectOrbitPivot, resetObjectTransform, selectedObject]);

  const resolveRotateRingFromEvent = useCallback((event: ReactMouseEvent<SVGSVGElement>) => (
    resolveNearestRotateRing(getRotateRingEventPoint(event), rotateRings)
  ), [rotateRings]);

  const handleRotateRingMouseMove = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    updateHoveredAxis(ring?.axis ?? null);
  }, [resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleRotateRingMouseDown = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(selectedObject);
      return;
    }

    const point = getRotateRingEventPoint(event);
    const startAngle = getPointToRingAngle(point, ring);
    const rect = event.currentTarget.getBoundingClientRect();
    updateHoveredAxis(ring.axis);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: ring.axis,
      direction: ring.handle.direction,
      axisVector: ring.handle.axisVector,
      pixelsPerUnit: ring.handle.pixelsPerUnit,
      freePixelsPerUnit: { x: ring.handle.pixelsPerUnit, y: ring.handle.pixelsPerUnit },
      ...(startAngle !== null
        ? {
            rotationRingClientRect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            rotationRingPoints: ring.points,
            rotationStartRingAngle: startAngle,
          }
        : {}),
    });
  }, [onSetObjectOrbitPivot, resolveRotateRingFromEvent, selectedObject, startGizmoDrag, updateHoveredAxis]);

  const handleRotateRingDoubleClick = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    updateHoveredAxis(ring.axis);
    handleAxisDoubleClick(event, ring.handle);
  }, [handleAxisDoubleClick, resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleCenterPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (event.button !== 0) return;

    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(object);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (object.clipId !== selectedClipId || (mode !== 'move' && mode !== 'scale')) {
      handleObjectPointerDown(event, object);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const freePixelsPerUnit = resolveCenterFreePixelsPerUnit(axisHandles);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object,
      axis: 'all',
      direction: mode === 'scale' ? CENTER_SCALE_DIRECTION : { x: 1, y: 0 },
      axisVector: { x: 0, y: 0, z: 0 },
      pixelsPerUnit: getAveragePixelsPerUnit(freePixelsPerUnit),
      freePixelsPerUnit,
    });
  }, [axisHandles, handleObjectPointerDown, mode, onSetObjectOrbitPivot, selectedClipId, startGizmoDrag]);

  const handleCenterDoubleClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (onSetObjectOrbitPivot?.(object)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (object.clipId !== selectedClipId) return;
    const clip = clips.find((candidate) => candidate.id === object.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      object.clipId,
      mode,
      buildCenterResetTransform(mode, object, getObjectTransform(object, clip)),
    );
  }, [clips, getObjectTransform, mode, onSetObjectOrbitPivot, resetObjectTransform, selectedClipId]);

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
              onContextMenu={(event) => openObjectContextMenu(event, selectedObject)}
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
              onContextMenu={(event) => openObjectContextMenu(event, selectedObject)}
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
        onContextMenu={openObjectContextMenu}
      />
      <SceneObjectContextMenu
        menu={objectContextMenu}
        menuRef={contextMenuRef}
        onSetObjectOrbitPivot={setContextMenuObjectOrbitPivot}
      />
      {toolbarPortalTarget && toolbar ? createPortal(toolbar, toolbarPortalTarget) : null}
    </div>
  );
}
