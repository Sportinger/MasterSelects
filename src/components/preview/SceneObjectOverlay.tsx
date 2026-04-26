import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnimatableProperty, ClipTransform, TimelineClip, TimelineTrack } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { SceneViewport } from '../../engine/scene/types';
import {
  collectPreviewSceneObjects,
  resolveAxisScreenHandle,
  type PreviewSceneObject,
  type SceneAxisScreenHandle,
  type SceneGizmoAxis,
  type SceneGizmoMode,
} from './sceneObjectOverlayMath';

interface SceneObjectOverlayProps {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipId: string | null;
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  canvasSize: { width: number; height: number };
  viewport: SceneViewport;
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  enabled: boolean;
}

interface DragState {
  clipId: string;
  mode: SceneGizmoMode;
  axis: SceneGizmoAxis;
  transformSpace: PreviewSceneObject['transformSpace'];
  startTransform: ClipTransform;
  direction: { x: number; y: number };
  pixelsPerUnit: number;
  viewport: SceneViewport;
}

interface DragRuntime {
  target: HTMLElement | null;
  hasPointerLock: boolean;
  accumulatedX: number;
  accumulatedY: number;
  lastClientX: number;
  lastClientY: number;
}

interface DisplaySceneObject extends PreviewSceneObject {
  displayX: number;
  displayY: number;
}

const AXES: SceneGizmoAxis[] = ['x', 'y', 'z'];
const OVERLAY_REFRESH_MS = 125;

const AXIS_LABELS: Record<SceneGizmoAxis, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

const MODE_LABELS: Record<SceneGizmoMode, string> = {
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
};

function getObjectBadge(kind: PreviewSceneObject['kind']): string {
  switch (kind) {
    case 'effector':
      return 'E';
    case 'splat':
      return 'S';
    case 'model':
      return 'M';
    case 'plane':
      return '3D';
  }
}

function resolveDisplayObjects(
  objects: PreviewSceneObject[],
  canvasSize: { width: number; height: number },
): DisplaySceneObject[] {
  const groups = new Map<string, PreviewSceneObject[]>();
  for (const object of objects) {
    if (!object.screen.visible) continue;
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  }

  return objects.map((object) => {
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    const group = groups.get(key) ?? [object];
    const index = group.findIndex((candidate) => candidate.clipId === object.clipId);
    if (!object.screen.visible || group.length <= 1 || index < 0) {
      return { ...object, displayX: object.screen.x, displayY: object.screen.y };
    }

    const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
    const radius = 19;
    return {
      ...object,
      displayX: Math.max(14, Math.min(canvasSize.width - 14, object.screen.x + Math.cos(angle) * radius)),
      displayY: Math.max(14, Math.min(canvasSize.height - 14, object.screen.y + Math.sin(angle) * radius)),
    };
  });
}

function cloneTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function resolveTransformPropertyUpdates(transform: Partial<ClipTransform>): Array<[AnimatableProperty, number]> {
  const updates: Array<[AnimatableProperty, number]> = [];
  if (transform.opacity !== undefined) updates.push(['opacity', transform.opacity]);
  if (transform.position) {
    updates.push(['position.x', transform.position.x]);
    updates.push(['position.y', transform.position.y]);
    updates.push(['position.z', transform.position.z]);
  }
  if (transform.scale) {
    updates.push(['scale.x', transform.scale.x]);
    updates.push(['scale.y', transform.scale.y]);
    if (transform.scale.z !== undefined) updates.push(['scale.z', transform.scale.z]);
  }
  if (transform.rotation) {
    updates.push(['rotation.x', transform.rotation.x]);
    updates.push(['rotation.y', transform.rotation.y]);
    updates.push(['rotation.z', transform.rotation.z]);
  }
  return updates;
}

