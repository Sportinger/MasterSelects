// Transform Tab - Position, Scale, Rotation, Opacity controls
import { useCallback } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
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

export function TransformTab({ clipId, transform, speed = 1, is3D = false }: TransformTabProps) {
  const { setPropertyValue, updateClipTransform, toggle3D, updateClip, hasKeyframes, isRecording, addKeyframe } = useTimelineStore.getState();
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

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const activeComp = useMediaStore.getState().getActiveComposition();
  const compWidth = activeComp?.width || 1920;
  const compHeight = activeComp?.height || 1080;

  const handlePropertyChange = (property: AnimatableProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  };

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
  const cameraMoveX = transform.position.x;
  const cameraMoveY = transform.position.y;
  const cameraMoveZ = transform.scale.z ?? 0;
  const cameraDist = transform.position.z;
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
  const handleCameraMoveXChange = (value: number) => handlePropertyChange('position.x', value);
  const handleCameraMoveYChange = (value: number) => handlePropertyChange('position.y', value);
  const handleCameraMoveZChange = (value: number) => handlePropertyChange('scale.z', value);
  const handleCameraDistChange = (value: number) => handlePropertyChange('position.z', value);
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
    );
    if (!updates) {
      handlePropertyChange(`rotation.${axis}` as AnimatableProperty, value);
      return;
    }

    applyCameraPropertyUpdates(updates);
  };

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
              ? 'Click preview, hold LMB to look, WASD/QE move, MMB/RMB/Shift+LMB pan, wheel speed while moving/looking, wheel zoom otherwise. Distance = orbit/dolly distance.'
              : 'Click preview, then WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel zoom. Distance = orbit/dolly distance.'}
          >
            <label className="prop-label">Nav Mode</label>
            <button
              className={`btn btn-xs ${sceneNavFpsMode ? 'btn-active' : ''}`}
              onClick={() => setSceneNavFpsMode(!sceneNavFpsMode)}
              title={sceneNavFpsMode ? 'Use orbit mouse look' : 'Use FPS mouse look'}
            >
              FPS
            </button>
            <button
              className={`btn btn-xs ${sceneNavNoKeyframes ? 'btn-active' : ''}`}
              onClick={() => setSceneNavNoKeyframes(!sceneNavNoKeyframes)}
              title="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
            >
              NO KF
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

      <div className="properties-section">
        <div className="control-row transform-param-row">
          <span className="keyframe-toggle-placeholder" />
          <label className="prop-label">{usesCameraControls ? 'Move' : 'Position'}</label>
          <div className="multi-value-row">
            <LabeledValue
              label={usesCameraControls ? 'Pan X' : 'X'}
              value={usesCameraControls ? cameraMoveX : posXValue}
              onChange={usesCameraControls ? handleCameraMoveXChange : handlePosXChange}
              defaultValue={0}
              decimals={positionDecimals}
              sensitivity={positionSensitivity}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={
                <KeyframeToggle clipId={clipId} property="position.x" value={usesCameraControls ? cameraMoveX : transform.position.x} />
              }
              midiTarget={createMIDIParameterTarget(
                'position.x',
                usesCameraControls ? 'Camera Pan X' : 'Position X',
                transform.position.x,
                usesCameraControls ? -5 : -2,
                usesCameraControls ? 5 : 2,
              )}
            />
            <LabeledValue
              label={usesCameraControls ? 'Pan Y' : 'Y'}
              value={usesCameraControls ? cameraMoveY : posYValue}
              onChange={usesCameraControls ? handleCameraMoveYChange : handlePosYChange}
              defaultValue={0}
              decimals={positionDecimals}
              sensitivity={positionSensitivity}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={
                <KeyframeToggle clipId={clipId} property="position.y" value={usesCameraControls ? cameraMoveY : transform.position.y} />
              }
              midiTarget={createMIDIParameterTarget(
                'position.y',
                usesCameraControls ? 'Camera Pan Y' : 'Position Y',
                transform.position.y,
                usesCameraControls ? -5 : -2,
                usesCameraControls ? 5 : 2,
              )}
            />
            {isEffectively3D && (
              <LabeledValue
                label={usesCameraControls ? 'Fwd' : 'Z'}
                value={usesCameraControls ? cameraMoveZ : posZValue}
                onChange={usesCameraControls ? handleCameraMoveZChange : handlePosZChange}
                defaultValue={0}
                decimals={positionDecimals}
                sensitivity={positionSensitivity}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
                keyframeToggle={
                  <KeyframeToggle
                    clipId={clipId}
                    property={usesCameraControls ? 'scale.z' : 'position.z'}
                    value={usesCameraControls ? cameraMoveZ : transform.position.z}
                  />
                }
                midiTarget={createMIDIParameterTarget(
                  usesCameraControls ? 'scale.z' : 'position.z',
                  usesCameraControls ? 'Camera Forward' : 'Position Z',
                  usesCameraControls ? cameraMoveZ : transform.position.z,
                  usesCameraControls ? -20 : -2,
                  usesCameraControls ? 20 : 2,
                )}
              />
            )}
          </div>
        </div>
      </div>

      {usesCameraControls && (
        <div className="properties-section">
          <div className="control-row transform-param-row">
            <span className="keyframe-toggle-placeholder" />
            <label className="prop-label">Distance</label>
            <LabeledValue
              label="Dist"
              value={cameraDist}
              onChange={handleCameraDistChange}
              defaultValue={0}
              decimals={3}
              sensitivity={0.02}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="position.z" value={cameraDist} />}
              midiTarget={createMIDIParameterTarget('position.z', 'Camera Distance', cameraDist, -20, 20)}
            />
          </div>
        </div>
      )}

      <div className="properties-section">
        <div className="control-row transform-param-row">
          <span className="keyframe-toggle-placeholder" />
          <label className="prop-label">{usesCameraControls ? 'Zoom' : 'Scale'}</label>
          <div className="multi-value-row">
            <LabeledValue
              label={usesCameraControls ? 'Zoom' : 'All'}
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
                usesCameraControls ? 'Camera Zoom' : 'Scale All',
                scaleAll,
                usesCameraControls ? 0.05 : 0.01,
                usesCameraControls ? 40 : 4,
              )}
            />
            {!usesCameraControls && (
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
            )}
            {!usesCameraControls && (
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
            )}
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

      <div className="properties-section">
        <div className="control-row transform-param-row">
          <span className="keyframe-toggle-placeholder" />
          <label className="prop-label">{usesCameraControls ? 'Look' : 'Rotation'}</label>
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

      <div className="properties-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            if (usesCameraControls) {
              updateClipTransform(clipId, {
                position: { x: 0, y: 0, z: 0 },
                scale: { all: 1, x: 1, y: 1, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
              });
              return;
            }

            updateClipTransform(clipId, {
              opacity: 1,
              blendMode: 'normal',
              position: { x: 0, y: 0, z: 0 },
              scale: supportsScaleZ ? { all: 1, x: 1, y: 1, z: 1 } : { all: 1, x: 1, y: 1 },
              rotation: { x: 0, y: 0, z: 0 },
            });
          }}
        >
          Reset All
        </button>
      </div>
    </div>
  );
}
