import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { SceneViewport } from '../../engine/scene/types';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { renderHostPort } from '../../services/render/renderHostPort';
import {
  createMotionParentGraphSnapshot,
} from '../../services/motionDesign/structure/parentGraphPlanner';
import {
  createTimelineMotionParentEvaluation,
} from '../../services/motionDesign/contracts/timelineStructureAdapter';
import {
  buildMotionNullViewportController,
  planMotionNullViewportDrag,
  type MotionNullViewportControllerModel,
  type MotionNullViewportDiagnostic,
  type MotionNullViewportDragIntent,
} from '../../services/motionDesign/structure/nullViewportController';
import type { MotionNullViewportOverlayProps } from './MotionNullViewportOverlay';

interface UseMotionNullViewportEditingInput {
  readonly enabled: boolean;
  readonly clip: TimelineClip | null;
  readonly clips: readonly TimelineClip[];
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly tracks: readonly TimelineTrack[];
  readonly compositionId: string | null;
  readonly timelineTime: number;
  readonly compositionSize: SceneViewport;
  readonly canvasSize: { readonly width: number; readonly height: number };
  readonly viewZoom: number;
  readonly editableSource: boolean;
  readonly sourceMonitorActive: boolean;
  readonly playbackActive: boolean;
  readonly conflictingModeActive: boolean;
  readonly setPropertyValueAtTime: (
    clipId: string,
    property: 'position.x' | 'position.y',
    value: number,
    timelineTime: number,
  ) => void;
}

export interface UseMotionNullViewportEditingResult {
  readonly controller: MotionNullViewportControllerModel | null;
  readonly diagnostics: readonly MotionNullViewportDiagnostic[];
  readonly overlayProps: Omit<MotionNullViewportOverlayProps, 'width' | 'height'>;
  readonly cancelActiveEdit: () => void;
}

interface ActiveDrag {
  readonly pointerId: number;
  readonly captureTarget: SVGGElement;
  readonly startClient: { readonly x: number; readonly y: number };
  readonly controller: MotionNullViewportControllerModel;
  readonly snapshotKey: string;
  latestIntent: MotionNullViewportDragIntent | null;
}

function controllerSnapshotKey(controller: MotionNullViewportControllerModel): string {
  return JSON.stringify(controller);
}

function activeAt(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime >= clip.startTime && timelineTime < clip.startTime + clip.duration;
}

function dominantAxis(delta: { readonly x: number; readonly y: number }): 'x' | 'y' {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? 'x' : 'y';
}

function controllerWithIntent(
  controller: MotionNullViewportControllerModel,
  intent: MotionNullViewportDragIntent | null,
): MotionNullViewportControllerModel {
  if (!intent) return controller;
  const deltaX = intent.to.screen.x - controller.position.screen.x;
  const deltaY = intent.to.screen.y - controller.position.screen.y;
  const translate = (point: { readonly x: number; readonly y: number }) => ({
    x: point.x + deltaX,
    y: point.y + deltaY,
  });
  return {
    ...controller,
    localTransform: {
      ...controller.localTransform,
      position: { ...intent.to.local },
    },
    worldTransform: intent.previewWorldTransform,
    position: {
      ...controller.position,
      world: { ...intent.to.world },
      composition: { ...intent.to.composition },
      screen: { ...intent.to.screen },
    },
    handle: {
      ...controller.handle,
      geometry: {
        ...controller.handle.geometry,
        center: { ...intent.to.screen },
        xAxis: {
          from: translate(controller.handle.geometry.xAxis.from),
          to: translate(controller.handle.geometry.xAxis.to),
        },
        yAxis: {
          from: translate(controller.handle.geometry.yAxis.from),
          to: translate(controller.handle.geometry.yAxis.to),
        },
      },
    },
  };
}