function getAxisStyle(handle: SceneAxisScreenHandle): CSSProperties {
  const length = Math.hypot(handle.end.x - handle.start.x, handle.end.y - handle.start.y);
  const angle = Math.atan2(handle.end.y - handle.start.y, handle.end.x - handle.start.x);
  return {
    left: handle.start.x,
    top: handle.start.y,
    width: length,
    transform: `rotate(${angle}rad)`,
  };
}

function getDragSpeedMultiplier(event: MouseEvent): number {
  if (event.ctrlKey) return 5;
  if (event.altKey || event.shiftKey) return 0.1;
  return 1;
}

function applySceneObjectTransform(clipId: string, transform: Partial<ClipTransform>): void {
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

function applyDragTransform(drag: DragState, screenDistance: number): void {
  const units = screenDistance / drag.pixelsPerUnit;
  const start = drag.startTransform;
  const axis = drag.axis;

  if (drag.mode === 'rotate') {
    const degrees = screenDistance * 0.6;
    applySceneObjectTransform(drag.clipId, {
      rotation: {
        x: start.rotation.x + (axis === 'x' ? degrees : 0),
        y: start.rotation.y + (axis === 'y' ? degrees : 0),
        z: start.rotation.z + (axis === 'z' ? degrees : 0),
      },
    });
    return;
  }

  if (drag.mode === 'scale') {
    const scaleDelta = screenDistance / 90;
    if (drag.transformSpace === 'effector') {
      const next = Math.max(0.001, Math.max(start.scale.x, start.scale.y, start.scale.z ?? 1) + scaleDelta);
      applySceneObjectTransform(drag.clipId, {
        scale: { x: next, y: next, z: next },
      });
      return;
    }

    applySceneObjectTransform(drag.clipId, {
      scale: {
        x: Math.max(0.001, start.scale.x + (axis === 'x' ? scaleDelta : 0)),
        y: Math.max(0.001, start.scale.y + (axis === 'y' ? scaleDelta : 0)),
        z: axis === 'z'
          ? Math.max(0.001, (start.scale.z ?? 1) + scaleDelta)
          : start.scale.z,
      },
    });
    return;
  }

  const aspect = drag.viewport.width / Math.max(1, drag.viewport.height);
  const position = { ...start.position };
  if (axis === 'x') {
    position.x += drag.transformSpace === 'effector'
      ? units / aspect
      : units;
  }
  if (axis === 'y') {
    position.y += drag.transformSpace === 'effector' ? -units : units;
  }
  if (axis === 'z') {
    position.z += units;
  }

  applySceneObjectTransform(drag.clipId, { position });
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
  enabled,
}: SceneObjectOverlayProps) {
  const [mode, setMode] = useState<SceneGizmoMode>('move');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineSnapshotTick, setTimelineSnapshotTick] = useState(0);
  const endedDragRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRuntimeRef = useRef<DragRuntime>({
    target: null,
    hasPointerLock: false,
    accumulatedX: 0,
    accumulatedY: 0,
    lastClientX: 0,
    lastClientY: 0,
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

  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      if (useTimelineStore.getState().isPlaying) return;
      setTimelineSnapshotTick((tick) => (tick + 1) % 1000000);
    }, OVERLAY_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  const { camera, objects } = useMemo(
    () => {
      void timelineSnapshotTick;
      const { clipKeyframes, playheadPosition } = useTimelineStore.getState();
      return collectPreviewSceneObjects({
        clips,
        tracks,
        clipKeyframes,
        playheadPosition,
        viewport,
        canvasSize,
        compositionId,
        sceneNavClipId,
      });
    },
    [canvasSize, clips, compositionId, sceneNavClipId, timelineSnapshotTick, tracks, viewport],
  );

  const selectedObject = useMemo(
    () => objects.find((object) => object.clipId === selectedClipId) ?? null,
    [objects, selectedClipId],
  );
  const displayObjects = useMemo(
    () => resolveDisplayObjects(objects, canvasSize),
    [canvasSize, objects],
  );

  const axisHandles = useMemo<SceneAxisScreenHandle[]>(() => {
    if (!selectedObject || !selectedObject.screen.visible) return [];
    return AXES.map((axis) => resolveAxisScreenHandle(axis, selectedObject.worldPosition, camera, canvasSize));
  }, [camera, canvasSize, selectedObject]);

  const endDrag = useCallback(() => {
    if (!dragState) return;
    releasePointerLock();
    if (!endedDragRef.current) {
      endedDragRef.current = true;
      endBatch();
    }
    setDragState(null);
  }, [dragState, releasePointerLock]);

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
      applyDragTransform(dragState, screenDistance);
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
  }, [dragState, endDrag, releasePointerLock]);

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

  const handleAxisMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>, handle: SceneAxisScreenHandle) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;
    const clip = clips.find((candidate) => candidate.id === selectedObject.clipId);
    if (!clip) return;

    const lockTarget = overlayRef.current ?? document.body;
    const fallbackTarget = event.currentTarget;

    event.preventDefault();
    event.stopPropagation();
    endedDragRef.current = false;
    dragRuntimeRef.current = {
      target: lockTarget,
      hasPointerLock: false,
      accumulatedX: 0,
      accumulatedY: 0,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    requestPointerLock(lockTarget, fallbackTarget);
    startBatch(`Scene ${mode}`);
    setDragState({
      clipId: selectedObject.clipId,
      mode,
      axis: handle.axis,
      transformSpace: selectedObject.transformSpace,
      startTransform: cloneTransform(clip.transform),
      direction: handle.direction,
      pixelsPerUnit: handle.pixelsPerUnit,
      viewport,
    });
  }, [clips, mode, requestPointerLock, selectedObject, viewport]);

  if (!enabled || canvasSize.width <= 0 || canvasSize.height <= 0 || objects.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="preview-scene-object-overlay"
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
      {selectedObject && selectedObject.screen.visible && (
        <>
          {axisHandles.map((handle) => (
            <div key={`${mode}-${handle.axis}`} className="preview-scene-gizmo-axis-layer">
              <button
                type="button"
                className={`preview-scene-gizmo-axis axis-${handle.axis} mode-${mode}`}
                style={getAxisStyle(handle)}
                aria-label={`${MODE_LABELS[mode]} ${AXIS_LABELS[handle.axis]}`}
                onMouseDown={(event) => handleAxisMouseDown(event, handle)}
              >
                <span className="preview-scene-gizmo-axis-line" />
                <span className="preview-scene-gizmo-end" />
              </button>
              <span
                className={`preview-scene-gizmo-label axis-${handle.axis}`}
                style={{
                  left: handle.end.x + handle.direction.x * 12,
                  top: handle.end.y + handle.direction.y * 12,
                }}
              >
                {AXIS_LABELS[handle.axis]}
              </span>
            </div>
          ))}
          <div
            className="preview-scene-gizmo-toolbar"
            style={{
              left: Math.min(canvasSize.width - 180, Math.max(8, selectedObject.screen.x + 14)),
              top: Math.min(canvasSize.height - 34, Math.max(8, selectedObject.screen.y - 50)),
            }}
          >
            {(['move', 'rotate', 'scale'] as SceneGizmoMode[]).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={nextMode === mode ? 'active' : ''}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMode(nextMode);
                }}
              >
                {MODE_LABELS[nextMode]}
              </button>
            ))}
          </div>
        </>
      )}

      {displayObjects.map((object) => {
        if (!object.screen.visible) return null;
        const selected = object.clipId === selectedClipId;
        return (
          <button
            key={object.clipId}
            type="button"
            className={`preview-scene-object-handle kind-${object.kind} ${selected ? 'selected' : ''}`}
            style={{
              left: object.displayX,
              top: object.displayY,
            }}
            title={object.name}
            onPointerDown={(event) => handleObjectPointerDown(event, object)}
          >
            <span>{getObjectBadge(object.kind)}</span>
          </button>
        );
      })}
    </div>
  );
}
