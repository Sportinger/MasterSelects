// Transform Tab - Position, Scale, Rotation, Opacity controls
import { useCallback } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../../stores/mediaStore/types';
import {
  CAMERA_POSE_TRANSFORM_PROPERTIES,
  buildCameraTransformPatchFromUpdates,
  resolveCameraLookAtFixedEyeUpdates,
  type CameraLookRotationAxis,
} from '../../../engine/scene/CameraClipControlUtils';
import {
  SCENE_NAV_FPS_MOVE_SPEED_STEPS,
  getSceneNavFpsMoveSpeedStepIndex,
  selectSceneNavFpsMode,
  selectSceneNavFpsMoveSpeed,
  selectSceneNavNoKeyframes,
  useEngineStore,
} from '../../../stores/engineStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { BlendMode, AnimatableProperty } from '../../../types';
import type { MIDIParameterTarget } from '../../../types/midi';
import {
  KeyframeToggle,
  DraggableNumber,
} from './shared';
import { BLEND_MODE_GROUPS, formatBlendModeName } from './sharedConstants';
import { MIDIParameterLabel } from './MIDIParameterLabel';
import {
  MAX_CAMERA_FOV_DEGREES,
  MIN_CAMERA_FOV_DEGREES,
  clampCameraFov,
  fovToFullFrameFocalLengthMm,
  fullFrameFocalLengthMmToFov,
} from '../../../utils/cameraLens';

const CAMERA_TRANSFORM_KEYFRAME_PROPERTIES: AnimatableProperty[] = [
  'camera.fov',
  'camera.near',
  'camera.far',
  'camera.resolutionWidth',
  'camera.resolutionHeight',
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
];

const CAMERA_RESET_KEYFRAME_PROPERTIES: AnimatableProperty[] = [
  ...CAMERA_TRANSFORM_KEYFRAME_PROPERTIES,
  'scale.all',
  'scale.x',
  'scale.y',
  'scale.z',
];

interface TransformTabProps {
  clipId: string;
  transform: {
    opacity: number;
    blendMode: BlendMode;
    position: { x: number; y: number; z: number };
    scale: { all?: number; x: number; y: number; z?: number };
    rotation: { x: number; y: number; z: number };
  };
  speed?: number;
  is3D?: boolean;
  hasKeyframes?: boolean;
  cameraSettings?: SceneCameraSettings;
}

function LabeledValue({
  label,
  wip,
  midiTarget,
  keyframeToggle,
  ...props
}: {
  label: string;
  wip?: boolean;
  midiTarget?: MIDIParameterTarget | null;
  keyframeToggle?: ReactNode;
} & ComponentProps<typeof DraggableNumber>) {
  return (
    <div className={`labeled-value ${keyframeToggle ? 'with-keyframe-toggle' : ''}`}>
      {keyframeToggle}
      <MIDIParameterLabel as="span" className="labeled-value-label" target={midiTarget}>
        {label}
        {wip && <span className="menu-wip-badge">WIP</span>}
      </MIDIParameterLabel>
      <DraggableNumber {...props} />
    </div>
  );
}

