// Preview canvas component with After Effects-style editing overlay
import './Preview.css';
import './PreviewEditMode.css';
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEngine } from '../../hooks/useEngine';
import {
  selectActiveGaussianSplatLoadProgress,
  selectSceneNavClipId,
  selectSceneNavFpsMode,
  selectSceneNavFpsMoveSpeed,
  selectSceneNavNoKeyframes,
  useEngineStore,
} from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { useSettingsStore } from '../../stores/settingsStore';
import { startBatch, endBatch } from '../../stores/historyStore';
import { PreviewControls } from './PreviewControls';
import { PreviewCanvasMount } from './PreviewCanvasMount';
import { useEditModeOverlay } from './useEditModeOverlay';
import { useLayerDrag } from './useLayerDrag';
import { useSAM2Store } from '../../stores/sam2Store';
import type { PreviewPanelData, PreviewPanelSource } from '../../types/dock';
import { getFirstEditablePreviewPanelId, getPreviewPanelIdFromElement } from './previewPanelDom';
import { usePreviewDropdownState } from './usePreviewDropdownState';
import { usePreviewEditCameraController } from './usePreviewEditCameraController';
import { useActiveCameraClipAtPlayhead, usePreviewModeState } from './usePreviewModeState';
import { usePreviewPanelInputBindings } from './usePreviewPanelInputBindings';
import { usePreviewMouseRouting } from './usePreviewMouseRouting';
import { usePreviewPlaybackDisplay } from './usePreviewPlaybackDisplay';
import { usePreviewRenderTargetRegistration } from './usePreviewRenderTargetRegistration';
import { usePreviewSceneNavigation } from './usePreviewSceneNavigation';
import { usePreviewSourceConfig } from './usePreviewSourceConfig';
import { usePreviewViewGeometry } from './usePreviewViewGeometry';
import { usePreviewViewport } from './usePreviewViewport';
import { usePreviewWheelHandler } from './usePreviewWheelHandler';
import { usePreviewInitialEditCameraView } from './usePreviewInitialEditCameraView';
import { createPreviewEditorCameraClip } from './usePreviewEditCameraConfig';
import type { SceneCameraConfig } from '../../engine/scene/types';
import type { Layer } from '../../types/layers';
const SCENE_OBJECT_INTERACTION_SELECTOR = [
  '.preview-scene-object-handle',
  '.preview-scene-gizmo-axis',
  '.preview-scene-gizmo-rotate',
  '.preview-scene-gizmo-toolbar',
].join(',');

function isSceneObjectInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(SCENE_OBJECT_INTERACTION_SELECTOR));
}
interface PreviewProps {
  panelId: string;
  source: PreviewPanelSource;
  showTransparencyGrid: boolean; // per-tab transparency toggle
  initialEdit?: Pick<PreviewPanelData, 'initialEditMode' | 'initialEditCameraView'>;
}

