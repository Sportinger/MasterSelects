// Preview canvas component with After Effects-style editing overlay

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Logger } from '../../services/logger';

const log = Logger.create('Preview');
import { useEngine } from '../../hooks/useEngine';
import { useShortcut } from '../../hooks/useShortcut';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore, DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { startBatch, endBatch } from '../../stores/historyStore';
import { MaskOverlay } from './MaskOverlay';
import { SAM2Overlay } from './SAM2Overlay';
import { SourceMonitor } from './SourceMonitor';
import { StatsOverlay } from './StatsOverlay';
import { PreviewControls } from './PreviewControls';
import { PreviewBottomControls } from './PreviewBottomControls';
import { useEditModeOverlay } from './useEditModeOverlay';
import { useLayerDrag } from './useLayerDrag';
import { useSAM2Store } from '../../stores/sam2Store';
import { renderScheduler } from '../../services/renderScheduler';
import { engine } from '../../engine/WebGPUEngine';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../engine/gaussian/types';
import { resolveOrbitCameraTranslationForFixedEye } from '../../engine/gaussian/core/SplatCameraUtils';
import type { PreviewPanelSource } from '../../types/dock';
import {
  createPreviewPanelDataPatch,
  getPreviewSourceLabel,
  resolvePreviewSourceCompositionId,
} from '../../utils/previewPanelSource';

const CAMERA_NAV_MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

function isCameraNavMoveCode(code: string): code is 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE' {
  return CAMERA_NAV_MOVE_CODES.has(code);
}

function getCameraNavForwardOffset(scaleZ: number | undefined): number {
  return typeof scaleZ === 'number' && Number.isFinite(scaleZ) ? scaleZ : 0;
}

function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

const DEFAULT_NATIVE_GAUSSIAN_CAMERA_FOV = 60;
const DEFAULT_NATIVE_GAUSSIAN_MIN_DISTANCE = 5;
const CAMERA_NAV_FPS_LOOK_SPEED = 0.18;
const CAMERA_NAV_FPS_PITCH_LIMIT = 89.5;

interface PreviewProps {
  panelId: string;
  source: PreviewPanelSource;
  showTransparencyGrid: boolean; // per-tab transparency toggle
}

