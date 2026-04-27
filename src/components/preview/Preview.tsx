// Preview canvas component with After Effects-style editing overlay

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Logger } from '../../services/logger';

const log = Logger.create('Preview');
import { useEngine } from '../../hooks/useEngine';
import { useShortcut } from '../../hooks/useShortcut';
import {
  selectActiveGaussianSplatLoadProgress,
  selectSceneNavClipId,
  selectSceneNavFpsMode,
  selectSceneNavFpsMoveSpeed,
  stepSceneNavFpsMoveSpeed,
  useEngineStore,
} from '../../stores/engineStore';
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
import { SceneObjectOverlay } from './SceneObjectOverlay';
import { useEditModeOverlay } from './useEditModeOverlay';
import { useLayerDrag } from './useLayerDrag';
import { useSAM2Store } from '../../stores/sam2Store';
import { renderScheduler } from '../../services/renderScheduler';
import { engine } from '../../engine/WebGPUEngine';
import {
  resolveOrbitCameraPose,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../engine/gaussian/core/SplatCameraUtils';
import { resolveSharedSceneCameraConfig } from '../../engine/scene/SceneCameraUtils';
import type { SceneCameraConfig, SceneViewport } from '../../engine/scene/types';
import type { ClipTransform, TimelineClip, TimelineTrack } from '../../types';
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

const CAMERA_NAV_FPS_LOOK_SPEED = 0.18;
const EDIT_CAMERA_BLEND_MS = 320;
const TIMELINE_TIME_EPSILON = 1e-4;

function cloneClipTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function cloneSceneCameraConfig(config: SceneCameraConfig): SceneCameraConfig {
  return {
    ...config,
    position: { ...config.position },
    target: { ...config.target },
    up: { ...config.up },
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpSceneCameraConfig(from: SceneCameraConfig, to: SceneCameraConfig, t: number): SceneCameraConfig {
  return {
    position: {
      x: lerpNumber(from.position.x, to.position.x, t),
      y: lerpNumber(from.position.y, to.position.y, t),
      z: lerpNumber(from.position.z, to.position.z, t),
    },
    target: {
      x: lerpNumber(from.target.x, to.target.x, t),
      y: lerpNumber(from.target.y, to.target.y, t),
      z: lerpNumber(from.target.z, to.target.z, t),
    },
    up: {
      x: lerpNumber(from.up.x, to.up.x, t),
      y: lerpNumber(from.up.y, to.up.y, t),
      z: lerpNumber(from.up.z, to.up.z, t),
    },
    fov: lerpNumber(from.fov, to.fov, t),
    near: lerpNumber(from.near, to.near, t),
    far: lerpNumber(from.far, to.far, t),
    applyDefaultDistance: false,
  };
}

function findActiveCameraClipAtTime(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineTime: number,
): TimelineClip | null {
  const trackById = new Map(tracks.map((track, index) => [track.id, { track, index }]));
  const activeCameraClips = clips
    .filter((clip) => {
      const trackInfo = trackById.get(clip.trackId);
      if (trackInfo?.track.type === 'audio') return false;
      return (
        clip.source?.type === 'camera' &&
        timelineTime >= clip.startTime - TIMELINE_TIME_EPSILON &&
        timelineTime < clip.startTime + clip.duration + TIMELINE_TIME_EPSILON
      );
    })
    .toSorted((a, b) => (trackById.get(b.trackId)?.index ?? -1) - (trackById.get(a.trackId)?.index ?? -1));

  return (
    activeCameraClips.find((clip) => trackById.get(clip.trackId)?.track.visible !== false) ??
    activeCameraClips[0] ??
    null
  );
}

function buildPreviewCameraConfigFromTransform(
  clip: TimelineClip,
  transform: ClipTransform,
  viewport: SceneViewport,
): SceneCameraConfig | null {
  if (clip.source?.type !== 'camera') return null;

  const cameraSettings = clip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
  const pose = resolveOrbitCameraPose(
    {
      position: transform.position,
      scale: transform.scale,
      rotation: transform.rotation,
    },
    {
      nearPlane: cameraSettings.near,
      farPlane: cameraSettings.far,
      fov: cameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
    },
    viewport,
  );

  return {
    position: pose.eye,
    target: pose.target,
    up: pose.up,
    fov: pose.fovDegrees,
    near: pose.near,
    far: pose.far,
    applyDefaultDistance: false,
  };
}

function formatSplatLoadPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, percent)) * 100);
}