export function Preview({ panelId, source, showTransparencyGrid, initialEdit }: PreviewProps) {
  const { isEngineReady } = useEngine();
  // NOTE: these are store actions (stable references) — safe to destructure once.
  const { addKeyframe, hasKeyframes, isRecording } = useTimelineStore.getState();
  const engineInitFailed = useEngineStore((s) => s.engineInitFailed);
  const engineInitError = useEngineStore((s) => s.engineInitError);
  const sceneNavClipId = useEngineStore(selectSceneNavClipId);
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const sceneNavNoKeyframes = useEngineStore(selectSceneNavNoKeyframes);
  const setSceneGizmoVisible = useEngineStore((s) => s.setSceneGizmoVisible);
  const activeSplatLoadProgress = useEngineStore(selectActiveGaussianSplatLoadProgress);
  const setSceneNavFpsMoveSpeed = useEngineStore((s) => s.setSceneNavFpsMoveSpeed);
  const {
    clips,
    selectedClipIds,
    primarySelectedClipId,
    selectClip,
    updateClipTransform,
    updateTextProperties,
    updateTextBoundsVertex,
    updateTextBoundsVertices,
    setPropertyValue,
    getInterpolatedTextBounds,
    getInterpolatedTransform,
    maskEditMode,
    maskPanelActive,
    layers,
    selectedLayerId,
    selectLayer,
    updateLayer,
    tracks,
    isPlaying,
    playheadPosition,
    playbackWarmup,
    isExporting,
    exportPreviewFrame,
  } = useTimelineStore(useShallow(s => ({
    clips: s.clips,
    selectedClipIds: s.selectedClipIds,
    primarySelectedClipId: s.primarySelectedClipId,
    selectClip: s.selectClip,
    updateClipTransform: s.updateClipTransform,
    updateTextProperties: s.updateTextProperties,
    updateTextBoundsVertex: s.updateTextBoundsVertex,
    updateTextBoundsVertices: s.updateTextBoundsVertices,
    setPropertyValue: s.setPropertyValue,
    getInterpolatedTextBounds: s.getInterpolatedTextBounds,
    getInterpolatedTransform: s.getInterpolatedTransform,
    maskEditMode: s.maskEditMode,
    maskPanelActive: s.maskPanelActive,
    layers: s.layers,
    selectedLayerId: s.selectedLayerId,
    selectLayer: s.selectLayer,
    updateLayer: s.updateLayer,
    tracks: s.tracks,
    isPlaying: s.isPlaying,
    playheadPosition: s.playheadPosition,
    playbackWarmup: s.playbackWarmup,
    isExporting: s.isExporting,
    exportPreviewFrame: s.exportPreviewFrame,
  })));
  const {
    activeCompositionId,
    activeCompositionVideoTracks,
    closeSourceMonitor,
    compositions,
    displayedCompId,
    effectiveResolution,
    isEditableSource,
    setPanelSource,
    sourceLabel,
    sourceMonitorActive,
    sourceMonitorFile,
    sourceMonitorPlaybackRequestId,
    stableRenderSource,
    toggleTransparency,
  } = usePreviewSourceConfig({
    panelId,
    source,
    showTransparencyGrid,
    tracks,
  });
  const { previewQuality, setPreviewQuality } = useSettingsStore(useShallow(s => ({
    previewQuality: s.previewQuality,
    setPreviewQuality: s.setPreviewQuality,
  })));
  const sam2Active = useSAM2Store((s) => s.isActive);

  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [, setCompReady] = useState(false);
  const [previewCameraOverride, setPreviewCameraOverride] = useState<SceneCameraConfig | null>(null);

  useEffect(() => {
    setSceneGizmoVisible(true);
  }, [setSceneGizmoVisible]);

  const {
    dropdownRef,
    dropdownStyle,
    qualityDropdownRef,
    qualityOpen,
    selectorOpen,
    setQualityOpen,
    setSelectorOpen,
  } = usePreviewDropdownState();

  // Stats overlay state
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [sceneGizmoToolbarTarget, setSceneGizmoToolbarTarget] = useState<HTMLDivElement | null>(null);

  const [editMode, setEditMode] = useState(initialEdit?.initialEditMode ?? false);
  useEffect(() => { if (initialEdit?.initialEditMode) setEditMode(true); }, [initialEdit?.initialEditMode]);
  // #206: while editing a text clip inside the layer-edit mode, this toggles
  // between layer transform (move/scale handles) and text typing. Double-click
  // enters typing; Escape returns to transform.
  const [textTyping, setTextTyping] = useState(false);
  const [sceneObjectOverlayEnabled, setSceneObjectOverlayEnabled] = useState(true);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isGaussianOrbiting, setIsGaussianOrbiting] = useState(false);
  const [isGaussianPanning, setIsGaussianPanning] = useState(false);
  const [isGaussianFpsLooking, setIsGaussianFpsLooking] = useState(false);
  const renderResolution = editMode && containerSize.width > 0 && containerSize.height > 0
    ? containerSize
    : effectiveResolution;
  const viewportOverride = useMemo(() => editMode && containerSize.width > 0 && containerSize.height > 0
    ? {
        width: containerSize.width,
        height: containerSize.height,
        cameraOverride: previewCameraOverride,
      }
    : null, [containerSize.height, containerSize.width, editMode, previewCameraOverride]);

  usePreviewRenderTargetRegistration({
    canvasRef,
    isEngineReady,
    panelId,
    setCompReady,
    showTransparencyGrid,
    stableRenderSource,
    viewportOverride,
  });

  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const gaussianOrbitStart = useRef({
    clipId: null as string | null,
    x: 0,
    y: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    startPosX: 0,
    startPosY: 0,
    startPosZ: 0,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    radius: 0,
  });
  const gaussianPanStart = useRef({
    clipId: null as string | null,
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
    panZ: 0,
  });
  const gaussianFpsLookStart = useRef({
    clipId: null as string | null,
    x: 0,
    y: 0,
  });
  const gaussianWheelBatchTimerRef = useRef<number | null>(null);
  const gaussianKeyboardMoveCodesRef = useRef<Set<'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE'>>(new Set());
  const gaussianKeyboardFrameRef = useRef<number | null>(null);
  const gaussianKeyboardLastTimeRef = useRef<number | null>(null);
  const gaussianKeyboardBatchActiveRef = useRef(false);
  const sceneNavHistoryBatchActiveRef = useRef(false);
  const activeCameraClipAtPlayhead = useActiveCameraClipAtPlayhead(clips, tracks, playheadPosition);
  const editCameraClip = useMemo(() => createPreviewEditorCameraClip(panelId), [panelId]);
  const editCameraModeActive = Boolean(isEditableSource && editMode && (initialEdit?.initialEditMode || activeCameraClipAtPlayhead));

  const getSceneNavPointerLockTarget = useCallback(() => {
    return canvasWrapperRef.current ?? containerRef.current;
  }, []);

  const isCanvasInteractionTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    return Boolean(
      canvasRef.current?.contains(target) ||
      canvasWrapperRef.current?.contains(target),
    );
  }, []);

  const isPreviewShortcutTarget = useCallback(() => {
    if (typeof document === 'undefined') return true;
    const activeElement = document.activeElement;
    const focusedPanelId = activeElement instanceof Element
      ? getPreviewPanelIdFromElement(activeElement)
      : null;
    if (focusedPanelId) {
      return focusedPanelId === panelId;
    }
    return getFirstEditablePreviewPanelId() === panelId;
  }, [panelId]);

  const startSceneNavHistoryBatch = useCallback((label: string) => {
    if (editCameraModeActive || sceneNavHistoryBatchActiveRef.current) return;
    startBatch(label);
    sceneNavHistoryBatchActiveRef.current = true;
  }, [editCameraModeActive, sceneNavHistoryBatchActiveRef]);

  const endSceneNavHistoryBatch = useCallback(() => {
    if (!sceneNavHistoryBatchActiveRef.current) return;
    sceneNavHistoryBatchActiveRef.current = false;
    endBatch();
  }, []);

  const endGaussianWheelBatch = useCallback(() => {
    if (gaussianWheelBatchTimerRef.current === null) return;
    window.clearTimeout(gaussianWheelBatchTimerRef.current);
    gaussianWheelBatchTimerRef.current = null;
    endSceneNavHistoryBatch();
  }, [endSceneNavHistoryBatch]);

  const scheduleGaussianWheelBatchEnd = useCallback(() => {
    if (gaussianWheelBatchTimerRef.current === null) {
      startSceneNavHistoryBatch('Camera position');
    } else {
      window.clearTimeout(gaussianWheelBatchTimerRef.current);
    }
    gaussianWheelBatchTimerRef.current = window.setTimeout(() => {
      gaussianWheelBatchTimerRef.current = null;
      endSceneNavHistoryBatch();
    }, 180);
  }, [endSceneNavHistoryBatch, startSceneNavHistoryBatch]);

  const finishGaussianKeyboardBatch = useCallback(() => {
    if (!gaussianKeyboardBatchActiveRef.current) return;
    gaussianKeyboardBatchActiveRef.current = false;
    endSceneNavHistoryBatch();
  }, [endSceneNavHistoryBatch]);

  const stopGaussianKeyboardLoop = useCallback(() => {
    if (gaussianKeyboardFrameRef.current !== null) {
      window.cancelAnimationFrame(gaussianKeyboardFrameRef.current);
      gaussianKeyboardFrameRef.current = null;
    }
    gaussianKeyboardLastTimeRef.current = null;
  }, []);

  const stopGaussianKeyboardMovement = useCallback(() => {
    gaussianKeyboardMoveCodesRef.current.clear();
    stopGaussianKeyboardLoop();
    finishGaussianKeyboardBatch();
  }, [finishGaussianKeyboardBatch, stopGaussianKeyboardLoop]);

  const stopGaussianFpsLook = useCallback((exitPointerLock = true) => {
    const activeClipId = gaussianFpsLookStart.current.clipId;
    gaussianFpsLookStart.current.clipId = null;
    gaussianFpsLookStart.current.x = 0;
    gaussianFpsLookStart.current.y = 0;
    setIsGaussianFpsLooking(false);

    if (exitPointerLock) {
      const pointerLockTarget = getSceneNavPointerLockTarget();
      if (pointerLockTarget && document.pointerLockElement === pointerLockTarget) {
        document.exitPointerLock();
      }
    }

    if (activeClipId) {
      endSceneNavHistoryBatch();
    }
  }, [endSceneNavHistoryBatch, getSceneNavPointerLockTarget]);

  const {
    activeEditCameraOrthoFrame,
    applyNavigationCameraValues,
    editCameraClipIdRef,
    editCameraOrthoFrame,
    editCameraOrthoHint,
    editCameraOrthoMode,
    editCameraOrthoPanStart,
    editCameraOrthoViewActive,
    editCameraSettingsRef,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    isEditCameraOrthoPanning,
    sceneObjectWorldGridPlane,
    setEditCameraOrthoFrame,
    setEditCameraView,
    setIsEditCameraOrthoPanning,
  } = usePreviewEditCameraController({
    addKeyframe,
    displayedCompId,
    editCameraClip,
    editCameraModeActive,
    effectiveResolution: renderResolution,
    hasKeyframes,
    isRecording,
    previewCameraOverride,
    sceneNavNoKeyframes,
    setPreviewCameraOverride,
    updateClipTransform,
  });

  usePreviewInitialEditCameraView(initialEdit, editCameraModeActive, setEditCameraView);

  const {
    activeSharedSceneOverlayContent,
    effectiveSceneNavFpsMode,
    freeCanvasNavigationMode,
    layerTransformMode,
    maskNavigationMode,
    navigationSceneNavClip,
    sceneNavEnabled,
    sceneObjectOverlaySelectedClipId,
    selectedClip,
    selectedTextBounds,
    selectedTextLayer,
    showSceneObjectOverlay,
    textClipEditMode,
    textPreviewEditorEnabled,
    textTypingActive,
  } = usePreviewModeState({
    activeCameraClipAtPlayhead,
    clips,
    editCameraClip,
    editCameraModeActive,
    editCameraOrthoFrame,
    editCameraOrthoMode,
    editCameraOrthoViewActive,
    editMode,
    getInterpolatedTextBounds,
    isEditableSource,
    isPlaying,
    layers,
    maskPanelActive,
    playheadPosition,
    preserveEditModeWithoutSource: initialEdit?.initialEditMode === true,
    sceneNavClipId,
    sceneObjectOverlayEnabled,
    sceneNavFpsMode,
    selectedClipId,
    selectedLayerId,
    selectLayer,
    setEditMode,
    setTextTyping,
    sourceMonitorActive,
    textTyping,
    tracks,
  });

  const { handleSceneNavBlur, handleSceneNavKeyDown, handleSceneNavKeyUp } = usePreviewSceneNavigation({
    applyNavigationCameraValues,
    containerRef,
    editCameraModeActive,
    effectiveResolution: renderResolution,
    effectiveSceneNavFpsMode,
    endSceneNavHistoryBatch,
    finishGaussianKeyboardBatch,
    gaussianFpsLookStart,
    gaussianWheelBatchTimerRef,
    gaussianKeyboardBatchActiveRef,
    gaussianKeyboardFrameRef,
    gaussianKeyboardLastTimeRef,
    gaussianKeyboardMoveCodesRef,
    gaussianOrbitStart,
    gaussianPanStart,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    getSceneNavSolveSettings,
    isGaussianFpsLooking,
    isGaussianOrbiting,
    isGaussianPanning,
    isPreviewShortcutTarget,
    navigationSceneNavClip,
    sceneNavEnabled,
    sceneNavFpsMoveSpeed,
    setEditCameraView,
    setIsEditCameraOrthoPanning,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    startSceneNavHistoryBatch,
    stopGaussianFpsLook,
    stopGaussianKeyboardLoop,
    stopGaussianKeyboardMovement,
  });

  const {
    exportPreviewDisplaySize,
    playbackWaiterVideoCount,
    showPlaybackWaiter,
  } = usePreviewPlaybackDisplay({
    canvasSize,
    containerSize,
    exportPreviewFrame,
    isEngineReady,
    playbackWarmup,
    sourceMonitorActive,
  });

  usePreviewViewport({
    containerRef,
    effectiveResolution,
    exportPreviewCanvasRef,
    exportPreviewFrame,
    fillContainer: editMode,
    isExporting,
    setCanvasSize,
    setContainerSize,
  });

  const handleWheel = usePreviewWheelHandler({
    activeEditCameraOrthoFrame,
    applyNavigationCameraValues,
    canvasRef,
    canvasSize,
    containerRef,
    containerSize,
    editCameraClipIdRef,
    editCameraModeActive,
    editCameraOrthoMode,
    editCameraOrthoViewActive,
    editCameraSettingsRef,
    effectiveResolution: renderResolution,
    effectiveSceneNavFpsMode,
    freeCanvasNavigationMode,
    gaussianFpsLookStart,
    gaussianKeyboardMoveCodesRef,
    getFreshSceneNavTransform,
    isCanvasInteractionTarget,
    navigationSceneNavClip,
    sceneNavEnabled,
    scheduleGaussianWheelBatchEnd,
    setEditCameraOrthoFrame,
    setSceneNavFpsMoveSpeed,
    setViewPan,
    setViewZoom,
    viewPan,
    viewZoom,
  });

  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    resetView,
  } = usePreviewMouseRouting({
    activeEditCameraOrthoFrame,
    canvasSize,
    containerRef,
    editCameraOrthoMode,
    editCameraOrthoPanStart,
    editCameraOrthoViewActive,
    effectiveSceneNavFpsMode,
    endGaussianWheelBatch,
    freeCanvasNavigationMode,
    gaussianFpsLookStart,
    gaussianOrbitStart,
    gaussianPanStart,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    getSceneNavSolveSettings,
    isCanvasInteractionTarget,
    isEditCameraOrthoPanning,
    isPanning,
    isSceneObjectInteractionTarget,
    navigationSceneNavClip,
    panStart,
    sceneNavEnabled,
    setEditCameraOrthoFrame,
    setIsEditCameraOrthoPanning,
    setIsGaussianFpsLooking,
    setIsGaussianOrbiting,
    setIsGaussianPanning,
    setIsPanning,
    setViewPan,
    setViewZoom,
    startSceneNavHistoryBatch,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
    viewPan,
  });

  const { handleContextMenu, handleAuxClick, setPanelEditMode } = usePreviewPanelInputBindings({
    containerRef,
    editCameraOrthoViewActive,
    handleWheel,
    isCanvasInteractionTarget,
    isEditableSource,
    isPreviewShortcutTarget,
    sceneNavEnabled,
    setEditMode,
  });

  const { canvasInContainer, viewTransform } = usePreviewViewGeometry({
    canvasSize,
    containerSize,
    freeCanvasNavigationMode,
    viewPan,
    viewZoom,
  });

  // Edit mode helpers (bounding box calculation, hit testing, cursor mapping)
  const getLayerProjectionTransform = useCallback((layer: Layer) => {
    const clip = layer.sourceClipId
      ? clips.find(candidate => candidate.id === layer.sourceClipId)
      : clips.find(candidate => candidate.name === layer.name);
    if (!clip) return undefined;

    return getInterpolatedTransform(
      clip.id,
      playheadPosition - clip.startTime,
    );
  }, [clips, getInterpolatedTransform, playheadPosition]);
  const { calculateLayerBounds, findLayerAtPosition, findHandleAtPosition, getCursorForHandle } =
    useEditModeOverlay({
      effectiveResolution: renderResolution,
      canvasSize,
      canvasInContainer,
      viewZoom,
      layers,
      getLayerProjectionTransform,
    });

  // Layer drag logic (move/scale, overlay drawing, document-level listeners)
  const { isDragging, dragMode, dragHandle, hoverHandle, handleOverlayMouseDown, handleOverlayMouseMove, handleOverlayMouseUp } =
    useLayerDrag({
      editMode: layerTransformMode, overlayRef, canvasSize, canvasInContainer, viewZoom,
      layers, clips, tracks, selectedLayerId, selectedClipId,
      selectClip, selectLayer, updateClipTransform, updateLayer,
      calculateLayerBounds, findLayerAtPosition, findHandleAtPosition,
    });

  const previewCanvasMountProps = {
    activeSharedSceneOverlayContent, activeSplatLoadProgress, canvasInContainer, canvasRef,
    canvasSize, canvasWrapperRef, clips, closeSourceMonitor, containerSize, displayedCompId,
    dragHandle, dragMode, editCameraGizmoTransform: activeCameraClipAtPlayhead ? getInterpolatedTransform(activeCameraClipAtPlayhead.id, playheadPosition - activeCameraClipAtPlayhead.startTime) : null, editCameraModeActive, editCameraOrthoHint,
    editMode, effectiveResolution: renderResolution, effectiveSceneNavFpsMode, engineInitError, engineInitFailed,
    exportPreviewCanvasRef, exportPreviewDisplaySize, exportPreviewFrame,
    getCursorForHandle, handleOverlayMouseDown,
    handleOverlayMouseMove, handleOverlayMouseUp, hoverHandle, isDragging, isEditableSource,
    isEngineReady, isExporting, layerTransformMode, maskEditMode, maskNavigationMode,
    maskPanelActive, overlayRef, playbackWaiterVideoCount, previewCameraOverride,
    previewQuality, qualityDropdownRef, qualityOpen, sam2Active, sceneGizmoToolbarTarget,
    sceneNavClipId, sceneNavEnabled, sceneObjectOverlaySelectedClipId, selectClip,
    selectedClip, selectedTextBounds, selectedTextLayer, setPropertyValue, setPreviewQuality,
    setQualityOpen, setSceneGizmoToolbarTarget, setTextTyping, showPlaybackWaiter,
    showSceneObjectOverlay, showTransparencyGrid, sourceMonitorActive, sourceMonitorFile,
    sourceMonitorPlaybackRequestId, statsExpanded, textClipEditMode, textPreviewEditorEnabled,
    textTypingActive, toggleTransparency, tracks, updateTextBoundsVertex,
    updateTextBoundsVertices, updateTextProperties, viewTransform, viewZoom,
    editCameraClip: activeCameraClipAtPlayhead,
    worldGridPlane: sceneObjectWorldGridPlane,
    onToggleStats: () => setStatsExpanded(!statsExpanded),
  };

  return (
    <div
      className="preview-container"
      ref={containerRef}
      data-preview-panel-id={panelId}
      data-preview-editable={isEditableSource ? 'true' : 'false'}
      onMouseDownCapture={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onAuxClick={handleAuxClick}
      onKeyDownCapture={handleSceneNavKeyDown}
      onKeyUpCapture={handleSceneNavKeyUp}
      onBlur={handleSceneNavBlur}
      tabIndex={0}
      style={{
        cursor: isGaussianOrbiting || isGaussianPanning
          ? 'grabbing'
          : isGaussianFpsLooking
            ? 'crosshair'
            : isEditCameraOrthoPanning || isPanning
              ? 'grabbing'
              : editCameraOrthoViewActive
                ? 'default'
                : sceneNavEnabled
                  ? (effectiveSceneNavFpsMode ? 'crosshair' : 'grab')
                  : layerTransformMode
                    ? 'crosshair'
                    : 'default',
      }}
    >
      {/* Controls bar */}
      <PreviewControls
        sourceMonitorActive={sourceMonitorActive}
        sourceMonitorFileName={sourceMonitorFile?.name ?? null}
        closeSourceMonitor={closeSourceMonitor}
        editMode={editMode}
        canEdit={isEditableSource}
        setEditMode={setPanelEditMode}
        showEditViewControls={freeCanvasNavigationMode}
        sceneObjectOverlayEnabled={sceneObjectOverlayEnabled}
        setSceneObjectOverlayEnabled={setSceneObjectOverlayEnabled}
        viewZoom={viewZoom}
        resetView={resetView}
        source={source}
        sourceLabel={sourceLabel}
        activeCompositionId={activeCompositionId}
        activeCompositionVideoTracks={activeCompositionVideoTracks}
        selectorOpen={selectorOpen}
        setSelectorOpen={setSelectorOpen}
        dropdownRef={dropdownRef}
        dropdownStyle={dropdownStyle}
        compositions={compositions}
        setPanelSource={setPanelSource}
      />

      <PreviewCanvasMount {...previewCanvasMountProps} />
    </div>
  );
}