export function Preview({ panelId, source, showTransparencyGrid }: PreviewProps) {
  const { isEngineReady } = useEngine();
  // NOTE: these are store actions (stable references) — safe to destructure once.
  // For state-reading functions (getInterpolatedTransform), call getState() at usage site.
  const { setPropertyValue, hasKeyframes, isRecording } = useTimelineStore.getState();
  const engineInitFailed = useEngineStore((s) => s.engineInitFailed);
  const engineInitError = useEngineStore((s) => s.engineInitError);
  const engineStats = useEngineStore(s => s.engineStats);
  const gaussianSplatNavClipId = useEngineStore((s) => s.gaussianSplatNavClipId);
  const gaussianSplatNavFpsMode = useEngineStore((s) => s.gaussianSplatNavFpsMode);
  const { clips, selectedClipIds, primarySelectedClipId, selectClip, updateClipTransform, maskEditMode, layers, selectedLayerId, selectLayer, updateLayer, tracks } = useTimelineStore(useShallow(s => ({
    clips: s.clips,
    selectedClipIds: s.selectedClipIds,
    primarySelectedClipId: s.primarySelectedClipId,
    selectClip: s.selectClip,
    updateClipTransform: s.updateClipTransform,
    maskEditMode: s.maskEditMode,
    layers: s.layers,
    selectedLayerId: s.selectedLayerId,
    selectLayer: s.selectLayer,
    updateLayer: s.updateLayer,
    tracks: s.tracks,
  })));
  const { compositions, activeCompositionId } = useMediaStore(useShallow(s => ({
    compositions: s.compositions,
    activeCompositionId: s.activeCompositionId,
  })));
  const { addPreviewPanel, updatePanelData, closePanelById } = useDockStore(useShallow(s => ({
    addPreviewPanel: s.addPreviewPanel,
    updatePanelData: s.updatePanelData,
    closePanelById: s.closePanelById,
  })));
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
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [, setCompReady] = useState(false);

  const previewCompositionId = useMediaStore(state => state.previewCompositionId);
  const sourceMonitorFileId = useMediaStore(state => state.sourceMonitorFileId);
  const sourceMonitorFile = useMediaStore(state =>
    state.sourceMonitorFileId ? state.files.find(f => f.id === state.sourceMonitorFileId) ?? null : null
  );
  const activeCompositionVideoTracks = useMemo(
    () => tracks.filter((track) => track.type === 'video'),
    [tracks],
  );
  const sourceLabel = useMemo(
    () => getPreviewSourceLabel(source, compositions, activeCompositionId, activeCompositionVideoTracks),
    [source, compositions, activeCompositionId, activeCompositionVideoTracks],
  );

  // Source monitor: show raw media file instead of composition
  const sourceMonitorActive = source.type === 'activeComp' && sourceMonitorFile !== null;

  const closeSourceMonitor = useCallback(() => {
    useMediaStore.getState().setSourceMonitorFile(null);
  }, []);

  // Clear source monitor when active composition changes
  useEffect(() => {
    if (activeCompositionId && sourceMonitorFileId) {
      useMediaStore.getState().setSourceMonitorFile(null);
    }
  }, [activeCompositionId]);

  // Determine which composition this preview is showing
  const slotPreviewActive = source.type === 'activeComp' && previewCompositionId !== null;
  const renderSource = useMemo<PreviewPanelSource>(
    () => (
      slotPreviewActive && previewCompositionId
        ? { type: 'composition', compositionId: previewCompositionId }
        : source
    ),
    [source, slotPreviewActive, previewCompositionId],
  );
  const renderSourceKey = useMemo(() => {
    switch (renderSource.type) {
      case 'activeComp':
        return 'activeComp';
      case 'composition':
        return `composition:${renderSource.compositionId}`;
      case 'layer-index':
        return `layer-index:${renderSource.compositionId ?? 'active'}:${renderSource.layerIndex}`;
    }
  }, [renderSource.type, renderSource.type === 'composition' ? renderSource.compositionId : null, renderSource.type === 'layer-index' ? renderSource.compositionId : null, renderSource.type === 'layer-index' ? renderSource.layerIndex : null]);
  const stableRenderSource = useMemo(() => renderSource, [renderSourceKey]);
  const displayedCompId = resolvePreviewSourceCompositionId(renderSource, activeCompositionId);
  const displayedComp = compositions.find(c => c.id === displayedCompId);
  const isEditableSource =
    renderSource.type === 'activeComp' ||
    (renderSource.type === 'composition' && renderSource.compositionId === activeCompositionId);

  // Engine resolution = active composition dimensions (fallback to settingsStore default)
  const effectiveResolution = displayedComp
    ? { width: displayedComp.width, height: displayedComp.height }
    : useSettingsStore.getState().outputResolution;

  const setPanelSource = useCallback(
    (nextSource: PreviewPanelSource) => {
      updatePanelData(panelId, createPreviewPanelDataPatch(nextSource, { showTransparencyGrid }));
    },
    [panelId, showTransparencyGrid, updatePanelData],
  );

  const toggleTransparency = useCallback(() => {
    updatePanelData(
      panelId,
      createPreviewPanelDataPatch(source, { showTransparencyGrid: !showTransparencyGrid }),
    );
  }, [panelId, showTransparencyGrid, source, updatePanelData]);

  // Unified RenderTarget registration
  useEffect(() => {
    if (!isEngineReady || !canvasRef.current) return;

    const isIndependent = stableRenderSource.type !== 'activeComp';

    log.debug(`[${panelId}] Registering render target`, { source: stableRenderSource, isIndependent });

    const gpuContext = engine.registerTargetCanvas(panelId, canvasRef.current);
    if (!gpuContext) return;

    useRenderTargetStore.getState().registerTarget({
      id: panelId,
      name: 'Preview',
      source: stableRenderSource,
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid,
      canvas: canvasRef.current,
      context: gpuContext,
      window: null,
      isFullscreen: false,
    });

    if (isIndependent) {
      renderScheduler.register(panelId);
      setCompReady(true);
    }

    return () => {
      log.debug(`[${panelId}] Unregistering render target`);
      if (isIndependent) {
        renderScheduler.unregister(panelId);
      }
      useRenderTargetStore.getState().unregisterTarget(panelId);
      engine.unregisterTargetCanvas(panelId);
    };
  }, [isEngineReady, panelId, stableRenderSource, showTransparencyGrid]);

  // Sync per-tab transparency grid flag
  useEffect(() => {
    if (!isEngineReady) return;
    useRenderTargetStore.getState().setTargetTransparencyGrid(panelId, showTransparencyGrid);
    engine.requestRender();
  }, [isEngineReady, panelId, showTransparencyGrid]);

  // Composition selector state
  const [selectorOpen, setSelectorOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // Quality selector state
  const [qualityOpen, setQualityOpen] = useState(false);
  const qualityDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!selectorOpen && !qualityOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (selectorOpen && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setSelectorOpen(false);
      }
      if (qualityOpen && qualityDropdownRef.current && !qualityDropdownRef.current.contains(target)) {
        setQualityOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectorOpen, qualityOpen]);

  // Adjust dropdown position when opened
  useEffect(() => {
    if (selectorOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const style: React.CSSProperties = {};

      if (rect.left < 8) {
        style.left = '0';
        style.right = 'auto';
      }
      if (rect.right > window.innerWidth - 8) {
        style.right = '0';
        style.left = 'auto';
      }
      if (rect.bottom > window.innerHeight - 8) {
        style.bottom = '100%';
        style.top = 'auto';
        style.marginTop = '0';
        style.marginBottom = '4px';
      }

      setDropdownStyle(style);
    } else {
      setDropdownStyle({});
    }
  }, [selectorOpen]);

  // Stats overlay state
  const [statsExpanded, setStatsExpanded] = useState(false);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isGaussianOrbiting, setIsGaussianOrbiting] = useState(false);
  const [isGaussianPanning, setIsGaussianPanning] = useState(false);
  const [isGaussianFpsLooking, setIsGaussianFpsLooking] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const gaussianOrbitStart = useRef({
    clipId: null as string | null,
    x: 0,
    y: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
  });
  const gaussianPanStart = useRef({
    clipId: null as string | null,
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
    panZ: 0,
    zoom: 1,
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

  useEffect(() => {
    if (!isEditableSource) {
      setEditMode(false);
    }
  }, [isEditableSource]);

  const selectedClip = useMemo(
    () => (selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null),
    [clips, selectedClipId],
  );

  const selectedCameraNavClip = useMemo(
    () => {
      if (!selectedClip?.source) return null;

      if (selectedClip.source.type === 'camera') {
        return selectedClip;
      }

      if (selectedClip.source.type !== 'gaussian-splat') {
        return null;
      }

      const useNativeRenderer =
        selectedClip.source.gaussianSplatSettings?.render.useNativeRenderer ??
        DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.useNativeRenderer;

      return useNativeRenderer ? selectedClip : null;
    },
    [selectedClip],
  );

  // Read fresh nav transform at call-site to avoid stale closure after keyframe edits.
  const getFreshCameraNavTransform = useCallback((clip: typeof selectedCameraNavClip) => {
    if (!clip) return null;
    const { playheadPosition: ph, getInterpolatedTransform } = useTimelineStore.getState();
    const clipLocalTime = ph - clip.startTime;
    return getInterpolatedTransform(clip.id, clipLocalTime);
  }, []);

  const gaussianNavEnabled = Boolean(
    isEditableSource &&
    !editMode &&
    selectedCameraNavClip &&
    gaussianSplatNavClipId === selectedCameraNavClip.id,
  );

  const getGaussianPointerLockTarget = useCallback(() => {
    return canvasWrapperRef.current ?? containerRef.current;
  }, []);

  const isCanvasInteractionTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    return Boolean(
      canvasRef.current?.contains(target) ||
      canvasWrapperRef.current?.contains(target),
    );
  }, []);

  const endGaussianWheelBatch = useCallback(() => {
    if (gaussianWheelBatchTimerRef.current === null) return;
    window.clearTimeout(gaussianWheelBatchTimerRef.current);
    gaussianWheelBatchTimerRef.current = null;
    endBatch();
  }, []);

  const applyGaussianCameraValues = useCallback((clipId: string, values: {
    positionX?: number;
    positionY?: number;
    scale?: number;
    forwardOffset?: number;
    rotationX?: number;
    rotationY?: number;
  }) => {
    const propertyUpdates: Array<readonly [property: 'position.x' | 'position.y' | 'scale.x' | 'scale.y' | 'scale.z' | 'rotation.x' | 'rotation.y', value: number]> = [];

    if (values.positionX !== undefined) {
      propertyUpdates.push(['position.x', values.positionX]);
    }
    if (values.positionY !== undefined) {
      propertyUpdates.push(['position.y', values.positionY]);
    }
    if (values.scale !== undefined) {
      propertyUpdates.push(['scale.x', values.scale], ['scale.y', values.scale]);
    }
    if (values.forwardOffset !== undefined) {
      propertyUpdates.push(['scale.z', values.forwardOffset]);
    }
    if (values.rotationX !== undefined) {
      propertyUpdates.push(['rotation.x', values.rotationX]);
    }
    if (values.rotationY !== undefined) {
      propertyUpdates.push(['rotation.y', values.rotationY]);
    }

    const needsKeyframePath = propertyUpdates.some(([property]) =>
      hasKeyframes(clipId, property) || isRecording(clipId, property),
    );

    if (needsKeyframePath) {
      for (const [property, value] of propertyUpdates) {
        setPropertyValue(clipId, property, value);
      }
    } else {
      const currentClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
      const currentTransform = currentClip?.transform;
      const nextScale = values.scale !== undefined || values.forwardOffset !== undefined
        ? {
            x: values.scale ?? currentTransform?.scale.x ?? 1,
            y: values.scale ?? currentTransform?.scale.y ?? 1,
            ...(values.forwardOffset !== undefined || currentTransform?.scale.z !== undefined
              ? { z: values.forwardOffset ?? currentTransform?.scale.z ?? 0 }
              : {}),
          }
        : undefined;
      updateClipTransform(clipId, {
        ...(values.positionX !== undefined || values.positionY !== undefined
          ? {
              position: {
                x: values.positionX ?? currentTransform?.position.x ?? 0,
                y: values.positionY ?? currentTransform?.position.y ?? 0,
                z: currentTransform?.position.z ?? 0,
              },
            }
          : {}),
        ...(nextScale ? { scale: nextScale } : {}),
        ...(values.rotationX !== undefined || values.rotationY !== undefined
          ? {
              rotation: {
                x: values.rotationX ?? currentTransform?.rotation.x ?? 0,
                y: values.rotationY ?? currentTransform?.rotation.y ?? 0,
                z: currentTransform?.rotation.z ?? 0,
              },
            }
          : {}),
      });
    }

    engine.requestRender();
  }, [hasKeyframes, isRecording, setPropertyValue, updateClipTransform]);

  const scheduleGaussianWheelBatchEnd = useCallback(() => {
    if (gaussianWheelBatchTimerRef.current === null) {
      startBatch('Gaussian zoom');
    } else {
      window.clearTimeout(gaussianWheelBatchTimerRef.current);
    }
    gaussianWheelBatchTimerRef.current = window.setTimeout(() => {
      gaussianWheelBatchTimerRef.current = null;
      endBatch();
    }, 180);
  }, []);

  const getCameraNavSolveSettings = useCallback((clip: typeof selectedCameraNavClip) => {
    if (!clip?.source) return null;

    if (clip.source.type === 'camera') {
      const cameraSettings = clip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
      return {
        settings: {
          nearPlane: cameraSettings.near,
          farPlane: cameraSettings.far,
          fov: cameraSettings.fov,
          minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
        },
        sceneBounds: undefined,
      };
    }

    if (clip.source.type === 'gaussian-splat') {
      const renderSettings = clip.source.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
      return {
        settings: {
          nearPlane: renderSettings.nearPlane,
          farPlane: renderSettings.farPlane,
          fov: DEFAULT_NATIVE_GAUSSIAN_CAMERA_FOV,
          minimumDistance: DEFAULT_NATIVE_GAUSSIAN_MIN_DISTANCE,
        },
        sceneBounds: engine.getGaussianSplatSceneBounds(clip.id),
      };
    }

    return null;
  }, []);

  const finishGaussianKeyboardBatch = useCallback(() => {
    if (!gaussianKeyboardBatchActiveRef.current) return;
    gaussianKeyboardBatchActiveRef.current = false;
    endBatch();
  }, []);

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
      const pointerLockTarget = getGaussianPointerLockTarget();
      if (pointerLockTarget && document.pointerLockElement === pointerLockTarget) {
        document.exitPointerLock();
      }
    }

    if (activeClipId) {
      endBatch();
    }
  }, [getGaussianPointerLockTarget]);

  const tickGaussianKeyboardMovement = useCallback((timestamp: number) => {
    gaussianKeyboardFrameRef.current = null;

    if (!gaussianNavEnabled || !selectedCameraNavClip || document.activeElement !== containerRef.current) {
      stopGaussianKeyboardMovement();
      return;
    }

    const activeCodes = gaussianKeyboardMoveCodesRef.current;
    if (activeCodes.size === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
      return;
    }

    const dt = gaussianKeyboardLastTimeRef.current === null
      ? 1 / 60
      : Math.min(0.05, (timestamp - gaussianKeyboardLastTimeRef.current) / 1000);
    gaussianKeyboardLastTimeRef.current = timestamp;

    const freshTransform = getFreshCameraNavTransform(selectedCameraNavClip);
    if (!freshTransform) {
      stopGaussianKeyboardMovement();
      return;
    }

    const rightInput = (activeCodes.has('KeyD') ? 1 : 0) - (activeCodes.has('KeyA') ? 1 : 0);
    const upInput = (activeCodes.has('KeyE') ? 1 : 0) - (activeCodes.has('KeyQ') ? 1 : 0);
    const forwardInput = (activeCodes.has('KeyW') ? 1 : 0) - (activeCodes.has('KeyS') ? 1 : 0);

    if (rightInput === 0 && upInput === 0 && forwardInput === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
      return;
    }

    const zoom = Math.max(0.01, freshTransform.scale.x || 1);
    const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
    const clipSource = selectedCameraNavClip.source;
    const fovDegrees = clipSource?.type === 'camera'
      ? clipSource.cameraSettings?.fov ?? DEFAULT_SCENE_CAMERA_SETTINGS.fov
      : DEFAULT_NATIVE_GAUSSIAN_CAMERA_FOV;
    const minimumDistance = clipSource?.type === 'camera'
      ? getSharedSceneDefaultCameraDistance(fovDegrees)
      : DEFAULT_NATIVE_GAUSSIAN_MIN_DISTANCE;
    const baseDistance = freshTransform.position.z !== 0 ? Math.abs(freshTransform.position.z) : minimumDistance;
    const currentDistance = baseDistance / zoom;
    const panStep = 0.9 * zoomDamping * dt;
    const forwardStep = Math.max(0.15, currentDistance * 0.85) * dt;

    applyGaussianCameraValues(selectedCameraNavClip.id, {
      ...(rightInput !== 0 ? { positionX: freshTransform.position.x + rightInput * panStep } : {}),
      ...(upInput !== 0 ? { positionY: freshTransform.position.y + upInput * panStep } : {}),
      ...(forwardInput !== 0
        ? { forwardOffset: getCameraNavForwardOffset(freshTransform.scale.z) + forwardInput * forwardStep }
        : {}),
    });

    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [
    applyGaussianCameraValues,
    finishGaussianKeyboardBatch,
    gaussianNavEnabled,
    getFreshCameraNavTransform,
    selectedCameraNavClip,
    stopGaussianKeyboardLoop,
    stopGaussianKeyboardMovement,
  ]);

  const startGaussianKeyboardMovement = useCallback(() => {
    if (gaussianKeyboardFrameRef.current !== null) return;
    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [tickGaussianKeyboardMovement]);

  const handleGaussianNavKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!gaussianNavEnabled || !selectedCameraNavClip) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!isCameraNavMoveCode(e.code)) return;

    e.preventDefault();

    if (!gaussianKeyboardBatchActiveRef.current) {
      startBatch('Gaussian move');
      gaussianKeyboardBatchActiveRef.current = true;
    }

    gaussianKeyboardMoveCodesRef.current.add(e.code);
    startGaussianKeyboardMovement();
  }, [gaussianNavEnabled, selectedCameraNavClip, startGaussianKeyboardMovement]);

  const handleGaussianNavKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isCameraNavMoveCode(e.code)) return;

    e.preventDefault();
    gaussianKeyboardMoveCodesRef.current.delete(e.code);

    if (gaussianKeyboardMoveCodesRef.current.size === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
    }
  }, [finishGaussianKeyboardBatch, stopGaussianKeyboardLoop]);

  const handleGaussianNavBlur = useCallback(() => {
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
  }, [stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    return () => {
      if (gaussianWheelBatchTimerRef.current !== null) {
        window.clearTimeout(gaussianWheelBatchTimerRef.current);
        gaussianWheelBatchTimerRef.current = null;
        endBatch();
      }
      if (gaussianOrbitStart.current.clipId) {
        gaussianOrbitStart.current.clipId = null;
        endBatch();
      }
      if (gaussianPanStart.current.clipId) {
        gaussianPanStart.current.clipId = null;
        endBatch();
      }
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
    };
  }, [stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (gaussianNavEnabled) return;
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    if (isGaussianOrbiting) {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endBatch();
    }
    if (isGaussianPanning) {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endBatch();
    }
  }, [gaussianNavEnabled, isGaussianOrbiting, isGaussianPanning, stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (gaussianSplatNavFpsMode) {
      if (isGaussianOrbiting) {
        gaussianOrbitStart.current.clipId = null;
        setIsGaussianOrbiting(false);
        endBatch();
      }
      return;
    }

    if (isGaussianFpsLooking) {
      stopGaussianFpsLook();
    }
  }, [gaussianSplatNavFpsMode, isGaussianFpsLooking, isGaussianOrbiting, stopGaussianFpsLook]);

  useEffect(() => {
    if (!isGaussianOrbiting) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y, pitch, yaw } = gaussianOrbitStart.current;
      if (!clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const nextPitch = pitch + dy * 0.25;
      const nextYaw = yaw - dx * 0.25;

      applyGaussianCameraValues(clipId, {
        rotationX: nextPitch,
        rotationY: nextYaw,
      });
    };

    const finishGaussianOrbit = () => {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianOrbit);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianOrbit);
    };
  }, [applyGaussianCameraValues, isGaussianOrbiting]);

  useEffect(() => {
    if (!isGaussianFpsLooking || !selectedCameraNavClip) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y } = gaussianFpsLookStart.current;
      if (!clipId) return;

      const freshTransform = getFreshCameraNavTransform(selectedCameraNavClip);
      const solveSettings = getCameraNavSolveSettings(selectedCameraNavClip);
      if (!freshTransform || !solveSettings) return;

      const pointerLockTarget = getGaussianPointerLockTarget();
      const pointerLockActive = pointerLockTarget !== null && document.pointerLockElement === pointerLockTarget;
      const deltaX = pointerLockActive ? e.movementX : e.clientX - x;
      const deltaY = pointerLockActive ? e.movementY : e.clientY - y;

      if (!pointerLockActive) {
        gaussianFpsLookStart.current.x = e.clientX;
        gaussianFpsLookStart.current.y = e.clientY;
      }

      if (deltaX === 0 && deltaY === 0) return;

      const nextPitch = Math.max(
        -CAMERA_NAV_FPS_PITCH_LIMIT,
        Math.min(CAMERA_NAV_FPS_PITCH_LIMIT, freshTransform.rotation.x + deltaY * CAMERA_NAV_FPS_LOOK_SPEED),
      );
      const nextYaw = freshTransform.rotation.y - deltaX * CAMERA_NAV_FPS_LOOK_SPEED;
      const nextTranslation = resolveOrbitCameraTranslationForFixedEye(
        freshTransform,
        {
          x: nextPitch,
          y: nextYaw,
          z: freshTransform.rotation.z,
        },
        solveSettings.settings,
        { width: effectiveResolution.width, height: effectiveResolution.height },
        solveSettings.sceneBounds,
      );

      applyGaussianCameraValues(clipId, {
        positionX: nextTranslation.positionX,
        positionY: nextTranslation.positionY,
        forwardOffset: nextTranslation.forwardOffset,
        rotationX: nextPitch,
        rotationY: nextYaw,
      });
    };

    const finishGaussianFpsLook = () => {
      stopGaussianFpsLook();
    };

    const handlePointerLockChange = () => {
      const pointerLockTarget = getGaussianPointerLockTarget();
      const pointerLockActive = pointerLockTarget !== null && document.pointerLockElement === pointerLockTarget;
      if (!pointerLockActive && gaussianFpsLookStart.current.clipId) {
        stopGaussianFpsLook(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianFpsLook);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianFpsLook);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [
    applyGaussianCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    getCameraNavSolveSettings,
    getFreshCameraNavTransform,
    getGaussianPointerLockTarget,
    isGaussianFpsLooking,
    selectedCameraNavClip,
    stopGaussianFpsLook,
  ]);

  useEffect(() => {
    if (!isGaussianPanning) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y, panX, panY, zoom } = gaussianPanStart.current;
      if (!clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
      const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
      const panScaleY = (2 / Math.max(1, effectiveResolution.height)) * zoomDamping;
      const nextPanX = panX - dx * panScaleX;
      const nextPanY = panY + dy * panScaleY;

      applyGaussianCameraValues(clipId, {
        positionX: nextPanX,
        positionY: nextPanY,
      });
    };

    const finishGaussianPan = () => {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianPan);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianPan);
    };
  }, [applyGaussianCameraValues, effectiveResolution.height, effectiveResolution.width, isGaussianPanning]);

  // Sync layer selection when clip is selected in timeline (for edit mode)
  useEffect(() => {
    if (!selectedClipId || !editMode) return;

    const clip = clips.find(c => c.id === selectedClipId);
    if (clip) {
      const layer = layers.find(l => l?.name === clip.name);
      if (layer && layer.id !== selectedLayerId) {
        selectLayer(layer.id);
      }
    }
  }, [selectedClipId, editMode, clips, layers, selectedLayerId, selectLayer]);

  // Calculate canvas size to fit container while maintaining aspect ratio
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      setContainerSize({ width: containerWidth, height: containerHeight });

      const videoAspect = effectiveResolution.width / effectiveResolution.height;
      const containerAspect = containerWidth / containerHeight;

      let width: number;
      let height: number;

      if (containerAspect > videoAspect) {
        height = containerHeight;
        width = height * videoAspect;
      } else {
        width = containerWidth;
        height = width / videoAspect;
      }

      setCanvasSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [effectiveResolution.width, effectiveResolution.height]);

  // Handle zoom with scroll wheel in edit mode
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (gaussianNavEnabled && selectedCameraNavClip && isCanvasInteractionTarget(e.target)) {
      const freshTransform = getFreshCameraNavTransform(selectedCameraNavClip);
      if (!freshTransform) return;

      e.preventDefault();
      scheduleGaussianWheelBatchEnd();

      const currentZoom = Math.max(0.05, freshTransform.scale.x || 1);
      const zoomFactor = Math.exp(-e.deltaY * 0.0025);
      const nextZoom = Math.max(0.05, Math.min(40, currentZoom * zoomFactor));

      applyGaussianCameraValues(selectedCameraNavClip.id, {
        scale: nextZoom,
      });
      return;
    }

    if (!editMode || !containerRef.current) return;

    e.preventDefault();

    if (e.altKey) {
      setViewPan(prev => ({
        x: prev.x - e.deltaY,
        y: prev.y
      }));
    } else {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(150, viewZoom * zoomFactor));

      const containerCenterX = containerSize.width / 2;
      const containerCenterY = containerSize.height / 2;

      const worldX = (mouseX - containerCenterX - viewPan.x) / viewZoom;
      const worldY = (mouseY - containerCenterY - viewPan.y) / viewZoom;

      const newPanX = mouseX - worldX * newZoom - containerCenterX;
      const newPanY = mouseY - worldY * newZoom - containerCenterY;

      setViewZoom(newZoom);
      setViewPan({ x: newPanX, y: newPanY });
    }
  }, [
    containerSize,
    editMode,
    gaussianNavEnabled,
    getFreshCameraNavTransform,
    isCanvasInteractionTarget,
    scheduleGaussianWheelBatchEnd,
    applyGaussianCameraValues,
    selectedCameraNavClip,
    viewPan,
    viewZoom,
  ]);

  // Tab key to toggle edit mode (via shortcut registry)
  useShortcut('preview.editMode', () => {
    setEditMode(prev => !prev);
  }, { enabled: isEditableSource });

  // Handle gaussian nav and edit-mode panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (gaussianNavEnabled && selectedCameraNavClip && isCanvasInteractionTarget(e.target)) {
      containerRef.current?.focus({ preventScroll: true });
      const freshTransform = getFreshCameraNavTransform(selectedCameraNavClip);
      if (!freshTransform) return;

      if (e.button === 0) {
        if (e.shiftKey) {
          e.preventDefault();
          endGaussianWheelBatch();
          startBatch('Gaussian pan');
          gaussianPanStart.current = {
            clipId: selectedCameraNavClip.id,
            x: e.clientX,
            y: e.clientY,
            panX: freshTransform.position.x,
            panY: freshTransform.position.y,
            panZ: freshTransform.position.z,
            zoom: freshTransform.scale.x || 1,
          };
          setIsGaussianPanning(true);
          return;
        }
        e.preventDefault();
        endGaussianWheelBatch();
        if (gaussianSplatNavFpsMode) {
          startBatch('Gaussian look');
          gaussianFpsLookStart.current = {
            clipId: selectedCameraNavClip.id,
            x: e.clientX,
            y: e.clientY,
          };
          getGaussianPointerLockTarget()?.requestPointerLock?.();
          setIsGaussianFpsLooking(true);
        } else {
          startBatch('Gaussian orbit');
          gaussianOrbitStart.current = {
            clipId: selectedCameraNavClip.id,
            x: e.clientX,
            y: e.clientY,
            pitch: freshTransform.rotation.x,
            yaw: freshTransform.rotation.y,
            roll: freshTransform.rotation.z,
          };
          setIsGaussianOrbiting(true);
        }
        return;
      }

      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        endGaussianWheelBatch();
        startBatch('Gaussian pan');
        gaussianPanStart.current = {
          clipId: selectedCameraNavClip.id,
          x: e.clientX,
          y: e.clientY,
          panX: freshTransform.position.x,
          panY: freshTransform.position.y,
          panZ: freshTransform.position.z,
          zoom: freshTransform.scale.x || 1,
        };
        setIsGaussianPanning(true);
        return;
      }
    }

    if (!editMode) return;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewPan.x,
        panY: viewPan.y
      };
    }
  }, [
    editMode,
    endGaussianWheelBatch,
    gaussianNavEnabled,
    gaussianSplatNavFpsMode,
    getFreshCameraNavTransform,
    getGaussianPointerLockTarget,
    isCanvasInteractionTarget,
    selectedCameraNavClip,
    viewPan,
  ]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setViewPan({
        x: panStart.current.panX + dx,
        y: panStart.current.panY + dy
      });
    }
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (gaussianNavEnabled && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [gaussianNavEnabled, isCanvasInteractionTarget]);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (gaussianNavEnabled && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [gaussianNavEnabled, isCanvasInteractionTarget]);

  // Reset view
  const resetView = useCallback(() => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }, []);

  // Calculate canvas position within container (for full-container overlay)
  const canvasInContainer = useMemo(() => {
    const scaledWidth = canvasSize.width * viewZoom;
    const scaledHeight = canvasSize.height * viewZoom;

    const centerX = (containerSize.width - scaledWidth) / 2;
    const centerY = (containerSize.height - scaledHeight) / 2;

    return {
      x: centerX + viewPan.x,
      y: centerY + viewPan.y,
      width: scaledWidth,
      height: scaledHeight,
    };
  }, [containerSize, canvasSize, viewZoom, viewPan]);

  // Edit mode helpers (bounding box calculation, hit testing, cursor mapping)
  const { calculateLayerBounds, findLayerAtPosition, findHandleAtPosition, getCursorForHandle } =
    useEditModeOverlay({ effectiveResolution, canvasSize, canvasInContainer, viewZoom, layers });

  // Layer drag logic (move/scale, overlay drawing, document-level listeners)
  const { isDragging, dragMode, dragHandle, hoverHandle, handleOverlayMouseDown, handleOverlayMouseMove, handleOverlayMouseUp } =
    useLayerDrag({
      editMode, overlayRef, canvasSize, canvasInContainer, viewZoom,
      layers, clips, selectedLayerId, selectedClipId,
      selectClip, selectLayer, updateClipTransform, updateLayer,
      calculateLayerBounds, findLayerAtPosition, findHandleAtPosition,
    });

  // Calculate transform for zoomed/panned view
  const viewTransform = editMode ? {
    transform: `scale(${viewZoom}) translate(${viewPan.x / viewZoom}px, ${viewPan.y / viewZoom}px)`,
  } : {};

  return (
    <div
      className="preview-container"
      ref={containerRef}
      onWheelCapture={handleWheel}
      onMouseDownCapture={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onAuxClick={handleAuxClick}
      onKeyDownCapture={handleGaussianNavKeyDown}
      onKeyUpCapture={handleGaussianNavKeyUp}
      onBlur={handleGaussianNavBlur}
      tabIndex={0}
      style={{
        cursor: isGaussianOrbiting || isGaussianPanning
          ? 'grabbing'
          : isGaussianFpsLooking
            ? 'crosshair'
          : isPanning
            ? 'grabbing'
            : gaussianNavEnabled
              ? (gaussianSplatNavFpsMode ? 'crosshair' : 'grab')
              : editMode
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
        setEditMode={setEditMode}
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
        panelId={panelId}
        addPreviewPanel={addPreviewPanel}
        closePanelById={closePanelById}
      />

      {/* Source monitor overlay - shown on top when active */}
      {sourceMonitorActive && (
        <SourceMonitor file={sourceMonitorFile!} onClose={closeSourceMonitor} />
      )}

      {/* Engine canvas + overlays - always in DOM to keep WebGPU registration alive */}
      <div style={{ display: sourceMonitorActive ? 'none' : 'contents' }}>
        <StatsOverlay
          stats={engineStats}
          resolution={effectiveResolution}
          expanded={statsExpanded}
          onToggle={() => setStatsExpanded(!statsExpanded)}
        />

        <div
          ref={canvasWrapperRef}
          className={`preview-canvas-wrapper ${showTransparencyGrid ? 'show-transparency-grid' : ''}`}
          style={viewTransform}
        >
          {engineInitFailed ? (
            <div className="loading">
              <p style={{ color: '#ff6b6b', fontWeight: 'bold', marginBottom: 8 }}>WebGPU Initialization Failed</p>
              <p style={{ fontSize: '0.85em', opacity: 0.8, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>
                {engineInitError || 'Unknown error'}
              </p>
              <p style={{ fontSize: '0.75em', opacity: 0.5, marginTop: 12 }}>
                Try: chrome://flags → #enable-unsafe-webgpu → Enabled
              </p>
            </div>
          ) : !isEngineReady ? (
            <div className="loading">
              <div className="loading-spinner" />
              <p>Initializing WebGPU...</p>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={effectiveResolution.width}
                height={effectiveResolution.height}
                className="preview-canvas"
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height,
                }}
              />
              {isEditableSource && maskEditMode !== 'none' && (
                <MaskOverlay
                  canvasWidth={effectiveResolution.width}
                  canvasHeight={effectiveResolution.height}
                />
              )}
              {isEditableSource && sam2Active && (
                <SAM2Overlay
                  canvasWidth={effectiveResolution.width}
                  canvasHeight={effectiveResolution.height}
                />
              )}
            </>
          )}
        </div>

        {/* Edit mode overlay - covers full container for pasteboard support */}
        {editMode && isEngineReady && (
          <canvas
            ref={overlayRef}
            width={containerSize.width || 100}
            height={containerSize.height || 100}
            className="preview-overlay-fullscreen"
            onMouseDown={handleOverlayMouseDown}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={handleOverlayMouseUp}
            onMouseLeave={handleOverlayMouseUp}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: containerSize.width || '100%',
              height: containerSize.height || '100%',
              cursor: isDragging
                ? (dragMode === 'scale' ? getCursorForHandle(dragHandle) : 'grabbing')
                : getCursorForHandle(hoverHandle),
              pointerEvents: 'auto',
            }}
          />
        )}

        {editMode && isEditableSource && (
          <div className="preview-edit-hint">
            Drag: Move | Handles: Scale (Shift: Lock Ratio) | Scroll: Zoom | Alt+Drag: Pan
          </div>
        )}
        {gaussianNavEnabled && (
          <div className="preview-edit-hint">
            {selectedCameraNavClip?.source?.type === 'camera'
              ? (
                  gaussianSplatNavFpsMode
                    ? 'Scene Camera Nav: click preview, hold LMB to look, WASD move, Q/E up-down, MMB/RMB/Shift+LMB pan, wheel zoom'
                    : 'Scene Camera Nav: click preview, WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel zoom'
                )
              : (
                  gaussianSplatNavFpsMode
                    ? 'Gaussian Nav: click preview, hold LMB to look, WASD move, Q/E up-down, MMB/RMB/Shift+LMB pan, wheel zoom'
                    : 'Gaussian Nav: click preview, WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel zoom'
                )}
          </div>
        )}

        {/* Bottom-left controls */}
        <PreviewBottomControls
          showTransparencyGrid={showTransparencyGrid}
          onToggleTransparency={toggleTransparency}
          previewQuality={previewQuality}
          setPreviewQuality={setPreviewQuality}
          qualityOpen={qualityOpen}
          setQualityOpen={setQualityOpen}
          qualityDropdownRef={qualityDropdownRef}
        />
      </div>
    </div>
  );
}