export function useMotionNullViewportEditing({
  enabled,
  clip,
  clips,
  clipKeyframes,
  tracks,
  compositionId,
  timelineTime,
  compositionSize,
  canvasSize,
  viewZoom,
  editableSource,
  sourceMonitorActive,
  playbackActive,
  conflictingModeActive,
  setPropertyValueAtTime,
}: UseMotionNullViewportEditingInput): UseMotionNullViewportEditingResult {
  const previewOwnerId = useId();
  const mountedRef = useRef(true);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [previewIntent, setPreviewIntent] = useState<MotionNullViewportDragIntent | null>(null);

  const eligible = Boolean(
    enabled
    && editableSource
    && !sourceMonitorActive
    && !playbackActive
    && !conflictingModeActive
    && clip?.source?.type === 'motion-null'
    && activeAt(clip, timelineTime),
  );

  const baseResult = useMemo(() => {
    if (!eligible || !clip || !compositionId) {
      return {
        controller: null,
        diagnostics: [] as readonly MotionNullViewportDiagnostic[],
      };
    }
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const graph = createMotionParentGraphSnapshot(clips.map((candidate) => ({
      clipId: candidate.id,
      compositionId,
      space: candidate.is3D ? '3d' as const : '2d' as const,
      ...(candidate.parentClipId ? { parentClipId: candidate.parentClipId } : {}),
    })));
    const evaluation = createTimelineMotionParentEvaluation(clips, clipKeyframes, timelineTime);
    const result = buildMotionNullViewportController({
      selectedClipId: clip.id,
      clips: clips.map((candidate) => {
        const track = tracksById.get(candidate.trackId);
        return {
          clipId: candidate.id,
          name: candidate.name,
          sourceType: candidate.source?.type ?? null,
          locked: !track || track.locked === true,
          hidden: !track || track.visible === false,
        };
      }),
      graph,
      evaluation,
      timelineTime,
      mapping: {
        compositionSize: {
          width: compositionSize.width,
          height: compositionSize.height,
        },
        screenRect: {
          x: 0,
          y: 0,
          width: canvasSize.width,
          height: canvasSize.height,
        },
      },
    });
    return {
      controller: result.controller,
      diagnostics: result.diagnostics,
    };
  }, [
    canvasSize.height,
    canvasSize.width,
    clip,
    clipKeyframes,
    clips,
    compositionId,
    compositionSize.height,
    compositionSize.width,
    eligible,
    timelineTime,
    tracks,
  ]);
  const baseController = baseResult.controller;

  const clearOwnedPreview = useCallback(() => {
    useTimelineStore.setState((state) => state.layerTransformPreview?.ownerId === previewOwnerId
      ? { layerTransformPreview: null }
      : {});
  }, [previewOwnerId]);

  const applyIntentPreview = useCallback((intent: MotionNullViewportDragIntent) => {
    useTimelineStore.setState({
      layerTransformPreview: {
        ownerId: previewOwnerId,
        clipId: intent.clipId,
        transform: { position: { ...intent.to.local, z: clip?.transform.position.z ?? 0 } },
      },
    });
    if (mountedRef.current) setPreviewIntent(intent);
    renderHostPort.requestRender();
  }, [clip?.transform.position.z, previewOwnerId]);

  const cancelActiveEdit = useCallback(() => {
    const active = activeDragRef.current;
    if (active) {
      try {
        if (!active.captureTarget.hasPointerCapture
          || active.captureTarget.hasPointerCapture(active.pointerId)) {
          active.captureTarget.releasePointerCapture?.(active.pointerId);
        }
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }
    activeDragRef.current = null;
    if (mountedRef.current) setPreviewIntent(null);
    clearOwnedPreview();
    renderHostPort.requestRender();
  }, [clearOwnedPreview]);

  const commitIntent = useCallback((intent: MotionNullViewportDragIntent) => {
    const currentClip = clips.find((candidate) => candidate.id === intent.clipId);
    const currentTrack = currentClip
      ? tracks.find((track) => track.id === currentClip.trackId)
      : undefined;
    const changedProperties = intent.propertyValues.filter((propertyValue) => (
      Math.abs(propertyValue.toValue - propertyValue.fromValue) > 1e-9
    ));
    if (
      !baseController
      || baseController.clipId !== intent.clipId
      || baseController.timelineTime !== intent.timelineTime
      || timelineTime !== intent.timelineTime
      || !currentClip
      || !currentTrack
      || currentTrack.locked === true
      || currentTrack.visible === false
      || !activeAt(currentClip, intent.timelineTime)
      || changedProperties.length === 0
    ) {
      return false;
    }
    const batch = startBatch(intent.history.label);
    try {
      for (const propertyValue of changedProperties) {
        setPropertyValueAtTime(
          intent.clipId,
          propertyValue.property,
          propertyValue.toValue,
          intent.timelineTime,
        );
      }
    } finally {
      if (batch.opened) endBatch();
    }
    return true;
  }, [baseController, clips, setPropertyValueAtTime, timelineTime, tracks]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    if (!baseController?.handle.interactive || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activeDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClient: { x: event.clientX, y: event.clientY },
      controller: baseController,
      snapshotKey: controllerSnapshotKey(baseController),
      latestIntent: null,
    };
  }, [baseController]);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    const active = activeDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const zoom = Number.isFinite(viewZoom) && viewZoom > 0 ? viewZoom : 1;
    const delta = {
      x: (event.clientX - active.startClient.x) / zoom,
      y: (event.clientY - active.startClient.y) / zoom,
    };
    const planned = planMotionNullViewportDrag({
      controller: active.controller,
      screenDelta: delta,
      axis: event.shiftKey ? dominantAxis(delta) : 'free',
    });
    if (!planned.ok) return;
    active.latestIntent = planned.intent;
    applyIntentPreview(planned.intent);
  }, [applyIntentPreview, viewZoom]);

  const finishPointer = useCallback((event: ReactPointerEvent<SVGGElement>, commit: boolean) => {
    const active = activeDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const intent = active.latestIntent;
    const snapshotStillCurrent = Boolean(
      baseController
      && active.snapshotKey === controllerSnapshotKey(baseController),
    );
    cancelActiveEdit();
    if (commit && intent && snapshotStillCurrent) commitIntent(intent);
  }, [baseController, cancelActiveEdit, commitIntent]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelActiveEdit();
      return;
    }
    if (!baseController || !baseController.gesture.keyboard.keys.includes(
      event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
    )) return;
    event.preventDefault();
    event.stopPropagation();
    const descriptor = baseController.gesture.keyboard;
    const step = event.altKey
      ? descriptor.coarseStepScreenPixels
      : event.ctrlKey || event.metaKey
        ? descriptor.fineStepScreenPixels
        : descriptor.defaultStepScreenPixels;
    const delta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    };
    const planned = planMotionNullViewportDrag({ controller: baseController, screenDelta: delta });
    if (planned.ok) commitIntent(planned.intent);
  }, [baseController, cancelActiveEdit, commitIntent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelActiveEdit();
    };
  }, [cancelActiveEdit]);
  useEffect(() => {
    const active = activeDragRef.current;
    if (
      eligible
      && baseController
      && (!active || active.snapshotKey === controllerSnapshotKey(baseController))
    ) return;
    cancelActiveEdit();
  }, [baseController, cancelActiveEdit, eligible]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('blur', cancelActiveEdit);
    return () => window.removeEventListener('blur', cancelActiveEdit);
  }, [cancelActiveEdit]);

  const controller = useMemo(
    () => baseController ? controllerWithIntent(baseController, previewIntent) : null,
    [baseController, previewIntent],
  );

  return {
    controller,
    diagnostics: baseResult.diagnostics,
    cancelActiveEdit,
    overlayProps: {
      controller,
      diagnostics: baseResult.diagnostics,
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finishPointer(event, true),
      onPointerCancel: (event) => finishPointer(event, false),
      onLostPointerCapture: cancelActiveEdit,
      onKeyDown,
    },
  };
}
