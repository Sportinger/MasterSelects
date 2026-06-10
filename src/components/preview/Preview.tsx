// Preview canvas component with After Effects-style editing overlay

import './Preview.css';
import './PreviewEditMode.css';
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
  selectSceneNavNoKeyframes,
  stepSceneNavFpsMoveSpeed,
  useEngineStore,
} from '../../stores/engineStore';
import type { SceneCameraLiveOverride } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../stores/mediaStore/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { startBatch, endBatch } from '../../stores/historyStore';
import { PreviewControls } from './PreviewControls';
import { PreviewCanvasMount } from './PreviewCanvasMount';
import { useEditModeOverlay } from './useEditModeOverlay';
import { useLayerDrag } from './useLayerDrag';
import { useSAM2Store } from '../../stores/sam2Store';
import { engine } from '../../engine/WebGPUEngine';
import {
  resolveOrbitCameraFrame,
  resolveOrbitCameraPose,
  resolveOrbitCameraTranslationForFixedEye,
} from '../../engine/gaussian/core/SplatCameraUtils';
import { resolveSharedSceneCameraConfig } from '../../engine/scene/SceneCameraUtils';
import type { SceneCameraConfig, SceneVector3, SceneViewport } from '../../engine/scene/types';
import type { ClipTransform, TimelineClip, TimelineTrack } from '../../types';
import type { PreviewPanelSource } from '../../types/dock';
import {
  registerPreviewTarget,
  setPreviewTargetTransparency,
  unregisterPreviewTarget,
} from '../../services/render/previewTargetRegistration';
import {
  fullFrameFocalLengthMmToFov,
} from '../../utils/cameraLens';
import { getFirstEditablePreviewPanelId, getPreviewPanelIdFromElement } from './previewPanelDom';
import { usePreviewDropdownState } from './usePreviewDropdownState';
import { usePreviewSourceConfig } from './usePreviewSourceConfig';
import { usePreviewViewport } from './usePreviewViewport';

const CAMERA_NAV_MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

function isCameraNavMoveCode(code: string): code is 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE' {
  return CAMERA_NAV_MOVE_CODES.has(code);
}

function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

const CAMERA_NAV_FPS_LOOK_SPEED = 0.18;
const EDIT_CAMERA_BLEND_MS = 320;
const TIMELINE_TIME_EPSILON = 1e-4;
const EDIT_CAMERA_ORTHO_MIN_SCALE = 0.05;
const EDIT_CAMERA_ORTHO_MAX_SCALE = 10000;
const DEFAULT_EDIT_CAMERA_FOCAL_LENGTH_MM = 35;
const DEFAULT_EDIT_CAMERA_SETTINGS: SceneCameraSettings = {
  ...DEFAULT_SCENE_CAMERA_SETTINGS,
  fov: fullFrameFocalLengthMmToFov(DEFAULT_EDIT_CAMERA_FOCAL_LENGTH_MM),
};

type EditCameraViewMode = 'camera' | 'front' | 'side' | 'top';
type EditCameraOrthoViewMode = Exclude<EditCameraViewMode, 'camera'>;
type PreviewWheelEvent = WheelEvent | React.WheelEvent;

interface EditCameraOrthoFrame {
  clipId: string;
  mode: EditCameraOrthoViewMode;
  center: SceneVector3;
  scale: number;
}

const EDIT_CAMERA_VIEW_LABELS: Record<EditCameraViewMode, string> = {
  camera: 'Camera',
  front: 'Front',
  side: 'Side',
  top: 'Top',
};
const SCENE_OBJECT_INTERACTION_SELECTOR = [
  '.preview-scene-object-handle',
  '.preview-scene-gizmo-axis',
  '.preview-scene-gizmo-rotate',
  '.preview-scene-gizmo-toolbar',
].join(',');

function cloneClipTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function applySceneCameraLiveOverrideToTransform(
  transform: ClipTransform,
  override: SceneCameraLiveOverride | null | undefined,
): ClipTransform {
  if (!override) {
    return transform;
  }

  return {
    ...transform,
    position: {
      x: transform.position.x + (override.position?.x ?? 0),
      y: transform.position.y + (override.position?.y ?? 0),
      z: transform.position.z + (override.position?.z ?? 0),
    },
    scale: {
      ...transform.scale,
      all: (transform.scale.all ?? 1) + (override.scale?.all ?? 0),
      x: transform.scale.x + (override.scale?.x ?? 0),
      y: transform.scale.y + (override.scale?.y ?? override.scale?.x ?? 0),
      ...(transform.scale.z !== undefined || override.scale?.z !== undefined
        ? { z: (transform.scale.z ?? 0) + (override.scale?.z ?? 0) }
        : {}),
    },
    rotation: {
      x: transform.rotation.x + (override.rotation?.x ?? 0),
      y: transform.rotation.y + (override.rotation?.y ?? 0),
      z: transform.rotation.z + (override.rotation?.z ?? 0),
    },
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

function cloneSceneVector(vector: SceneVector3): SceneVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function addSceneVectors(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleSceneVector(vector: SceneVector3, scale: number): SceneVector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function getSceneBoundsCenter(bounds: { min: [number, number, number]; max: [number, number, number] } | undefined): SceneVector3 {
  if (!bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.min[0] + bounds.max[0]) * 0.5,
    y: (bounds.min[1] + bounds.max[1]) * 0.5,
    z: (bounds.min[2] + bounds.max[2]) * 0.5,
  };
}

function clampEditCameraOrthoScale(scale: number): number {
  if (!Number.isFinite(scale)) return 2;
  return Math.max(EDIT_CAMERA_ORTHO_MIN_SCALE, Math.min(EDIT_CAMERA_ORTHO_MAX_SCALE, scale));
}

function getEditCameraViewModeFromKey(event: Pick<KeyboardEvent, 'code' | 'key'>): EditCameraViewMode | null {
  if (event.code === 'Digit1' || event.code === 'Numpad1' || event.key === '1') return 'front';
  if (event.code === 'Digit2' || event.code === 'Numpad2' || event.key === '2') return 'side';
  if (event.code === 'Digit3' || event.code === 'Numpad3' || event.key === '3') return 'top';
  if (event.code === 'Digit4' || event.code === 'Numpad4' || event.key === '4') return 'camera';
  return null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function isSceneObjectInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(SCENE_OBJECT_INTERACTION_SELECTOR));
}

function getEditCameraOrthoBasis(mode: EditCameraOrthoViewMode): {
  eyeDirection: SceneVector3;
  right: SceneVector3;
  up: SceneVector3;
} {
  switch (mode) {
    case 'side':
      return {
        eyeDirection: { x: 1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      };
    case 'top':
      return {
        eyeDirection: { x: 0, y: 1, z: 0 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 0, z: -1 },
      };
    case 'front':
    default:
      return {
        eyeDirection: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      };
  }
}

function getSceneCameraDistance(config: SceneCameraConfig): number {
  return Math.max(
    0.001,
    Math.hypot(
      config.position.x - config.target.x,
      config.position.y - config.target.y,
      config.position.z - config.target.z,
    ),
  );
}

function createDefaultEditCameraOrthoFrame(
  mode: EditCameraOrthoViewMode,
  clipId: string,
  cameraConfig: SceneCameraConfig,
): EditCameraOrthoFrame {
  const distance = getSceneCameraDistance(cameraConfig);
  const perspectiveHeight = 2 * Math.tan((Math.max(1, cameraConfig.fov) * Math.PI / 180) * 0.5) * distance;
  return {
    clipId,
    mode,
    center: cloneSceneVector(cameraConfig.target),
    scale: clampEditCameraOrthoScale(Math.max(2, perspectiveHeight, distance * 1.35)),
  };
}

function buildEditCameraOrthographicConfig(
  mode: EditCameraOrthoViewMode,
  frame: EditCameraOrthoFrame,
  cameraConfig: SceneCameraConfig,
): SceneCameraConfig {
  const basis = getEditCameraOrthoBasis(mode);
  const viewDistance = Math.max(
    10,
    Math.min(Math.max(cameraConfig.far * 0.25, frame.scale * 4), EDIT_CAMERA_ORTHO_MAX_SCALE),
  );
  return {
    position: addSceneVectors(frame.center, scaleSceneVector(basis.eyeDirection, viewDistance)),
    target: cloneSceneVector(frame.center),
    up: cloneSceneVector(basis.up),
    fov: cameraConfig.fov,
    near: cameraConfig.near,
    far: cameraConfig.far,
    applyDefaultDistance: false,
    projection: 'orthographic',
    orthographicScale: frame.scale,
  };
}

function lerpSceneCameraConfig(from: SceneCameraConfig, to: SceneCameraConfig, t: number): SceneCameraConfig {
  const projection = to.projection ?? 'perspective';
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
    projection,
    ...(projection === 'orthographic'
      ? {
          orthographicScale: lerpNumber(
            from.orthographicScale ?? to.orthographicScale ?? 2,
            to.orthographicScale ?? from.orthographicScale ?? 2,
            t,
          ),
        }
      : {}),
  };
}

function buildEditCameraOrbitSceneBounds(center: SceneVector3 | null): {
  min: [number, number, number];
  max: [number, number, number];
} | undefined {
  if (!center) return undefined;
  return {
    min: [center.x, center.y, center.z],
    max: [center.x, center.y, center.z],
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

function isSharedSceneOverlayClip(clip: TimelineClip): boolean {
  const sourceType = clip.source?.type;
  return (
    sourceType === 'camera' ||
    sourceType === 'model' ||
    sourceType === 'gaussian-splat' ||
    sourceType === 'splat-effector' ||
    Boolean(clip.is3D && sourceType !== 'audio')
  );
}

function hasActiveSharedSceneOverlayContent(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  timelineTime: number,
): boolean {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  return clips.some((clip) => {
    const track = trackById.get(clip.trackId);
    if (!track || track.type === 'audio' || track.visible === false) return false;
    if (!isSharedSceneOverlayClip(clip)) return false;
    return (
      timelineTime >= clip.startTime - TIMELINE_TIME_EPSILON &&
      timelineTime < clip.startTime + clip.duration + TIMELINE_TIME_EPSILON
    );
  });
}

function buildPreviewCameraConfigFromTransform(
  clip: TimelineClip,
  transform: ClipTransform,
  viewport: SceneViewport,
  orbitCenter: SceneVector3 | null = null,
  cameraSettingsOverride?: SceneCameraSettings,
): SceneCameraConfig | null {
  if (clip.source?.type !== 'camera') return null;

  const timelineState = cameraSettingsOverride ? null : useTimelineStore.getState();
  const cameraSettings = cameraSettingsOverride ?? timelineState?.getInterpolatedCameraSettings(
    clip.id,
    timelineState.playheadPosition - clip.startTime,
  ) ?? DEFAULT_EDIT_CAMERA_SETTINGS;
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
    buildEditCameraOrbitSceneBounds(orbitCenter),
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

interface PreviewProps {
  panelId: string;
  source: PreviewPanelSource;
  showTransparencyGrid: boolean; // per-tab transparency toggle
}

export function Preview({ panelId, source, showTransparencyGrid }: PreviewProps) {
  const { isEngineReady } = useEngine();
  // NOTE: these are store actions (stable references) — safe to destructure once.
  // For state-reading functions (getInterpolatedTransform), call getState() at usage site.
  const { addKeyframe, hasKeyframes, isRecording } = useTimelineStore.getState();
  const engineInitFailed = useEngineStore((s) => s.engineInitFailed);
  const engineInitError = useEngineStore((s) => s.engineInitError);
  const engineStats = useEngineStore(s => s.engineStats);
  const sceneNavClipId = useEngineStore(selectSceneNavClipId);
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const sceneNavNoKeyframes = useEngineStore(selectSceneNavNoKeyframes);
  const previewCameraOverride = useEngineStore((s) => s.previewCameraOverride);
  const setPreviewCameraOverride = useEngineStore((s) => s.setPreviewCameraOverride);
  const setSceneGizmoVisible = useEngineStore((s) => s.setSceneGizmoVisible);
  const setSceneGizmoClipIdOverride = useEngineStore((s) => s.setSceneGizmoClipIdOverride);
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

  // Unified RenderTarget registration
  useEffect(() => {
    if (!isEngineReady || !canvasRef.current) return;

    const isIndependent = stableRenderSource.type !== 'activeComp';

    log.debug(`[${panelId}] Registering render target`, { source: stableRenderSource, isIndependent });

    const registered = registerPreviewTarget({
      id: panelId,
      name: 'Preview',
      source: stableRenderSource,
      showTransparencyGrid,
      canvas: canvasRef.current,
      onIndependentRegistered: () => setCompReady(true),
    });
    if (!registered) return;

    return () => {
      log.debug(`[${panelId}] Unregistering render target`);
      unregisterPreviewTarget(panelId, stableRenderSource);
    };
  }, [isEngineReady, panelId, stableRenderSource, showTransparencyGrid]);

  // Sync per-tab transparency grid flag
  useEffect(() => {
    if (!isEngineReady) return;
    setPreviewTargetTransparency(panelId, showTransparencyGrid);
  }, [isEngineReady, panelId, showTransparencyGrid]);

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

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  // #206: while editing a text clip inside the layer-edit mode, this toggles
  // between layer transform (move/scale handles) and text typing. Double-click
  // enters typing; Escape returns to transform.
  const [textTyping, setTextTyping] = useState(false);
  const [editCameraViewMode, setEditCameraViewMode] = useState<EditCameraViewMode>('camera');
  const [editCameraOrthoFrame, setEditCameraOrthoFrame] = useState<EditCameraOrthoFrame | null>(null);
  const [isEditCameraOrthoPanning, setIsEditCameraOrthoPanning] = useState(false);
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
  const editCameraOrthoPanStart = useRef({
    x: 0,
    y: 0,
    center: { x: 0, y: 0, z: 0 } as SceneVector3,
    scale: 1,
    mode: 'front' as EditCameraOrthoViewMode,
  });
  const sceneNavHistoryBatchActiveRef = useRef(false);
  const editCameraTransformRef = useRef<ClipTransform | null>(null);
  const editCameraClipIdRef = useRef<string | null>(null);
  const editCameraSettingsRef = useRef<SceneCameraSettings>({ ...DEFAULT_EDIT_CAMERA_SETTINGS });
  const editCameraOrbitCenterRef = useRef<SceneVector3 | null>(null);
  const editCameraAnimationRef = useRef<number | null>(null);
  const editCameraViewTransitionRef = useRef(false);
  const editCameraModeActiveRef = useRef(false);
  const activeSharedSceneOverlayContent = useMemo(
    () => hasActiveSharedSceneOverlayContent(clips, tracks, playheadPosition),
    [clips, playheadPosition, tracks],
  );

  useEffect(() => {
    return () => {
      setSceneGizmoVisible(true);
    };
  }, [setSceneGizmoVisible]);

  useEffect(() => {
    setSceneGizmoVisible(sceneObjectOverlayEnabled && activeSharedSceneOverlayContent && isEditableSource && !sourceMonitorActive);
    if (isEngineReady) {
      engine.requestRender();
    }
  }, [
    activeSharedSceneOverlayContent,
    isEditableSource,
    isEngineReady,
    sceneObjectOverlayEnabled,
    setSceneGizmoVisible,
    sourceMonitorActive,
  ]);

  useEffect(() => {
    if (!isEditableSource) {
      setEditMode(false);
    }
  }, [isEditableSource]);

  const selectedClip = useMemo(
    () => (selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null),
    [clips, selectedClipId],
  );
  const selectedTextLayer = useMemo(
    () => (
      selectedClip?.source?.type === 'text'
        ? layers.find((layer) => layer?.sourceClipId === selectedClip.id && layer.source?.textCanvas) ?? null
        : null
    ),
    [layers, selectedClip],
  );
  const selectedTextBounds = useMemo(
    () => (
      selectedClip?.textProperties
        ? getInterpolatedTextBounds(selectedClip.id, playheadPosition - selectedClip.startTime)
        : undefined
    ),
    [getInterpolatedTextBounds, playheadPosition, selectedClip],
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
  const editCameraOrthoMode: EditCameraOrthoViewMode | null =
    editCameraViewMode === 'camera' ? null : editCameraViewMode;
  const editCameraOrthoViewActive = editCameraModeActive && editCameraOrthoMode !== null;
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
    const transform = getInterpolatedTransform(clip.id, clipLocalTime);
    if (!sceneNavNoKeyframes) {
      return transform;
    }

    return applySceneCameraLiveOverrideToTransform(
      transform,
      useEngineStore.getState().sceneCameraLiveOverrides[clip.id],
    );
  }, [editCameraModeActive, sceneNavNoKeyframes]);

  const sceneNavEnabled = Boolean(
    isEditableSource &&
    navigationSceneNavClip &&
    (
      (editCameraModeActive && !editCameraOrthoViewActive) ||
      (!editMode && sceneNavClipId === navigationSceneNavClip.id)
    ),
  );
  const layerEditMode = editMode && !editCameraModeActive;
  const maskTabActive = isEditableSource && maskPanelActive;
  const maskNavigationMode = layerEditMode && maskTabActive;
  const textClipEditMode = Boolean(layerEditMode && !maskTabActive && selectedClip?.textProperties && selectedTextLayer);
  // #206: a text clip lives inside the layer-edit mode. Show the layer move/scale
  // handles unless the user is actively typing (entered via double-click).
  const textTypingActive = textClipEditMode && textTyping;
  const layerTransformMode = layerEditMode && !maskNavigationMode && (!textClipEditMode || !textTypingActive);
  const freeCanvasNavigationMode = layerTransformMode || maskNavigationMode || textClipEditMode;
  const effectiveSceneNavFpsMode = sceneNavFpsMode && !editCameraModeActive;
  const editCameraClipSelected = Boolean(
    editCameraModeActive &&
    activeCameraClipAtPlayhead &&
    selectedClipIds.has(activeCameraClipAtPlayhead.id),
  );
  const activeEditCameraOrthoFrame =
    editCameraOrthoMode &&
    activeCameraClipAtPlayhead &&
    editCameraOrthoFrame?.clipId === activeCameraClipAtPlayhead.id &&
    editCameraOrthoFrame.mode === editCameraOrthoMode
      ? editCameraOrthoFrame
      : null;

  useEffect(() => {
    let overrideClipId: string | null = null;
    if (editCameraModeActive && selectedClipId && selectedClipId !== activeCameraClipAtPlayhead?.id) {
      overrideClipId = selectedClipId;
    } else if (editCameraClipSelected) {
      overrideClipId = activeCameraClipAtPlayhead?.id ?? null;
    }
    setSceneGizmoClipIdOverride(overrideClipId);
    return () => {
      setSceneGizmoClipIdOverride(null);
    };
  }, [
    activeCameraClipAtPlayhead?.id,
    editCameraClipSelected,
    editCameraModeActive,
    selectedClipId,
    setSceneGizmoClipIdOverride,
  ]);

  const activeEditCameraClipId = editCameraModeActive ? activeCameraClipAtPlayhead?.id ?? null : null;
  useEffect(() => {
    editCameraSettingsRef.current = { ...DEFAULT_EDIT_CAMERA_SETTINGS };
    editCameraOrbitCenterRef.current = null;
    setEditCameraViewMode('camera');
    setEditCameraOrthoFrame(null);
    setIsEditCameraOrthoPanning(false);
  }, [activeEditCameraClipId]);

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
    positionZ?: number;
    rotationX?: number;
    rotationY?: number;
  }) => {
    const engineState = useEngineStore.getState();
    const timelineState = useTimelineStore.getState();
    const clip = timelineState.clips.find((candidate) => candidate.id === clipId);
    if (engineState.sceneNavNoKeyframes && clip?.source?.type === 'camera') {
      const clipLocalTime = timelineState.playheadPosition - clip.startTime;
      const baseTransform = timelineState.getInterpolatedTransform(clipId, clipLocalTime);
      engineState.setSceneCameraLiveOverride(clipId, {
        ...(values.positionX !== undefined || values.positionY !== undefined
          || values.positionZ !== undefined
          ? {
              position: {
                ...(values.positionX !== undefined ? { x: values.positionX - baseTransform.position.x } : {}),
                ...(values.positionY !== undefined ? { y: values.positionY - baseTransform.position.y } : {}),
                ...(values.positionZ !== undefined ? { z: values.positionZ - baseTransform.position.z } : {}),
              },
            }
          : {}),
        ...(values.rotationX !== undefined || values.rotationY !== undefined
          ? {
              rotation: {
                ...(values.rotationX !== undefined ? { x: values.rotationX - baseTransform.rotation.x } : {}),
                ...(values.rotationY !== undefined ? { y: values.rotationY - baseTransform.rotation.y } : {}),
              },
            }
          : {}),
      });
      engine.requestRender();
      return;
    }

    const propertyUpdates: Array<readonly [property: 'position.x' | 'position.y' | 'position.z' | 'rotation.x' | 'rotation.y', value: number]> = [];

    if (values.positionX !== undefined) {
      propertyUpdates.push(['position.x', values.positionX]);
    }
    if (values.positionY !== undefined) {
      propertyUpdates.push(['position.y', values.positionY]);
    }
    if (values.positionZ !== undefined) {
      propertyUpdates.push(['position.z', values.positionZ]);
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
        addKeyframe(clipId, property, value);
      }
    } else {
      const currentClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
      const currentTransform = currentClip?.transform;
      updateClipTransform(clipId, {
        ...(values.positionX !== undefined || values.positionY !== undefined || values.positionZ !== undefined
          ? {
              position: {
                x: values.positionX ?? currentTransform?.position.x ?? 0,
                y: values.positionY ?? currentTransform?.position.y ?? 0,
                z: values.positionZ ?? currentTransform?.position.z ?? 0,
              },
            }
          : {}),
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
  }, [addKeyframe, hasKeyframes, isRecording, updateClipTransform]);

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
    const cameraConfig = buildPreviewCameraConfigFromTransform(
      clip,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (!cameraConfig) return null;
    if (
      editCameraOrthoMode &&
      editCameraOrthoFrame?.clipId === clip.id &&
      editCameraOrthoFrame.mode === editCameraOrthoMode
    ) {
      return buildEditCameraOrthographicConfig(editCameraOrthoMode, editCameraOrthoFrame, cameraConfig);
    }
    return cameraConfig;
  }, [
    activeCameraClipAtPlayhead,
    editCameraOrthoFrame,
    editCameraOrthoMode,
    effectiveResolution.height,
    effectiveResolution.width,
  ]);

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

  const setEditCameraView = useCallback((mode: EditCameraViewMode) => {
    if (!activeCameraClipAtPlayhead || !editCameraTransformRef.current) return;
    if (mode === editCameraViewMode) return;

    const cameraConfig = buildPreviewCameraConfigFromTransform(
      activeCameraClipAtPlayhead,
      editCameraTransformRef.current,
      { width: effectiveResolution.width, height: effectiveResolution.height },
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
    );
    if (!cameraConfig) return;

    const fromConfig = useEngineStore.getState().previewCameraOverride ?? getEditSceneCameraConfig(activeCameraClipAtPlayhead);
    if (!fromConfig) return;

    let toConfig = cameraConfig;
    let nextFrame: EditCameraOrthoFrame | null = null;
    if (mode !== 'camera') {
      nextFrame = editCameraOrthoFrame?.clipId === activeCameraClipAtPlayhead.id
        ? {
            ...editCameraOrthoFrame,
            mode,
          }
        : createDefaultEditCameraOrthoFrame(mode, activeCameraClipAtPlayhead.id, cameraConfig);
      toConfig = buildEditCameraOrthographicConfig(mode, nextFrame, cameraConfig);
    }

    editCameraViewTransitionRef.current = true;
    setEditCameraViewMode(mode);
    setEditCameraOrthoFrame(nextFrame);
    animatePreviewCameraOverride(fromConfig, toConfig, false);
  }, [
    activeCameraClipAtPlayhead,
    animatePreviewCameraOverride,
    editCameraOrthoFrame,
    editCameraViewMode,
    effectiveResolution.height,
    effectiveResolution.width,
    getEditSceneCameraConfig,
  ]);

  const applyNavigationCameraValues = useCallback((clip: TimelineClip, values: {
    positionX?: number;
    positionY?: number;
    positionZ?: number;
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
        z: values.positionZ ?? current.position.z,
      },
      scale: {
        all: current.scale.all ?? 1,
        x: current.scale.x,
        y: current.scale.y,
        ...(current.scale.z !== undefined ? { z: current.scale.z } : {}),
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
      editCameraOrbitCenterRef.current,
      editCameraSettingsRef.current,
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
      } else if (editCameraViewTransitionRef.current) {
        editCameraViewTransitionRef.current = false;
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
      startSceneNavHistoryBatch('Camera position');
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

    const timelineState = useTimelineStore.getState();
    const cameraSettings = editCameraModeActiveRef.current && clip.id === editCameraClipIdRef.current
      ? editCameraSettingsRef.current
      : timelineState.getInterpolatedCameraSettings(
          clip.id,
          timelineState.playheadPosition - clip.startTime,
        );
    return {
      settings: {
        nearPlane: cameraSettings.near,
        farPlane: cameraSettings.far,
        fov: cameraSettings.fov,
        minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
      },
      sceneBounds: editCameraModeActiveRef.current && clip.id === editCameraClipIdRef.current
        ? buildEditCameraOrbitSceneBounds(editCameraOrbitCenterRef.current)
        : undefined,
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

  const focusEditCameraOnSceneObject = useCallback((object: {
    clipId: string;
    kind: string;
    worldPosition: SceneVector3;
  }): boolean => {
    if (
      !editCameraModeActive ||
      !activeCameraClipAtPlayhead ||
      !editCameraTransformRef.current ||
      object.kind === 'camera' ||
      object.clipId === activeCameraClipAtPlayhead.id
    ) {
      return false;
    }

    const viewport = { width: effectiveResolution.width, height: effectiveResolution.height };
    const currentTransform = editCameraTransformRef.current;
    const fromConfig = useEngineStore.getState().previewCameraOverride
      ?? getEditSceneCameraConfig(activeCameraClipAtPlayhead);
    const nextOrbitCenter = cloneSceneVector(object.worldPosition);
    const nextTransform: ClipTransform = {
      ...currentTransform,
      position: {
        ...currentTransform.position,
        x: 0,
        y: 0,
      },
      scale: {
        ...currentTransform.scale,
        z: 0,
      },
    };
    const nextCameraConfig = buildPreviewCameraConfigFromTransform(
      activeCameraClipAtPlayhead,
      nextTransform,
      viewport,
      nextOrbitCenter,
      editCameraSettingsRef.current,
    );
    if (!fromConfig || !nextCameraConfig) return false;

    stopGaussianFpsLook();
    stopGaussianKeyboardMovement();
    endGaussianWheelBatch();
    if (gaussianOrbitStart.current.clipId) {
      gaussianOrbitStart.current.clipId = null;
      setIsGaussianOrbiting(false);
      endSceneNavHistoryBatch();
    }
    if (gaussianPanStart.current.clipId) {
      gaussianPanStart.current.clipId = null;
      setIsGaussianPanning(false);
      endSceneNavHistoryBatch();
    }
    setIsEditCameraOrthoPanning(false);
    containerRef.current?.focus({ preventScroll: true });

    editCameraOrbitCenterRef.current = nextOrbitCenter;
    editCameraTransformRef.current = nextTransform;
    let toConfig: SceneCameraConfig = nextCameraConfig;
    if (editCameraOrthoMode) {
      const baseFrame = activeEditCameraOrthoFrame
        ?? createDefaultEditCameraOrthoFrame(editCameraOrthoMode, activeCameraClipAtPlayhead.id, nextCameraConfig);
      const nextFrame: EditCameraOrthoFrame = {
        ...baseFrame,
        clipId: activeCameraClipAtPlayhead.id,
        mode: editCameraOrthoMode,
        center: cloneSceneVector(nextOrbitCenter),
      };
      editCameraViewTransitionRef.current = true;
      setEditCameraOrthoFrame(nextFrame);
      toConfig = buildEditCameraOrthographicConfig(editCameraOrthoMode, nextFrame, nextCameraConfig);
    }

    animatePreviewCameraOverride(fromConfig, toConfig, false);
    engine.requestRender();
    return true;
  }, [
    activeCameraClipAtPlayhead,
    activeEditCameraOrthoFrame,
    animatePreviewCameraOverride,
    editCameraModeActive,
    editCameraOrthoMode,
    effectiveResolution.height,
    effectiveResolution.width,
    endGaussianWheelBatch,
    endSceneNavHistoryBatch,
    getEditSceneCameraConfig,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

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

    const clipSource = navigationSceneNavClip.source;
    if (!clipSource || clipSource.type !== 'camera') {
      stopGaussianKeyboardMovement();
      return;
    }
    const timelineState = useTimelineStore.getState();
    const cameraSettings = editCameraModeActiveRef.current && navigationSceneNavClip.id === editCameraClipIdRef.current
      ? editCameraSettingsRef.current
      : timelineState.getInterpolatedCameraSettings(
          navigationSceneNavClip.id,
          timelineState.playheadPosition - navigationSceneNavClip.startTime,
        );
    const frame = resolveOrbitCameraFrame(
      freshTransform,
      {
        nearPlane: cameraSettings.near,
        farPlane: cameraSettings.far,
        fov: cameraSettings.fov,
        minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
      },
      { width: effectiveResolution.width, height: effectiveResolution.height },
    );
    const keyboardMoveSpeed = effectiveSceneNavFpsMode ? sceneNavFpsMoveSpeed : 1;
    const panStep = 0.9 * dt * keyboardMoveSpeed;
    const forwardStep = Math.max(0.15, frame.distance * 0.85) * dt * keyboardMoveSpeed;
    const positionDelta = addSceneVectors(
      addSceneVectors(
        scaleSceneVector(frame.right, rightInput * panStep),
        scaleSceneVector(frame.cameraUp, upInput * panStep),
      ),
      scaleSceneVector(frame.forward, forwardInput * forwardStep),
    );

    applyNavigationCameraValues(navigationSceneNavClip, {
      positionX: freshTransform.position.x + positionDelta.x,
      positionY: freshTransform.position.y + positionDelta.y,
      positionZ: freshTransform.position.z + positionDelta.z,
    });

    gaussianKeyboardFrameRef.current = window.requestAnimationFrame(tickGaussianKeyboardMovement);
  }, [
    applyNavigationCameraValues,
    finishGaussianKeyboardBatch,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    sceneNavFpsMoveSpeed,
    effectiveResolution.height,
    effectiveResolution.width,
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
    setIsEditCameraOrthoPanning(false);
  }, [stopGaussianFpsLook, stopGaussianKeyboardMovement]);

  useEffect(() => {
    if (!editCameraModeActive) return;

    const handleEditCameraViewShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTextEntryTarget(event.target)) return;

      const mode = getEditCameraViewModeFromKey(event);
      if (!mode) return;
      if (!isPreviewShortcutTarget()) return;

      event.preventDefault();
      event.stopPropagation();
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
      setEditCameraView(mode);
      containerRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', handleEditCameraViewShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleEditCameraViewShortcut, { capture: true });
  }, [
    editCameraModeActive,
    isPreviewShortcutTarget,
    setEditCameraView,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
  ]);

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
      const {
        clipId,
        x,
        y,
        pitch,
        yaw,
        roll,
        startPosX,
        startPosY,
        startPosZ,
        pivotX,
        pivotY,
        pivotZ,
        radius,
      } = gaussianOrbitStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const nextPitch = pitch + dy * 0.25;
      const nextYaw = yaw - dx * 0.25;
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);

      let nextPosition = { x: startPosX, y: startPosY, z: startPosZ };
      if (solveSettings && radius > 1e-6) {
        const frame = resolveOrbitCameraFrame(
          {
            position: { x: startPosX, y: startPosY, z: startPosZ },
            scale: { all: 1, x: 1, y: 1 },
            rotation: { x: nextPitch, y: nextYaw, z: roll },
          },
          solveSettings.settings,
          { width: effectiveResolution.width, height: effectiveResolution.height },
          solveSettings.sceneBounds,
        );
        nextPosition = {
          x: pivotX - frame.forward.x * radius,
          y: pivotY - frame.forward.y * radius,
          z: pivotZ - frame.forward.z * radius,
        };
      }

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: nextPosition.x,
        positionY: nextPosition.y,
        positionZ: nextPosition.z,
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
  }, [
    applyNavigationCameraValues,
    effectiveResolution.height,
    effectiveResolution.width,
    endSceneNavHistoryBatch,
    getSceneNavSolveSettings,
    isGaussianOrbiting,
    navigationSceneNavClip,
  ]);

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
        positionZ: nextTranslation.positionZ,
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
      const { clipId, x, y, panX, panY, panZ } = gaussianPanStart.current;
      if (!clipId) return;
      if (!navigationSceneNavClip || navigationSceneNavClip.id !== clipId) return;

      const dx = e.clientX - x;
      const dy = e.clientY - y;
      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
      if (!freshTransform || !solveSettings) return;

      const frame = resolveOrbitCameraFrame(
        {
          ...freshTransform,
          position: { x: panX, y: panY, z: panZ },
        },
        solveSettings.settings,
        { width: effectiveResolution.width, height: effectiveResolution.height },
        solveSettings.sceneBounds,
      );
      const worldPerPixel = (2 * frame.distance * Math.tan(((frame.fovDegrees * Math.PI) / 180) * 0.5)) /
        Math.max(1, effectiveResolution.height);
      const positionDelta = addSceneVectors(
        scaleSceneVector(frame.right, -dx * worldPerPixel),
        scaleSceneVector(frame.cameraUp, dy * worldPerPixel),
      );

      applyNavigationCameraValues(navigationSceneNavClip, {
        positionX: panX + positionDelta.x,
        positionY: panY + positionDelta.y,
        positionZ: panZ + positionDelta.z,
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
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
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

  const exportPreviewDisplaySize = useMemo(() => {
    if (!exportPreviewFrame || containerSize.width <= 0 || containerSize.height <= 0) {
      return canvasSize;
    }

    const frameAspect = exportPreviewFrame.width / Math.max(1, exportPreviewFrame.height);
    const containerAspect = containerSize.width / Math.max(1, containerSize.height);
    if (containerAspect > frameAspect) {
      const height = containerSize.height;
      return { width: Math.floor(height * frameAspect), height: Math.floor(height) };
    }

    const width = containerSize.width;
    return { width: Math.floor(width), height: Math.floor(width / frameAspect) };
  }, [
    canvasSize,
    containerSize.height,
    containerSize.width,
    exportPreviewFrame,
  ]);

  usePreviewViewport({
    containerRef,
    effectiveResolution,
    exportPreviewCanvasRef,
    exportPreviewFrame,
    isExporting,
    setCanvasSize,
    setContainerSize,
  });

  const zoomEditCameraOrthoView = useCallback((e: PreviewWheelEvent): boolean => {
    if (!editCameraOrthoViewActive || !activeEditCameraOrthoFrame || !editCameraOrthoMode) return false;
    if (!isCanvasInteractionTarget(e.target)) return false;

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return false;

    e.preventDefault();
    const current = activeEditCameraOrthoFrame;
    const basis = getEditCameraOrthoBasis(editCameraOrthoMode);
    const aspect = Math.max(0.001, canvasSize.width / Math.max(1, canvasSize.height));
    const mouseX = Math.max(0, Math.min(canvasRect.width, e.clientX - canvasRect.left));
    const mouseY = Math.max(0, Math.min(canvasRect.height, e.clientY - canvasRect.top));
    const zoomFactor = Math.exp(e.deltaY * 0.0025);
    const nextScale = clampEditCameraOrthoScale(current.scale * zoomFactor);
    const currentRightOffset = (mouseX / canvasRect.width - 0.5) * current.scale * aspect;
    const currentUpOffset = (0.5 - mouseY / canvasRect.height) * current.scale;
    const nextRightOffset = (mouseX / canvasRect.width - 0.5) * nextScale * aspect;
    const nextUpOffset = (0.5 - mouseY / canvasRect.height) * nextScale;
    const worldUnderPointer = addSceneVectors(
      addSceneVectors(current.center, scaleSceneVector(basis.right, currentRightOffset)),
      scaleSceneVector(basis.up, currentUpOffset),
    );
    const nextCenter = addSceneVectors(
      addSceneVectors(worldUnderPointer, scaleSceneVector(basis.right, -nextRightOffset)),
      scaleSceneVector(basis.up, -nextUpOffset),
    );

    setEditCameraOrthoFrame({
      ...current,
      center: nextCenter,
      scale: nextScale,
    });
    engine.requestRender();
    return true;
  }, [
    activeEditCameraOrthoFrame,
    canvasSize.height,
    canvasSize.width,
    editCameraOrthoMode,
    editCameraOrthoViewActive,
    isCanvasInteractionTarget,
  ]);

  useEffect(() => {
    if (!isEditCameraOrthoPanning) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const { x, y, center, scale, mode } = editCameraOrthoPanStart.current;
      const basis = getEditCameraOrthoBasis(mode);
      const worldPerPixel = scale / Math.max(1, canvasSize.height);
      const dx = event.clientX - x;
      const dy = event.clientY - y;
      const nextCenter = addSceneVectors(
        addSceneVectors(center, scaleSceneVector(basis.right, -dx * worldPerPixel)),
        scaleSceneVector(basis.up, dy * worldPerPixel),
      );

      setEditCameraOrthoFrame((current) => (
        current?.mode === mode
          ? { ...current, center: nextCenter }
          : current
      ));
      engine.requestRender();
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      setIsEditCameraOrthoPanning(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [canvasSize.height, isEditCameraOrthoPanning]);

  // Handle scene navigation and canvas zoom with the scroll wheel.
  const handleWheel = useCallback((e: PreviewWheelEvent) => {
    if (zoomEditCameraOrthoView(e)) {
      return;
    }

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

      e.preventDefault();
      scheduleGaussianWheelBatchEnd();

      const freshTransform = getFreshSceneNavTransform(navigationSceneNavClip);
      if (!freshTransform) return;

      const direction = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
      if (direction !== 0) {
        const timelineState = useTimelineStore.getState();
        const cameraSettings = editCameraModeActive && navigationSceneNavClip.id === editCameraClipIdRef.current
          ? editCameraSettingsRef.current
          : timelineState.getInterpolatedCameraSettings(
              navigationSceneNavClip.id,
              timelineState.playheadPosition - navigationSceneNavClip.startTime,
            );
        const frame = resolveOrbitCameraFrame(
          freshTransform,
          {
            nearPlane: cameraSettings.near,
            farPlane: cameraSettings.far,
            fov: cameraSettings.fov,
            minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
          },
          { width: effectiveResolution.width, height: effectiveResolution.height },
        );
        const wheelAmount = Math.abs(e.deltaY);
        const dollyStep = Math.max(0.02, frame.distance * (Math.exp(wheelAmount * 0.0025) - 1));
        const positionDelta = scaleSceneVector(frame.forward, direction * dollyStep);
        applyNavigationCameraValues(navigationSceneNavClip, {
          positionX: freshTransform.position.x + positionDelta.x,
          positionY: freshTransform.position.y + positionDelta.y,
          positionZ: freshTransform.position.z + positionDelta.z,
        });
      }
      return;
    }

    if (!freeCanvasNavigationMode || !containerRef.current) return;

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
    freeCanvasNavigationMode,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    getFreshSceneNavTransform,
    isCanvasInteractionTarget,
    scheduleGaussianWheelBatchEnd,
    applyNavigationCameraValues,
    setSceneNavFpsMoveSpeed,
    navigationSceneNavClip,
    editCameraModeActive,
    effectiveResolution.height,
    effectiveResolution.width,
    viewPan,
    viewZoom,
    zoomEditCameraOrthoView,
  ]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleNativeWheel = (event: WheelEvent) => {
      handleWheel(event);
    };

    element.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', handleNativeWheel, { capture: true });
  }, [handleWheel]);

  const toggleEditModeFromShortcut = useCallback(() => {
    if (!isPreviewShortcutTarget()) return;
    containerRef.current?.focus({ preventScroll: true });
    setEditMode(prev => !prev);
  }, [isPreviewShortcutTarget]);

  // Tab key to toggle edit mode (via shortcut registry)
  useShortcut('preview.editMode', toggleEditModeFromShortcut, { enabled: isEditableSource });

  // Handle scene navigation and edit-mode panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isCanvasInteractionTarget(e.target)) {
      containerRef.current?.focus({ preventScroll: true });
    }

    if (isSceneObjectInteractionTarget(e.target)) {
      return;
    }

    if (
      editCameraOrthoViewActive &&
      activeEditCameraOrthoFrame &&
      editCameraOrthoMode &&
      isCanvasInteractionTarget(e.target) &&
      (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey))
    ) {
      e.preventDefault();
      stopGaussianFpsLook();
      stopGaussianKeyboardMovement();
      editCameraOrthoPanStart.current = {
        x: e.clientX,
        y: e.clientY,
        center: cloneSceneVector(activeEditCameraOrthoFrame.center),
        scale: activeEditCameraOrthoFrame.scale,
        mode: editCameraOrthoMode,
      };
      setIsEditCameraOrthoPanning(true);
      return;
    }

    if (sceneNavEnabled && navigationSceneNavClip && isCanvasInteractionTarget(e.target)) {
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
          const solveSettings = getSceneNavSolveSettings(navigationSceneNavClip);
          const pivot = getSceneBoundsCenter(solveSettings?.sceneBounds);
          const radius = Math.hypot(
            freshTransform.position.x - pivot.x,
            freshTransform.position.y - pivot.y,
            freshTransform.position.z - pivot.z,
          );
          gaussianOrbitStart.current = {
            clipId: navigationSceneNavClip.id,
            x: e.clientX,
            y: e.clientY,
            pitch: freshTransform.rotation.x,
            yaw: freshTransform.rotation.y,
            roll: freshTransform.rotation.z,
            startPosX: freshTransform.position.x,
            startPosY: freshTransform.position.y,
            startPosZ: freshTransform.position.z,
            pivotX: pivot.x,
            pivotY: pivot.y,
            pivotZ: pivot.z,
            radius,
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
        };
        setIsGaussianPanning(true);
        return;
      }
    }

    if (!freeCanvasNavigationMode) return;

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
    activeEditCameraOrthoFrame,
    editCameraOrthoMode,
    editCameraOrthoViewActive,
    freeCanvasNavigationMode,
    endGaussianWheelBatch,
    sceneNavEnabled,
    effectiveSceneNavFpsMode,
    getFreshSceneNavTransform,
    getSceneNavSolveSettings,
    getSceneNavPointerLockTarget,
    isCanvasInteractionTarget,
    navigationSceneNavClip,
    startSceneNavHistoryBatch,
    stopGaussianFpsLook,
    stopGaussianKeyboardMovement,
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
    setIsEditCameraOrthoPanning(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if ((sceneNavEnabled || editCameraOrthoViewActive) && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [editCameraOrthoViewActive, sceneNavEnabled, isCanvasInteractionTarget]);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if ((sceneNavEnabled || editCameraOrthoViewActive) && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  }, [editCameraOrthoViewActive, sceneNavEnabled, isCanvasInteractionTarget]);

  // Reset view
  const resetView = useCallback(() => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }, []);

  const setPanelEditMode = useCallback((value: boolean) => {
    containerRef.current?.focus({ preventScroll: true });
    setEditMode(value);
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
      editMode: layerTransformMode, overlayRef, canvasSize, canvasInContainer, viewZoom,
      layers, clips, tracks, selectedLayerId, selectedClipId,
      selectClip, selectLayer, updateClipTransform, updateLayer,
      calculateLayerBounds, findLayerAtPosition, findHandleAtPosition,
    });

  // Calculate transform for zoomed/panned view
  const viewTransform = freeCanvasNavigationMode ? {
    transform: `scale(${viewZoom}) translate(${viewPan.x / viewZoom}px, ${viewPan.y / viewZoom}px)`,
  } : {};
  const showSceneObjectOverlay = sceneObjectOverlayEnabled && activeSharedSceneOverlayContent && isEditableSource && !isPlaying;
  const textPreviewEditorEnabled = Boolean(
    isEditableSource &&
    !sourceMonitorActive &&
    !isPlaying &&
    textClipEditMode &&
    textTypingActive &&
    !sceneNavEnabled &&
    selectedClip?.textProperties &&
    selectedTextLayer,
  );
  const sceneObjectOverlaySelectedClipId =
    editCameraModeActive &&
    editCameraOrthoViewActive &&
    selectedClipId === activeCameraClipAtPlayhead?.id
      ? null
      : selectedClipId;
  const editCameraGizmoTransform = editCameraModeActive && activeCameraClipAtPlayhead
    ? resolveCameraClipTransformAtPlayhead(activeCameraClipAtPlayhead)
    : null;
  const showPlaybackWaiter = Boolean(
    isEngineReady &&
    !sourceMonitorActive &&
    playbackWarmup
  );
  const playbackWaiterVideoCount = playbackWarmup?.pendingVideoCount ?? 0;
  const editCameraOrthoHint = editCameraOrthoViewActive && activeEditCameraOrthoFrame
    ? `${EDIT_CAMERA_VIEW_LABELS[activeEditCameraOrthoFrame.mode]} Ortho | 1 Front | 2 Side | 3 Top | 4 Camera | Wheel Zoom | Shift+Drag/MMB Pan`
    : null;
  const sceneObjectWorldGridPlane =
    editCameraModeActive && editCameraViewMode === 'front'
      ? 'xy'
      : editCameraModeActive && editCameraViewMode === 'side'
        ? 'yz'
        : 'xz';

  // #206: leave text typing when the selection changes or edit mode is exited.
  useEffect(() => {
    setTextTyping(false);
  }, [selectedClipId, editMode]);

  // #206: Escape returns from text typing to the layer transform handles.
  useEffect(() => {
    if (!textTyping) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setTextTyping(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [textTyping]);

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

      <PreviewCanvasMount
        activeSharedSceneOverlayContent={activeSharedSceneOverlayContent}
        activeSplatLoadProgress={activeSplatLoadProgress}
        canvasInContainer={canvasInContainer}
        canvasRef={canvasRef}
        canvasSize={canvasSize}
        canvasWrapperRef={canvasWrapperRef}
        clips={clips}
        closeSourceMonitor={closeSourceMonitor}
        containerSize={containerSize}
        displayedCompId={displayedCompId}
        dragHandle={dragHandle}
        dragMode={dragMode}
        editCameraClip={activeCameraClipAtPlayhead}
        editCameraGizmoTransform={editCameraGizmoTransform}
        editCameraModeActive={editCameraModeActive}
        editCameraOrthoHint={editCameraOrthoHint}
        editMode={editMode}
        effectiveResolution={effectiveResolution}
        effectiveSceneNavFpsMode={effectiveSceneNavFpsMode}
        engineInitError={engineInitError}
        engineInitFailed={engineInitFailed}
        engineStats={engineStats}
        exportPreviewCanvasRef={exportPreviewCanvasRef}
        exportPreviewDisplaySize={exportPreviewDisplaySize}
        exportPreviewFrame={exportPreviewFrame}
        focusEditCameraOnSceneObject={focusEditCameraOnSceneObject}
        getCursorForHandle={getCursorForHandle}
        handleOverlayMouseDown={handleOverlayMouseDown}
        handleOverlayMouseMove={handleOverlayMouseMove}
        handleOverlayMouseUp={handleOverlayMouseUp}
        hoverHandle={hoverHandle}
        isDragging={isDragging}
        isEditableSource={isEditableSource}
        isEngineReady={isEngineReady}
        isExporting={isExporting}
        layerTransformMode={layerTransformMode}
        maskEditMode={maskEditMode}
        maskNavigationMode={maskNavigationMode}
        maskPanelActive={maskPanelActive}
        overlayRef={overlayRef}
        playbackWaiterVideoCount={playbackWaiterVideoCount}
        previewCameraOverride={previewCameraOverride}
        previewQuality={previewQuality}
        qualityDropdownRef={qualityDropdownRef}
        qualityOpen={qualityOpen}
        sam2Active={sam2Active}
        sceneGizmoToolbarTarget={sceneGizmoToolbarTarget}
        sceneNavClipId={sceneNavClipId}
        sceneNavEnabled={sceneNavEnabled}
        sceneObjectOverlaySelectedClipId={sceneObjectOverlaySelectedClipId}
        selectClip={selectClip}
        selectedClip={selectedClip}
        selectedTextBounds={selectedTextBounds}
        selectedTextLayer={selectedTextLayer}
        setPropertyValue={setPropertyValue}
        setPreviewQuality={setPreviewQuality}
        setQualityOpen={setQualityOpen}
        setSceneGizmoToolbarTarget={setSceneGizmoToolbarTarget}
        setTextTyping={setTextTyping}
        showPlaybackWaiter={showPlaybackWaiter}
        showSceneObjectOverlay={showSceneObjectOverlay}
        showTransparencyGrid={showTransparencyGrid}
        sourceMonitorActive={sourceMonitorActive}
        sourceMonitorFile={sourceMonitorFile}
        sourceMonitorPlaybackRequestId={sourceMonitorPlaybackRequestId}
        statsExpanded={statsExpanded}
        textClipEditMode={textClipEditMode}
        textPreviewEditorEnabled={textPreviewEditorEnabled}
        textTypingActive={textTypingActive}
        toggleTransparency={toggleTransparency}
        tracks={tracks}
        updateTextBoundsVertex={updateTextBoundsVertex}
        updateTextBoundsVertices={updateTextBoundsVertices}
        updateTextProperties={updateTextProperties}
        viewTransform={viewTransform}
        viewZoom={viewZoom}
        worldGridPlane={sceneObjectWorldGridPlane}
        onToggleStats={() => setStatsExpanded(!statsExpanded)}
      />
    </div>
  );
}