function getSplatLoadPhaseLabel(phase: string): string {
  switch (phase) {
    case 'fetching':
      return 'Fetching splat';
    case 'reading':
      return 'Reading splat';
    case 'parsing':
      return 'Parsing splat';
    case 'normalizing':
      return 'Preparing splat';
    case 'uploading':
      return 'Uploading splat';
    case 'complete':
      return 'Splat loaded';
    case 'error':
      return 'Splat load failed';
    default:
      return 'Loading splat';
  }
}

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
  const sceneNavClipId = useEngineStore(selectSceneNavClipId);
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const previewCameraOverride = useEngineStore((s) => s.previewCameraOverride);
  const setPreviewCameraOverride = useEngineStore((s) => s.setPreviewCameraOverride);
  const setSceneGizmoClipIdOverride = useEngineStore((s) => s.setSceneGizmoClipIdOverride);
  const activeSplatLoadProgress = useEngineStore(selectActiveGaussianSplatLoadProgress);
  const setSceneNavFpsMoveSpeed = useEngineStore((s) => s.setSceneNavFpsMoveSpeed);
  const { clips, selectedClipIds, primarySelectedClipId, selectClip, updateClipTransform, maskEditMode, layers, selectedLayerId, selectLayer, updateLayer, tracks, isPlaying, playheadPosition } = useTimelineStore(useShallow(s => ({
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
    isPlaying: s.isPlaying,
    playheadPosition: s.playheadPosition,
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
  const sourceMonitorPlaybackRequestId = useMediaStore(state => state.sourceMonitorPlaybackRequestId);
  const sourceMonitorFile = useMediaStore(state =>
    state.sourceMonitorFileId ? state.files.find(f => f.id === state.sourceMonitorFileId) ?? null : null
  );
  const previousActiveCompositionIdRef = useRef(activeCompositionId);
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
    const previousActiveCompositionId = previousActiveCompositionIdRef.current;
    if (previousActiveCompositionId !== activeCompositionId) {
      previousActiveCompositionIdRef.current = activeCompositionId;
      if (sourceMonitorFileId) {
        useMediaStore.getState().setSourceMonitorFile(null);
      }
    }
  }, [activeCompositionId, sourceMonitorFileId]);

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
  const renderSourceCompositionId =
    renderSource.type === 'composition' || renderSource.type === 'layer-index'
      ? renderSource.compositionId
      : null;
  const renderSourceLayerIndex =
    renderSource.type === 'layer-index'
      ? renderSource.layerIndex
      : null;
  const stableRenderSource = useMemo<PreviewPanelSource>(() => {
    switch (renderSource.type) {
      case 'activeComp':
        return { type: 'activeComp' };
      case 'composition':
        return { type: 'composition', compositionId: renderSourceCompositionId ?? activeCompositionId ?? '' };
      case 'layer-index':
        return {
          type: 'layer-index',
          compositionId: renderSourceCompositionId,
          layerIndex: renderSourceLayerIndex ?? 0,
        };
    }
  }, [activeCompositionId, renderSource.type, renderSourceCompositionId, renderSourceLayerIndex]);
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
  const [sceneGizmoToolbarTarget, setSceneGizmoToolbarTarget] = useState<HTMLDivElement | null>(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [sceneObjectOverlayEnabled, setSceneObjectOverlayEnabled] = useState(true);
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
  const sceneNavHistoryBatchActiveRef = useRef(false);
  const editCameraTransformRef = useRef<ClipTransform | null>(null);
  const editCameraClipIdRef = useRef<string | null>(null);
  const editCameraAnimationRef = useRef<number | null>(null);
  const editCameraModeActiveRef = useRef(false);

  useEffect(() => {
    if (!isEditableSource) {
      setEditMode(false);
    }
  }, [isEditableSource]);

  const selectedClip = useMemo(
    () => (selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null),
    [clips, selectedClipId],
  );

  const selectedSceneNavClip = useMemo(
    () => (selectedClip?.source?.type === 'camera' ? selectedClip : null),
    [selectedClip],
  );
  const activeCameraClipAtPlayhead = useMemo(
    () => findActiveCameraClipAtTime(clips, tracks, playheadPosition),
    [clips, playheadPosition, tracks],
  );
  const editCameraModeActive = Boolean(
    isEditableSource &&
    editMode &&
    activeCameraClipAtPlayhead,
  );
  const navigationSceneNavClip = editCameraModeActive
    ? activeCameraClipAtPlayhead
    : selectedSceneNavClip;

  // Read fresh scene-nav transform at call-site to avoid stale closure after keyframe edits.
  const getFreshSceneNavTransform = useCallback((clip: TimelineClip | null) => {
    if (!clip) return null;
    if (editCameraModeActive && editCameraTransformRef.current && clip.id === editCameraClipIdRef.current) {
      return cloneClipTransform(editCameraTransformRef.current);
    }
    const { playheadPosition: ph, getInterpolatedTransform } = useTimelineStore.getState();
    const clipLocalTime = ph - clip.startTime;
    return getInterpolatedTransform(clip.id, clipLocalTime);
  }, [editCameraModeActive]);

  const sceneNavEnabled = Boolean(
    isEditableSource &&
    navigationSceneNavClip &&
    (
      editCameraModeActive ||
      (!editMode && sceneNavClipId === navigationSceneNavClip.id)
    ),
  );
  const layerEditMode = editMode && !editCameraModeActive;
  const effectiveSceneNavFpsMode = sceneNavFpsMode && !editCameraModeActive;
  const editCameraClipSelected = Boolean(
    editCameraModeActive &&
    activeCameraClipAtPlayhead &&
    selectedClipIds.has(activeCameraClipAtPlayhead.id),
  );

  useEffect(() => {
    const overrideClipId = editCameraClipSelected ? activeCameraClipAtPlayhead?.id ?? null : null;
    setSceneGizmoClipIdOverride(overrideClipId);
    return () => {
      setSceneGizmoClipIdOverride(null);
    };
  }, [activeCameraClipAtPlayhead?.id, editCameraClipSelected, setSceneGizmoClipIdOverride]);

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

  const startSceneNavHistoryBatch = useCallback((label: string) => {
    if (editCameraModeActiveRef.current || sceneNavHistoryBatchActiveRef.current) return;
    startBatch(label);
    sceneNavHistoryBatchActiveRef.current = true;
  }, []);

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

  const applySceneCameraValues = useCallback((clipId: string, values: {
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

  const resolveCameraClipTransformAtPlayhead = useCallback((clip: TimelineClip): ClipTransform => {
    const { playheadPosition: ph, getInterpolatedTransform } = useTimelineStore.getState();
    return cloneClipTransform(getInterpolatedTransform(clip.id, ph - clip.startTime));
  }, []);

  const getActualSceneCameraConfig = useCallback((): SceneCameraConfig => {
    return resolveSharedSceneCameraConfig(
      { width: effectiveResolution.width, height: effectiveResolution.height },
      useTimelineStore.getState().playheadPosition,
      {
        clips: useTimelineStore.getState().clips,
        tracks: useTimelineStore.getState().tracks,
        clipKeyframes: useTimelineStore.getState().clipKeyframes,
        compositionId: displayedCompId,
        sceneNavClipId: null,
        previewCameraOverride: null,
      },
    );
  }, [displayedCompId, effectiveResolution.height, effectiveResolution.width]);

  const getEditSceneCameraConfig = useCallback((clip: TimelineClip | null = activeCameraClipAtPlayhead): SceneCameraConfig | null => {
    if (!clip || !editCameraTransformRef.current) return null;
    return buildPreviewCameraConfigFromTransform(
      clip,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
    );
  }, [activeCameraClipAtPlayhead, effectiveResolution.height, effectiveResolution.width]);

  const stopEditCameraAnimation = useCallback(() => {
    if (editCameraAnimationRef.current === null) return;
    window.cancelAnimationFrame(editCameraAnimationRef.current);
    editCameraAnimationRef.current = null;
  }, []);

  const animatePreviewCameraOverride = useCallback((
    fromConfig: SceneCameraConfig,
    toConfig: SceneCameraConfig,
    clearAtEnd: boolean,
  ) => {
    stopEditCameraAnimation();
    const from = cloneSceneCameraConfig(fromConfig);
    const to = cloneSceneCameraConfig(toConfig);
    const startedAt = performance.now();

    const tick = (now: number) => {
      const rawT = Math.min(1, (now - startedAt) / EDIT_CAMERA_BLEND_MS);
      const easedT = easeInOutCubic(rawT);
      setPreviewCameraOverride(lerpSceneCameraConfig(from, to, easedT));
      engine.requestRender();

      if (rawT < 1) {
        editCameraAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }

      editCameraAnimationRef.current = null;
      setPreviewCameraOverride(clearAtEnd ? null : cloneSceneCameraConfig(to));
      engine.requestRender();
    };

    setPreviewCameraOverride(cloneSceneCameraConfig(from));
    engine.requestRender();
    editCameraAnimationRef.current = window.requestAnimationFrame(tick);
  }, [setPreviewCameraOverride, stopEditCameraAnimation]);

  const applyNavigationCameraValues = useCallback((clip: TimelineClip, values: {
    positionX?: number;
    positionY?: number;
    scale?: number;
    forwardOffset?: number;
    rotationX?: number;
    rotationY?: number;
  }) => {
    if (!editCameraModeActive || clip.id !== editCameraClipIdRef.current || !editCameraTransformRef.current) {
      applySceneCameraValues(clip.id, values);
      return;
    }

    stopEditCameraAnimation();
    const current = editCameraTransformRef.current;
    const next: ClipTransform = {
      ...current,
      position: {
        x: values.positionX ?? current.position.x,
        y: values.positionY ?? current.position.y,
        z: current.position.z,
      },
      scale: {
        x: values.scale ?? current.scale.x,
        y: values.scale ?? current.scale.y,
        ...(values.forwardOffset !== undefined || current.scale.z !== undefined
          ? { z: values.forwardOffset ?? current.scale.z ?? 0 }
          : {}),
      },
      rotation: {
        x: values.rotationX ?? current.rotation.x,
        y: values.rotationY ?? current.rotation.y,
        z: current.rotation.z,
      },
    };

    editCameraTransformRef.current = next;
    const nextCameraConfig = buildPreviewCameraConfigFromTransform(
      clip,
      next,
      { width: effectiveResolution.width, height: effectiveResolution.height },
    );
    if (nextCameraConfig) {
      setPreviewCameraOverride(nextCameraConfig);
      engine.requestRender();
    }
  }, [
    applySceneCameraValues,
    editCameraModeActive,
    effectiveResolution.height,
    effectiveResolution.width,
    setPreviewCameraOverride,
    stopEditCameraAnimation,
  ]);

  useEffect(() => {
    const wasEditCameraModeActive = editCameraModeActiveRef.current;

    if (editCameraModeActive && activeCameraClipAtPlayhead) {
      const clipChanged = editCameraClipIdRef.current !== activeCameraClipAtPlayhead.id;
      if (clipChanged || !editCameraTransformRef.current) {
        editCameraClipIdRef.current = activeCameraClipAtPlayhead.id;
        editCameraTransformRef.current = resolveCameraClipTransformAtPlayhead(activeCameraClipAtPlayhead);
      }

      const editCameraConfig = getEditSceneCameraConfig(activeCameraClipAtPlayhead);
      if (!editCameraConfig) return;

      editCameraModeActiveRef.current = true;
      if (!wasEditCameraModeActive || clipChanged) {
        const fromConfig = useEngineStore.getState().previewCameraOverride ?? getActualSceneCameraConfig();
        animatePreviewCameraOverride(fromConfig, editCameraConfig, false);
      } else {
        setPreviewCameraOverride(editCameraConfig);
        engine.requestRender();
      }
      return;
    }

    editCameraModeActiveRef.current = false;
    if (wasEditCameraModeActive) {
      const fromConfig = useEngineStore.getState().previewCameraOverride ?? getActualSceneCameraConfig();
      animatePreviewCameraOverride(fromConfig, getActualSceneCameraConfig(), true);
    }
  }, [
    activeCameraClipAtPlayhead,
    animatePreviewCameraOverride,
    editCameraModeActive,
    getActualSceneCameraConfig,
    getEditSceneCameraConfig,
    resolveCameraClipTransformAtPlayhead,
    setPreviewCameraOverride,
  ]);

  useEffect(() => () => {
    stopEditCameraAnimation();
    setPreviewCameraOverride(null);
    engine.requestRender();
  }, [setPreviewCameraOverride, stopEditCameraAnimation]);

  const scheduleGaussianWheelBatchEnd = useCallback(() => {
    if (gaussianWheelBatchTimerRef.current === null) {
      startSceneNavHistoryBatch('Scene zoom');
    } else {
      window.clearTimeout(gaussianWheelBatchTimerRef.current);
    }
    gaussianWheelBatchTimerRef.current = window.setTimeout(() => {
      gaussianWheelBatchTimerRef.current = null;
      endSceneNavHistoryBatch();
    }, 180);
  }, [endSceneNavHistoryBatch, startSceneNavHistoryBatch]);

  const getSceneNavSolveSettings = useCallback((clip: TimelineClip | null) => {
    if (clip?.source?.type !== 'camera') return null;

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
  }, []);

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

  const tickGaussianKeyboardMovement = useCallback((timestamp: number) => {
    gaussianKeyboardFrameRef.current = null;

    if (!sceneNavEnabled || !navigationSceneNavClip || document.activeElement !== containerRef.current) {
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

    const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
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
    const clipSource = navigationSceneNavClip.source;
    if (!clipSource || clipSource.type !== 'camera') {
      stopGaussianKeyboardMovement();
      return;
    }
    const fovDegrees = clipSource.cameraSettings?.fov ?? DEFAULT_SCENE_CAMERA_SETTINGS.fov;
    const minimumDistance = getSharedSceneDefaultCameraDistance(fovDegrees);
    const baseDistance = freshTransform.position.z !== 0 ? Math.abs(freshTransform.position.z) : minimumDistance;
    const currentDistance = baseDistance / zoom;
    const keyboardMoveSpeed = effectiveSceneNavFpsMode ? sceneNavFpsMoveSpeed : 1;
    const panStep = 0.9 * zoomDamping * dt * keyboardMoveSpeed;
    const forwardStep = Math.max(0.15, currentDistance * 0.85) * dt * keyboardMoveSpeed;

    applyNavigationCameraValues(navigationSceneNavClip, {
      ...(rightInput !== 0 ? { positionX: freshTransform.position.x + rightInput * panStep } : {}),
      ...(upInput !== 0 ? { positionY: freshTransform.position.y + upInput * panStep } : {}),
      ...(forwardInput !== 0
        ? { forwardOffset: getCameraNavForwardOffset(freshTransform.scale.z) + forwardInput * forwardStep }
        : {}),
    });

    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [
    applyNavigationCameraValues,
    finishGaussianKeyboardBatch,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    sceneNavFpsMoveSpeed,
    getFreshSceneNavTransform,
    navigationSceneNavClip,
    stopGaussianKeyboardLoop,
    stopGaussianKeyboardMovement,
  ]);

  const startGaussianKeyboardMovement = useCallback(() => {
    if (gaussianKeyboardFrameRef.current !== null) return;
    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [tickGaussianKeyboardMovement]);

  const handleSceneNavKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!sceneNavEnabled || !navigationSceneNavClip) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!isCameraNavMoveCode(e.code)) return;

    e.preventDefault();

    if (!gaussianKeyboardBatchActiveRef.current) {
      startSceneNavHistoryBatch('Scene move');
      gaussianKeyboardBatchActiveRef.current = true;
    }

    gaussianKeyboardMoveCodesRef.current.add(e.code);
    startGaussianKeyboardMovement();
  }, [navigationSceneNavClip, sceneNavEnabled, startGaussianKeyboardMovement, startSceneNavHistoryBatch]);

  const handleSceneNavKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isCameraNavMoveCode(e.code)) return;

    e.preventDefault();
    gaussianKeyboardMoveCodesRef.current.delete(e.code);

    if (gaussianKeyboardMoveCodesRef.current.size === 0) {
      stopGaussianKeyboardLoop();
      finishGaussianKeyboardBatch();
    }
  }, [finishGaussianKeyboardBatch, stopGaussianKeyboardLoop]);

  const handleSceneNavBlur = useCallback(() => {
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
  }, [stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    return () => {
      if (gaussianWheelBatchTimerRef.current !== null) {
        window.clearTimeout(gaussianWheelBatchTimerRef.current);
        gaussianWheelBatchTimerRef.current = null;
        endSceneNavHistoryBatch();
      }
      if (gaussianOrbitStart.current.clipId) {
        gaussianOrbitStart.current.clipId = null;
        endSceneNavHistoryBatch();
      }
      if (gaussianPanStart.current.clipId) {
        gaussianPanStart.current.clipId = null;
        endSceneNavHistoryBatch();
      }
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
    };
  }, [endSceneNavHistoryBatch, stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (sceneNavEnabled) return;
    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    if (isGaussianOrbiting) {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    }
    if (isGaussianPanning) {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    }
  }, [endSceneNavHistoryBatch, sceneNavEnabled, isGaussianOrbiting, isGaussianPanning, stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (effectiveSceneNavFpsMode) {
      if (isGaussianOrbiting) {
        gaussianOrbitStart.current.clipId = null;
        setIsGaussianOrbiting(false);
        endSceneNavHistoryBatch();
      }
      return;
    }

    if (isGaussianFpsLooking) {
      stopGaussianFpsLook();
    }
  }, [effectiveSceneNavFpsMode, endSceneNavHistoryBatch, isGaussianFpsLooking, isGaussianOrbiting, stopGaussianFpsLook]);

  useEffect(() => {
    if (!isGaussianOrbiting) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y, pitch, yaw } = gaussianOrbitStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const nextPitch = pitch + dy * 0.25;
      const nextYaw = yaw - dx * 0.25;

      applyNavigationCameraValues(navigationSceneNavClip, {
        rotationX: nextPitch,
        rotationY: nextYaw,
      });
    };

    const finishGaussianOrbit = () => {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianOrbit);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianOrbit);
    };
  }, [applyNavigationCameraValues, endSceneNavHistoryBatch, isGaussianOrbiting, navigationSceneNavClip]);

  useEffect(() => {
    if (!isGaussianFpsLooking || !navigationSceneNavClip) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y } = gaussianFpsLookStart.current;
      if (!clipId) return;

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
      if (!freshTransform || !solveSettings) return;

      const pointerLockTarget = getSceneNavPointerLockTarget();
      const pointerLockActive = pointerLockTarget !== null && document.pointerLockElement === pointerLockTarget;
      const deltaX = pointerLockActive ? e.movementX : e.clientX - x;
      const deltaY = pointerLockActive ? e.movementY : e.clientY - y;

      if (!pointerLockActive) {
        gaussianFpsLookStart.current.x = e.clientX;
        gaussianFpsLookStart.current.y = e.clientY;
      }

      if (deltaX === 0 && deltaY === 0) return;

      const nextPitch = freshTransform.rotation.x + deltaY * CAMERA_NAV_FPS_LOOK_SPEED;
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

      applyNavigationCameraValues(navigationSceneNavClip, {
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
      const pointerLockTarget = getSceneNavPointerLockTarget();
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
    applyNavigationCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    getSceneNavSolveSettings,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    isGaussianFpsLooking,
    navigationSceneNavClip,
    stopGaussianFpsLook,
  ]);

  useEffect(() => {
    if (!isGaussianPanning) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const { clipId, x, y, panX, panY, zoom } = gaussianPanStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
      const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
      const panScaleY = (2 / Math.max(1, effectiveResolution.height)) * zoomDamping;
      const nextPanX = panX - dx * panScaleX;
      const nextPanY = panY + dy * panScaleY;

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: nextPanX,
        positionY: nextPanY,
      });
    };

    const finishGaussianPan = () => {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', finishGaussianPan);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', finishGaussianPan);
    };
  }, [
    applyNavigationCameraValues,
    endSceneNavHistoryBatch,
    effectiveResolution.height,
    effectiveResolution.width,
    isGaussianPanning,
    navigationSceneNavClip,
  ]);

  // Sync layer selection when clip is selected in timeline (for edit mode)
  useEffect(() => {
    if (!selectedClipId || !layerEditMode) return;

    const clip = clips.find(c => c.id === selectedClipId);
    if (clip) {
      const layer = layers.find(l => l?.name === clip.name);
      if (layer && layer.id !== selectedLayerId) {
        selectLayer(layer.id);
      }
    }
  }, [selectedClipId, layerEditMode, clips, layers, selectedLayerId, selectLayer]);

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
    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(e.target)) {
      const shouldAdjustFpsSpeed = effectiveSceneNavFpsMode && (
        gaussianKeyboardMoveCodesRef.current.size > 0 ||
        gaussianFpsLookStart.current.clipId !== null
      );
      if (shouldAdjustFpsSpeed) {
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
        if (direction !== 0) {
          setSceneNavFpsMoveSpeed(stepSceneNavFpsMoveSpeed(
            useEngineStore.getState().sceneNavFpsMoveSpeed,
            direction,
          ));
        }
        return;
      }

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      e.preventDefault();
      scheduleGaussianWheelBatchEnd();

      const currentZoom = Math.max(0.05, freshTransform.scale.x || 1);
      const zoomFactor = Math.exp(-e.deltaY * 0.0025);
      const nextZoom = Math.max(0.05, Math.min(40, currentZoom * zoomFactor));

      applyNavigationCameraValues(navigationSceneNavClip, {
        scale: nextZoom,
      });
      return;
    }

    if (!layerEditMode || !containerRef.current) return;

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
    layerEditMode,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    getFreshSceneNavTransform,
    isCanvasInteractionTarget,
    scheduleGaussianWheelBatchEnd,
    applyNavigationCameraValues,
    setSceneNavFpsMoveSpeed,
    navigationSceneNavClip,
    viewPan,
    viewZoom,
  ]);

  // Tab key to toggle edit mode (via shortcut registry)
  useShortcut('preview.editMode', () => {
    setEditMode(prev => !prev);
  }, { enabled: isEditableSource });

  // Handle scene navigation and edit-mode panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(e.target)) {
      containerRef.current?.focus({ preventScroll: true });
      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      if (e.button === 0) {
        if (e.shiftKey) {
          e.preventDefault();
          endGaussianWheelBatch();
          startSceneNavHistoryBatch('Scene pan');
          gaussianPanStart.current = {
            clipId: navigationSceneNavClip.id,
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
        if (effectiveSceneNavFpsMode) {
          startSceneNavHistoryBatch('Scene look');
          gaussianFpsLookStart.current = {
            clipId: navigationSceneNavClip.id,
            x: e.clientX,
            y: e.clientY,
          };
          getSceneNavPointerLockTarget()?.requestPointerLock?.();
          setIsGaussianFpsLooking(true);
        } else {
          startSceneNavHistoryBatch('Scene orbit');
          gaussianOrbitStart.current = {
            clipId: navigationSceneNavClip.id,
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
        startSceneNavHistoryBatch('Scene pan');
        gaussianPanStart.current = {
          clipId: navigationSceneNavClip.id,
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

    if (!layerEditMode) return;

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
    layerEditMode,
    endGaussianWheelBatch,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    getFreshSceneNavTransform,
    getSceneNavPointerLockTarget,
    isCanvasInteractionTarget,
    navigationSceneNavClip,
    startSceneNavHistoryBatch,
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
    if (sceneNavEnabled && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [sceneNavEnabled, isCanvasInteractionTarget]);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (sceneNavEnabled && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [sceneNavEnabled, isCanvasInteractionTarget]);

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
      editMode: layerEditMode, overlayRef, canvasSize, canvasInContainer, viewZoom,
      layers, clips, selectedLayerId, selectedClipId,
      selectClip, selectLayer, updateClipTransform, updateLayer,
      calculateLayerBounds, findLayerAtPosition, findHandleAtPosition,
    });

  // Calculate transform for zoomed/panned view
  const viewTransform = layerEditMode ? {
    transform: `scale(${viewZoom}) translate(${viewPan.x / viewZoom}px, ${viewPan.y / viewZoom}px)`,
  } : {};
  const splatLoadPercent = activeSplatLoadProgress
    ? formatSplatLoadPercent(activeSplatLoadProgress.percent)
    : 0;
  const splatLoadPhaseLabel = activeSplatLoadProgress
    ? getSplatLoadPhaseLabel(activeSplatLoadProgress.phase)
    : '';
  const showSceneObjectOverlay = sceneObjectOverlayEnabled && isEditableSource && !isPlaying && (!editMode || editCameraModeActive);
  const sceneObjectOverlaySelectedClipId = editCameraModeActive
    ? editCameraClipSelected
      ? activeCameraClipAtPlayhead?.id ?? null
      : null
    : selectedClipId;
  const editCameraGizmoTransform = editCameraModeActive && activeCameraClipAtPlayhead
    ? resolveCameraClipTransformAtPlayhead(activeCameraClipAtPlayhead)
    : null;

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
      onKeyDownCapture={handleSceneNavKeyDown}
      onKeyUpCapture={handleSceneNavKeyUp}
      onBlur={handleSceneNavBlur}
      tabIndex={0}
      style={{
        cursor: isGaussianOrbiting || isGaussianPanning
          ? 'grabbing'
          : isGaussianFpsLooking
            ? 'crosshair'
          : isPanning
            ? 'grabbing'
            : sceneNavEnabled
              ? (effectiveSceneNavFpsMode ? 'crosshair' : 'grab')
              : layerEditMode
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
        showEditViewControls={layerEditMode}
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
        panelId={panelId}
        addPreviewPanel={addPreviewPanel}
        closePanelById={closePanelById}
      />

      {/* Source monitor overlay - shown on top when active */}
      {sourceMonitorActive && (
        <SourceMonitor
          file={sourceMonitorFile!}
          autoplayRequestId={sourceMonitorPlaybackRequestId}
          onClose={closeSourceMonitor}
        />
      )}

      {/* Engine canvas + overlays - always in DOM to keep WebGPU registration alive */}
      <div style={{ display: sourceMonitorActive ? 'none' : 'contents' }}>
        <div className="preview-top-right-overlays">
          <div
            ref={setSceneGizmoToolbarTarget}
            className="preview-scene-gizmo-toolbar-slot"
          />
          <StatsOverlay
            stats={engineStats}
            resolution={effectiveResolution}
            expanded={statsExpanded}
            onToggle={() => setStatsExpanded(!statsExpanded)}
          />
        </div>

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
              {showSceneObjectOverlay && (
                <SceneObjectOverlay
                  clips={clips}
                  tracks={tracks}
                  selectedClipId={sceneObjectOverlaySelectedClipId}
                  selectClip={selectClip}
                  canvasSize={canvasSize}
                  viewport={effectiveResolution}
                  compositionId={displayedCompId}
                  sceneNavClipId={sceneNavClipId}
                  previewCameraOverride={previewCameraOverride}
                  editCameraClip={editCameraModeActive ? activeCameraClipAtPlayhead : null}
                  editCameraTransform={editCameraGizmoTransform}
                  showOnlyEditCamera={editCameraModeActive}
                  toolbarPortalTarget={sceneGizmoToolbarTarget}
                  enabled
                />
              )}
            </>
          )}
        </div>

        {activeSplatLoadProgress && (
          <div
            className={`preview-splat-progress-overlay ${activeSplatLoadProgress.phase === 'error' ? 'error' : ''}`}
            role="status"
            aria-live="polite"
          >
            <div className="preview-splat-progress-header">
              <span>{splatLoadPhaseLabel}</span>
              <span>{splatLoadPercent}%</span>
            </div>
            <div className="preview-splat-progress-name">
              {activeSplatLoadProgress.fileName}
            </div>
            <div className="preview-splat-progress-track">
              <div
                className="preview-splat-progress-fill"
                style={{ width: `${splatLoadPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Edit mode overlay - covers full container for pasteboard support */}
        {layerEditMode && isEngineReady && (
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

        {layerEditMode && isEditableSource && (
          <div className="preview-edit-hint">
            Drag: Move | Handles: Scale (Shift: Lock Ratio) | Scroll: Zoom | Alt+Drag: Pan
          </div>
        )}
        {sceneNavEnabled && (
          <div className="preview-edit-hint">
            {effectiveSceneNavFpsMode
              ? 'Scene Nav: click preview, hold LMB to look, WASD/QE move, MMB/RMB/Shift+LMB pan, wheel speed while moving/looking, wheel zoom otherwise'
              : 'Scene Nav: click preview, WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel zoom'}
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