function RotationValue({ label, degrees, onChange, onDragStart, onDragEnd, midiTarget, keyframeToggle }: {
  label: string;
  degrees: number;
  onChange: (degrees: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  midiTarget?: MIDIParameterTarget | null;
  keyframeToggle?: ReactNode;
}) {
  const revolutions = Math.trunc(degrees / 360);
  const remainder = degrees - revolutions * 360;

  return (
    <div className={`labeled-value rotation-value-ae ${keyframeToggle ? 'with-keyframe-toggle' : ''}`}>
      {keyframeToggle}
      <MIDIParameterLabel as="span" className="labeled-value-label" target={midiTarget}>
        {label}
      </MIDIParameterLabel>
      <DraggableNumber
        value={revolutions}
        onChange={(rev) => onChange(Math.round(rev) * 360 + remainder)}
        defaultValue={0}
        decimals={0}
        suffix="x"
        sensitivity={4}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <DraggableNumber
        value={remainder}
        onChange={(rem) => onChange(revolutions * 360 + rem)}
        defaultValue={0}
        decimals={1}
        suffix="deg"
        sensitivity={0.5}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

function SetAllKeyframesIcon() {
  return (
    <svg className="scene-nav-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2.5 6.4 5 4 7.5 1.6 5 4 2.5Z" />
      <path d="M4 8.5 6.4 11 4 13.5 1.6 11 4 8.5Z" />
      <path d="M10 2.5 12.4 5 10 7.5 7.6 5 10 2.5Z" />
      <path d="M12 9.2v5.2M9.4 11.8h5.2" />
    </svg>
  );
}

function FpsModeIcon() {
  return (
    <svg className="scene-nav-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 6V3h3" />
      <path d="M10 3h3v3" />
      <path d="M13 10v3h-3" />
      <path d="M6 13H3v-3" />
      <path d="M8 5.2v5.6" />
      <path d="M5.2 8h5.6" />
    </svg>
  );
}

function NoKeyframesIcon() {
  return (
    <svg className="scene-nav-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6.4 2.8 10.2 6.6 6.4 10.4 2.6 6.6 6.4 2.8Z" />
      <path d="M2.4 13.6 13.6 2.4" />
      <path d="M11.2 10.8h3.2" />
      <path d="M12.8 9.2v3.2" />
    </svg>
  );
}

function ResetAllIcon() {
  return (
    <svg className="scene-nav-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M12.8 5.4A5 5 0 1 0 13 10" />
      <path d="M12.8 2.2v3.2H9.6" />
    </svg>
  );
}

export function TransformTab({
  clipId,
  transform,
  speed = 1,
  is3D = false,
  cameraSettings: cameraSettingsOverride,
}: TransformTabProps) {
  const {
    setPropertyValue,
    updateClipTransform,
    toggle3D,
    updateClip,
    hasKeyframes,
    isRecording,
    addKeyframe,
    removeKeyframe,
    getClipKeyframes,
    toggleKeyframeRecording,
  } = useTimelineStore.getState();
  const sceneNavFpsMode = useEngineStore(selectSceneNavFpsMode);
  const sceneNavFpsMoveSpeed = useEngineStore(selectSceneNavFpsMoveSpeed);
  const sceneNavNoKeyframes = useEngineStore(selectSceneNavNoKeyframes);
  const setSceneNavFpsMode = useEngineStore((s) => s.setSceneNavFpsMode);
  const setSceneNavFpsMoveSpeed = useEngineStore((s) => s.setSceneNavFpsMoveSpeed);
  const setSceneNavNoKeyframes = useEngineStore((s) => s.setSceneNavNoKeyframes);
  const sceneNavFpsMoveSpeedIndex = getSceneNavFpsMoveSpeedStepIndex(sceneNavFpsMoveSpeed);
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const wireframe = clip?.wireframe ?? false;
  const sourceType = clip?.source?.type;
  const isModel = sourceType === 'model';
  const isCameraClip = sourceType === 'camera';
  const isGaussianSplat = sourceType === 'gaussian-splat';
  const isSplatEffector = sourceType === 'splat-effector';
  const supportsThreeDEffectorToggle = isModel || isGaussianSplat;
  const canToggleThreeDEffectors = supportsThreeDEffectorToggle;
  const threeDEffectorsEnabled = clip?.source?.threeDEffectorsEnabled !== false;
  const supportsScaleZ = isModel || isSplatEffector || isGaussianSplat;
  const usesCameraControls = isCameraClip;
  const isLocked3D = isModel || isGaussianSplat || isSplatEffector;
  const isEffectively3D = isCameraClip || isLocked3D || is3D;
  const cameraSettings: SceneCameraSettings = isCameraClip
    ? (cameraSettingsOverride ?? clip?.source?.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS)
    : DEFAULT_SCENE_CAMERA_SETTINGS;
  const cameraFocalLengthMm = fovToFullFrameFocalLengthMm(cameraSettings.fov);
  const minCameraFocalLengthMm = fovToFullFrameFocalLengthMm(MAX_CAMERA_FOV_DEGREES);
  const maxCameraFocalLengthMm = fovToFullFrameFocalLengthMm(MIN_CAMERA_FOV_DEGREES);
  const cameraResolutionWidth = cameraSettings.resolutionWidth ?? DEFAULT_SCENE_CAMERA_SETTINGS.resolutionWidth ?? 1920;
  const cameraResolutionHeight = cameraSettings.resolutionHeight ?? DEFAULT_SCENE_CAMERA_SETTINGS.resolutionHeight ?? 1080;

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const activeComp = useMediaStore.getState().getActiveComposition();
  const compWidth = activeComp?.width || 1920;
  const compHeight = activeComp?.height || 1080;

  const handlePropertyChange = useCallback((property: AnimatableProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  }, [clipId, setPropertyValue]);

  const applyCameraPropertyUpdates = (updates: Array<{ property: AnimatableProperty; value: number }>) => {
    const needsKeyframePath = updates.some(({ property }) =>
      hasKeyframes(clipId, property) || isRecording(clipId, property),
    ) || CAMERA_POSE_TRANSFORM_PROPERTIES.some((property) =>
      hasKeyframes(clipId, property) || isRecording(clipId, property),
    );

    if (needsKeyframePath) {
      updates.forEach(({ property, value }) => addKeyframe(clipId, property, value));
      return;
    }

    updateClipTransform(clipId, buildCameraTransformPatchFromUpdates(transform, updates));
  };

  const createMIDIParameterTarget = useCallback((
    property: string,
    label: string,
    currentValue: number,
    min?: number,
    max?: number,
    properties?: string[],
  ): MIDIParameterTarget => ({
      clipId,
      property,
      properties,
      label: `${clip?.name ?? 'Clip'} / ${label}`,
      currentValue,
      min,
      max,
    }),
    [clip?.name, clipId],
  );

  const posXPx = transform.position.x * (compWidth / 2);
  const posYPx = transform.position.y * (compHeight / 2);
  const posZPx = transform.position.z * (compWidth / 2);
  const usesScenePositionUnits = isEffectively3D && !usesCameraControls;
  const posXValue = usesScenePositionUnits ? transform.position.x : posXPx;
  const posYValue = usesScenePositionUnits ? transform.position.y : posYPx;
  const posZValue = usesScenePositionUnits ? transform.position.z : posZPx;
  const positionDecimals = usesScenePositionUnits || usesCameraControls ? 3 : 1;
  const positionSensitivity = usesScenePositionUnits || usesCameraControls ? 0.02 : 0.5;
  const cameraPositionX = transform.position.x;
  const cameraPositionY = transform.position.y;
  const cameraPositionZ = transform.position.z;
  const scaleAll = transform.scale.all ?? 1;
  const handlePosXChange = (value: number) => handlePropertyChange(
    'position.x',
    usesScenePositionUnits ? value : value / (compWidth / 2),
  );
  const handlePosYChange = (value: number) => handlePropertyChange(
    'position.y',
    usesScenePositionUnits ? value : value / (compHeight / 2),
  );
  const handlePosZChange = (value: number) => handlePropertyChange(
    'position.z',
    usesScenePositionUnits ? value : value / (compWidth / 2),
  );
  const handleCameraPositionXChange = (value: number) => handlePropertyChange('position.x', value);
  const handleCameraPositionYChange = (value: number) => handlePropertyChange('position.y', value);
  const handleCameraPositionZChange = (value: number) => handlePropertyChange('position.z', value);
  const handleCameraFovChange = useCallback((value: number) => {
    handlePropertyChange('camera.fov', clampCameraFov(value));
  }, [handlePropertyChange]);
  const handleCameraFocalLengthChange = useCallback((value: number) => {
    handlePropertyChange('camera.fov', fullFrameFocalLengthMmToFov(value));
  }, [handlePropertyChange]);
  const handleCameraNearChange = useCallback((value: number) => {
    handlePropertyChange('camera.near', Math.max(0.001, value));
  }, [handlePropertyChange]);
  const handleCameraFarChange = useCallback((value: number) => {
    handlePropertyChange('camera.far', Math.max(cameraSettings.near + 0.1, value));
  }, [cameraSettings.near, handlePropertyChange]);
  const handleCameraResolutionWidthChange = useCallback((value: number) => {
    handlePropertyChange('camera.resolutionWidth', Math.max(1, Math.round(value)));
  }, [handlePropertyChange]);
  const handleCameraResolutionHeightChange = useCallback((value: number) => {
    handlePropertyChange('camera.resolutionHeight', Math.max(1, Math.round(value)));
  }, [handlePropertyChange]);
  const handleCameraLookRotationChange = (axis: CameraLookRotationAxis, value: number) => {
    if (!clip || clip.source?.type !== 'camera') {
      handlePropertyChange(`rotation.${axis}` as AnimatableProperty, value);
      return;
    }

    const updates = resolveCameraLookAtFixedEyeUpdates(
      clip,
      transform,
      { [axis]: value },
      { width: compWidth, height: compHeight },
      cameraSettings,
    );
    if (!updates) {
      handlePropertyChange(`rotation.${axis}` as AnimatableProperty, value);
      return;
    }

    applyCameraPropertyUpdates(updates);
  };

  const handleSetAllCameraKeyframes = useCallback(() => {
    if (!usesCameraControls) return;

    const entries: Array<{ property: AnimatableProperty; value: number }> = [
      { property: 'camera.fov', value: cameraSettings.fov },
      { property: 'camera.near', value: cameraSettings.near },
      { property: 'camera.far', value: cameraSettings.far },
      { property: 'camera.resolutionWidth', value: cameraResolutionWidth },
      { property: 'camera.resolutionHeight', value: cameraResolutionHeight },
      { property: 'position.x', value: transform.position.x },
      { property: 'position.y', value: transform.position.y },
      { property: 'position.z', value: transform.position.z },
      { property: 'rotation.x', value: transform.rotation.x },
      { property: 'rotation.y', value: transform.rotation.y },
      { property: 'rotation.z', value: transform.rotation.z },
    ];

    startBatch('Set camera keyframes');
    try {
      entries.forEach(({ property, value }) => {
        if (!isRecording(clipId, property)) {
          toggleKeyframeRecording(clipId, property);
        }
        addKeyframe(clipId, property, value);
      });
    } finally {
      endBatch();
    }
  }, [
    addKeyframe,
    cameraResolutionHeight,
    cameraResolutionWidth,
    cameraSettings.far,
    cameraSettings.fov,
    cameraSettings.near,
    clipId,
    isRecording,
    toggleKeyframeRecording,
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    usesCameraControls,
  ]);
  const clearCameraKeyframesAndStopwatches = useCallback(() => {
    const resetProperties = new Set(CAMERA_RESET_KEYFRAME_PROPERTIES);

    getClipKeyframes(clipId)
      .filter((keyframe) => resetProperties.has(keyframe.property))
      .forEach((keyframe) => removeKeyframe(keyframe.id));

    CAMERA_RESET_KEYFRAME_PROPERTIES.forEach((property) => {
      if (isRecording(clipId, property)) {
        toggleKeyframeRecording(clipId, property);
      }
    });
  }, [
    clipId,
    getClipKeyframes,
    isRecording,
    removeKeyframe,
    toggleKeyframeRecording,
  ]);
  const handleResetAll = useCallback(() => {
    if (usesCameraControls) {
      startBatch('Reset camera transform');
      try {
        clearCameraKeyframesAndStopwatches();
        updateClipTransform(clipId, {
          position: { x: 0, y: 0, z: 0 },
          scale: { all: 1, x: 1, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        });
      } finally {
        endBatch();
      }
      return;
    }

    updateClipTransform(clipId, {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: supportsScaleZ ? { all: 1, x: 1, y: 1, z: 1 } : { all: 1, x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }, [clearCameraKeyframesAndStopwatches, clipId, supportsScaleZ, updateClipTransform, usesCameraControls]);

  const scaleAllPct = scaleAll * 100;
  const scaleXPct = transform.scale.x * 100;
  const scaleYPct = transform.scale.y * 100;
  const scaleZPct = (transform.scale.z ?? 1) * 100;
  const handleScaleAllChange = (pct: number) => handlePropertyChange('scale.all', pct / 100);
  const handleScaleXChange = (pct: number) => handlePropertyChange('scale.x', pct / 100);
  const handleScaleYChange = (pct: number) => handlePropertyChange('scale.y', pct / 100);
  const handleScaleZChange = (pct: number) => handlePropertyChange('scale.z', pct / 100);

  const opacityPct = transform.opacity * 100;
  const handleOpacityChange = (pct: number) => handlePropertyChange('opacity', Math.max(0, Math.min(100, pct)) / 100);
  const speedPct = speed * 100;
  const handleSpeedChange = (pct: number) => handlePropertyChange('speed', pct / 100);
  const handleThreeDEffectorsToggle = useCallback(() => {
    if (!clip?.source) return;
    updateClip(clipId, {
      source: {
        ...clip.source,
        threeDEffectorsEnabled: !threeDEffectorsEnabled,
      },
    });
  }, [clip, clipId, threeDEffectorsEnabled, updateClip]);

  return (
    <div className="properties-tab-content transform-tab-compact">
      <div className="properties-section">
        {usesCameraControls && (
          <div
            className="control-row transform-option-row scene-nav-row"
            title={sceneNavFpsMode
              ? 'Click preview, hold LMB to look, WASD/QE move, MMB/RMB/Shift+LMB pan, wheel speed while moving/looking, wheel moves camera otherwise.'
              : 'Click preview, then WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel moves camera.'}
          >
            <label className="prop-label">Nav Mode</label>
            <button
              className={`btn btn-xs scene-nav-icon-btn ${sceneNavFpsMode ? 'btn-active' : ''}`}
              onClick={() => setSceneNavFpsMode(!sceneNavFpsMode)}
              title={sceneNavFpsMode ? 'Use orbit mouse look' : 'Use FPS mouse look'}
              aria-label={sceneNavFpsMode ? 'Use orbit mouse look' : 'Use FPS mouse look'}
            >
              <FpsModeIcon />
            </button>
            <button
              className={`btn btn-xs scene-nav-icon-btn ${sceneNavNoKeyframes ? 'btn-active' : ''}`}
              onClick={() => setSceneNavNoKeyframes(!sceneNavNoKeyframes)}
              title="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
              aria-label="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
            >
              <NoKeyframesIcon />
            </button>
            <button
              className="btn btn-xs scene-nav-icon-btn"
              onClick={handleSetAllCameraKeyframes}
              title="Enable all camera transform stopwatches and set keyframes at the playhead"
              aria-label="Enable all camera transform stopwatches and set keyframes at the playhead"
            >
              <SetAllKeyframesIcon />
            </button>
            <button
              className="btn btn-xs scene-nav-icon-btn"
              onClick={handleResetAll}
              title="Reset camera transform"
              aria-label="Reset camera transform"
            >
              <ResetAllIcon />
            </button>
            {sceneNavFpsMode && (
              <div className="scene-nav-speed-control" title="FPS movement speed">
                <input
                  type="range"
                  min={0}
                  max={SCENE_NAV_FPS_MOVE_SPEED_STEPS.length - 1}
                  step={1}
                  value={sceneNavFpsMoveSpeedIndex}
                  onChange={(event) => {
                    const speed = SCENE_NAV_FPS_MOVE_SPEED_STEPS[Number(event.target.value)];
                    if (speed !== undefined) setSceneNavFpsMoveSpeed(speed);
                  }}
                />
                <span>{sceneNavFpsMoveSpeed.toFixed(1)}x</span>
              </div>
            )}
          </div>
        )}
        {!isCameraClip && (
          <div className="control-row transform-option-row">
            <label className="prop-label">3D Layer</label>
            {isLocked3D ? (
              <span className="btn btn-xs btn-active" style={{ cursor: 'default' }}>3D</span>
            ) : (
              <button
                className={`btn btn-xs ${isEffectively3D ? 'btn-active' : ''}`}
                onClick={() => toggle3D(clipId)}
                title={isEffectively3D ? 'Disable 3D layer' : 'Enable 3D layer'}
              >
                {isEffectively3D ? '3D' : '2D'}
              </button>
            )}
            {isModel && (
              <button
                className={`btn btn-xs ${wireframe ? 'btn-active' : ''}`}
                onClick={() => updateClip(clipId, { wireframe: !wireframe })}
                title={wireframe ? 'Show solid' : 'Show wireframe'}
                style={wireframe ? { color: '#4488ff' } : undefined}
              >
                Wire
              </button>
            )}
          </div>
        )}
        {supportsThreeDEffectorToggle && (
          <div className="control-row transform-option-row">
            <label className="prop-label">3D Effector</label>
            {canToggleThreeDEffectors && (
              <button
                className={`btn btn-xs ${threeDEffectorsEnabled ? 'btn-active' : ''}`}
                onClick={handleThreeDEffectorsToggle}
                title={threeDEffectorsEnabled ? 'Disable 3D effector influence' : 'Enable 3D effector influence'}
              >
                {threeDEffectorsEnabled ? 'On' : 'Off'}
              </button>
            )}
          </div>
        )}
        {!isCameraClip && (
          <div className="control-row transform-option-row">
            <label className="prop-label">Blend</label>
            <select
              value={transform.blendMode}
              onChange={(e) => updateClipTransform(clipId, { blendMode: e.target.value as BlendMode })}
            >
              {BLEND_MODE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.modes.map((mode) => (
                    <option key={mode} value={mode}>{formatBlendModeName(mode)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {!isCameraClip && (
          <div className="control-row transform-param-row">
            <KeyframeToggle clipId={clipId} property="opacity" value={transform.opacity} />
            <MIDIParameterLabel
              as="label"
              className="prop-label"
              target={createMIDIParameterTarget('opacity', 'Opacity', transform.opacity, 0, 1)}
            >
              Opacity
            </MIDIParameterLabel>
            <DraggableNumber
              value={opacityPct}
              onChange={handleOpacityChange}
              defaultValue={100}
              decimals={1}
              suffix="%"
              min={0}
              max={100}
              sensitivity={1}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
            />
          </div>
        )}
        {!isCameraClip && (
          <div className="control-row transform-param-row">
            <KeyframeToggle clipId={clipId} property="speed" value={speed} />
            <MIDIParameterLabel
              as="label"
              className="prop-label"
              target={createMIDIParameterTarget('speed', 'Speed', speed, -4, 4)}
            >
              Speed <span className="menu-wip-badge">WIP</span>
            </MIDIParameterLabel>
            <DraggableNumber
              value={speedPct}
              onChange={handleSpeedChange}
              defaultValue={100}
              decimals={0}
              suffix="%"
              min={-400}
              max={400}
              sensitivity={1}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
            />
          </div>
        )}
      </div>

      {usesCameraControls && (
        <div className="properties-section">
          <div className="control-row transform-param-row">
            <span className="keyframe-toggle-placeholder" />
            <label className="prop-label">Lens</label>
            <div className="multi-value-row">
              <LabeledValue
                label="FOV"
                value={cameraSettings.fov}
                onChange={handleCameraFovChange}
                defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.fov}
                decimals={1}
                suffix="deg"
                min={MIN_CAMERA_FOV_DEGREES}
                max={MAX_CAMERA_FOV_DEGREES}
                sensitivity={0.5}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.fov" value={cameraSettings.fov} />}
                midiTarget={createMIDIParameterTarget(
                  'camera.fov',
                  'Camera FOV',
                  cameraSettings.fov,
                  MIN_CAMERA_FOV_DEGREES,
                  MAX_CAMERA_FOV_DEGREES,
                )}
              />
              <LabeledValue
                label="mm"
                value={cameraFocalLengthMm}
                onChange={handleCameraFocalLengthChange}
                defaultValue={fovToFullFrameFocalLengthMm(DEFAULT_SCENE_CAMERA_SETTINGS.fov)}
                decimals={1}
                suffix="mm"
                min={minCameraFocalLengthMm}
                max={maxCameraFocalLengthMm}
                sensitivity={0.5}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
              />
            </div>
          </div>
          <div className="control-row transform-param-row">
            <span className="keyframe-toggle-placeholder" />
            <label className="prop-label">Planes</label>
            <div className="multi-value-row">
              <LabeledValue
                label="Near"
                value={cameraSettings.near}
                onChange={handleCameraNearChange}
                defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.near}
                decimals={3}
                min={0.001}
                max={100}
                sensitivity={0.05}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.near" value={cameraSettings.near} />}
                midiTarget={createMIDIParameterTarget('camera.near', 'Camera Near', cameraSettings.near, 0.001, 100)}
              />
              <LabeledValue
                label="Far"
                value={cameraSettings.far}
                onChange={handleCameraFarChange}
                defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.far}
                decimals={1}
                min={1}
                max={100000}
                sensitivity={10}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.far" value={cameraSettings.far} />}
                midiTarget={createMIDIParameterTarget('camera.far', 'Camera Far', cameraSettings.far, 1, 100000)}
              />
            </div>
          </div>
          <div className="control-row transform-param-row">
            <span className="keyframe-toggle-placeholder" />
            <label className="prop-label">Res</label>
            <div className="multi-value-row">
              <LabeledValue
                label="X"
                value={cameraResolutionWidth}
                onChange={handleCameraResolutionWidthChange}
                defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.resolutionWidth ?? 1920}
                decimals={0}
                min={1}
                max={32768}
                sensitivity={16}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={
                  <KeyframeToggle
                    clipId={clipId}
                    property="camera.resolutionWidth"
                    value={cameraResolutionWidth}
                  />
                }
                midiTarget={createMIDIParameterTarget(
                  'camera.resolutionWidth',
                  'Camera Res X',
                  cameraResolutionWidth,
                  1,
                  32768,
                )}
              />
              <LabeledValue
                label="Y"
                value={cameraResolutionHeight}
                onChange={handleCameraResolutionHeightChange}
                defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.resolutionHeight ?? 1080}
                decimals={0}
                min={1}
                max={32768}
                sensitivity={16}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={
                  <KeyframeToggle
                    clipId={clipId}
                    property="camera.resolutionHeight"
                    value={cameraResolutionHeight}
                  />
                }
                midiTarget={createMIDIParameterTarget(
                  'camera.resolutionHeight',
                  'Camera Res Y',
                  cameraResolutionHeight,
                  1,
                  32768,
                )}
              />
            </div>
          </div>
        </div>
      )}

      <div className="properties-section">
        <div className="control-row transform-param-row">
          <span className="keyframe-toggle-placeholder" />
          <label className="prop-label">Position</label>
          <div className="multi-value-row">
            <LabeledValue
              label="X"
              value={usesCameraControls ? cameraPositionX : posXValue}
              onChange={usesCameraControls ? handleCameraPositionXChange : handlePosXChange}
              defaultValue={0}
              decimals={positionDecimals}
              sensitivity={positionSensitivity}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={
                <KeyframeToggle clipId={clipId} property="position.x" value={transform.position.x} />
              }
              midiTarget={createMIDIParameterTarget(
                'position.x',
                usesCameraControls ? 'Camera Position X' : 'Position X',
                transform.position.x,
                usesCameraControls ? -5 : -2,
                usesCameraControls ? 5 : 2,
              )}
            />
            <LabeledValue
              label="Y"
              value={usesCameraControls ? cameraPositionY : posYValue}
              onChange={usesCameraControls ? handleCameraPositionYChange : handlePosYChange}
              defaultValue={0}
              decimals={positionDecimals}
              sensitivity={positionSensitivity}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={
                <KeyframeToggle clipId={clipId} property="position.y" value={transform.position.y} />
              }
              midiTarget={createMIDIParameterTarget(
                'position.y',
                usesCameraControls ? 'Camera Position Y' : 'Position Y',
                transform.position.y,
                usesCameraControls ? -5 : -2,
                usesCameraControls ? 5 : 2,
              )}
            />
            {isEffectively3D && (
              <LabeledValue
                label="Z"
                value={usesCameraControls ? cameraPositionZ : posZValue}
                onChange={usesCameraControls ? handleCameraPositionZChange : handlePosZChange}
                defaultValue={0}
                decimals={positionDecimals}
                sensitivity={positionSensitivity}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={
                  <KeyframeToggle
                    clipId={clipId}
                    property="position.z"
                    value={transform.position.z}
                  />
                }
                midiTarget={createMIDIParameterTarget(
                  'position.z',
                  usesCameraControls ? 'Camera Position Z' : 'Position Z',
                  transform.position.z,
                  usesCameraControls ? -20 : -2,
                  usesCameraControls ? 20 : 2,
                )}
              />
            )}
          </div>
        </div>
      </div>

      {!usesCameraControls && (
        <div className="properties-section">
          <div className="control-row transform-param-row">
            <span className="keyframe-toggle-placeholder" />
            <label className="prop-label">Scale</label>
            <div className="multi-value-row">
              <LabeledValue
                label="All"
                value={scaleAllPct}
                onChange={handleScaleAllChange}
                defaultValue={100}
                decimals={1}
                suffix="%"
                min={1}
                sensitivity={1}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.all" value={scaleAll} />}
                midiTarget={createMIDIParameterTarget(
                  'scale.all',
                  'Scale All',
                  scaleAll,
                  0.01,
                  4,
                )}
              />
              <LabeledValue
                label="X"
                value={scaleXPct}
                onChange={handleScaleXChange}
                defaultValue={100}
                decimals={1}
                suffix="%"
                min={1}
                sensitivity={1}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.x" value={transform.scale.x} />}
                midiTarget={createMIDIParameterTarget('scale.x', 'Scale X', transform.scale.x, 0.01, 4)}
              />
              <LabeledValue
                label="Y"
                value={scaleYPct}
                onChange={handleScaleYChange}
                defaultValue={100}
                decimals={1}
                suffix="%"
                min={1}
                sensitivity={1}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.y" value={transform.scale.y} />}
                midiTarget={createMIDIParameterTarget('scale.y', 'Scale Y', transform.scale.y, 0.01, 4)}
              />
              {supportsScaleZ && (
                <LabeledValue
                  label="Z"
                  value={scaleZPct}
                  onChange={handleScaleZChange}
                  defaultValue={100}
                  decimals={1}
                  suffix="%"
                  min={1}
                  sensitivity={1}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                  keyframeToggle={<KeyframeToggle clipId={clipId} property="scale.z" value={transform.scale.z ?? 1} />}
                  midiTarget={createMIDIParameterTarget('scale.z', 'Scale Z', transform.scale.z ?? 1, 0.01, 4)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="properties-section">
        <div className="control-row transform-param-row">
          <span className="keyframe-toggle-placeholder" />
          <label className="prop-label">Rotation</label>
          <div className="multi-value-row rotation-row">
            {isEffectively3D && (
              <RotationValue
                label={usesCameraControls ? 'Pitch' : 'X'}
                degrees={transform.rotation.x}
                onChange={(value) => usesCameraControls
                  ? handleCameraLookRotationChange('x', value)
                  : handlePropertyChange('rotation.x', value)}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.x" value={transform.rotation.x} />}
                midiTarget={createMIDIParameterTarget(
                  'rotation.x',
                  usesCameraControls ? 'Camera Pitch' : 'Rotation X',
                  transform.rotation.x,
                  -360,
                  360,
                )}
              />
            )}
            {isEffectively3D && (
              <RotationValue
                label={usesCameraControls ? 'Yaw' : 'Y'}
                degrees={transform.rotation.y}
                onChange={(value) => usesCameraControls
                  ? handleCameraLookRotationChange('y', value)
                  : handlePropertyChange('rotation.y', value)}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.y" value={transform.rotation.y} />}
                midiTarget={createMIDIParameterTarget(
                  'rotation.y',
                  usesCameraControls ? 'Camera Yaw' : 'Rotation Y',
                  transform.rotation.y,
                  -360,
                  360,
                )}
              />
            )}
            <RotationValue
              label={usesCameraControls ? 'Roll' : 'Z'}
              degrees={transform.rotation.z}
              onChange={(value) => usesCameraControls
                ? handleCameraLookRotationChange('z', value)
                : handlePropertyChange('rotation.z', value)}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.z" value={transform.rotation.z} />}
              midiTarget={createMIDIParameterTarget(
                'rotation.z',
                usesCameraControls ? 'Camera Roll' : 'Rotation Z',
                transform.rotation.z,
                -360,
                360,
              )}
            />
          </div>
        </div>
      </div>

      {!usesCameraControls && (
        <div className="properties-actions">
          <button
            className="btn btn-sm"
            onClick={handleResetAll}
          >
            Reset All
          </button>
        </div>
      )}
    </div>
  );
}
