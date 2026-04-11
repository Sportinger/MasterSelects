// Transform Tab - Position, Scale, Rotation, Opacity controls
import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { useEngineStore } from '../../../stores/engineStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { BlendMode, AnimatableProperty } from '../../../types';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../../engine/gaussian/types';
import {
  KeyframeToggle,
  ScaleKeyframeToggle,
  PositionKeyframeToggle,
  RotationKeyframeToggle,
  DraggableNumber,
  BLEND_MODE_GROUPS,
  formatBlendModeName,
} from './shared';

interface TransformTabProps {
  clipId: string;
  transform: {
    opacity: number;
    blendMode: BlendMode;
    position: { x: number; y: number; z: number };
    scale: { x: number; y: number; z?: number };
    rotation: { x: number; y: number; z: number };
  };
  speed?: number;
  is3D?: boolean;
  hasKeyframes?: boolean;
}

function LabeledValue({ label, wip, ...props }: { label: string; wip?: boolean } & React.ComponentProps<typeof DraggableNumber>) {
  return (
    <div className="labeled-value">
      <span className="labeled-value-label">
        {label}
        {wip && <span className="menu-wip-badge">WIP</span>}
      </span>
      <DraggableNumber {...props} />
    </div>
  );
}

function RotationValue({ label, degrees, onChange, onDragStart, onDragEnd }: {
  label: string;
  degrees: number;
  onChange: (degrees: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const revolutions = Math.trunc(degrees / 360);
  const remainder = degrees - revolutions * 360;

  return (
    <div className="labeled-value rotation-value-ae">
      <span className="labeled-value-label">{label}</span>
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
  const { setPropertyValue, updateClipTransform, toggle3D, updateClip } = useTimelineStore.getState();
  const gaussianSplatNavClipId = useEngineStore((s) => s.gaussianSplatNavClipId);
  const setGaussianSplatNavClipId = useEngineStore((s) => s.setGaussianSplatNavClipId);
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const wireframe = clip?.wireframe ?? false;
  const sourceType = clip?.source?.type;
  const isModel = sourceType === 'model';
  const isCameraClip = sourceType === 'camera';
  const isGaussianSplat = sourceType === 'gaussian-splat';
  const renderSettings = clip?.source?.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
  const isNativeGaussianSplat = isGaussianSplat && renderSettings.useNativeRenderer === true;
  const supportsScaleZ = isModel || (isGaussianSplat && !isNativeGaussianSplat);
  const usesCameraControls = isCameraClip || isNativeGaussianSplat;
  const isLocked3D = isModel || isGaussianSplat;
  const isEffectively3D = usesCameraControls || isLocked3D || is3D;
  const gaussianNavEnabled = usesCameraControls && gaussianSplatNavClipId === clipId;

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const activeComp = useMediaStore.getState().getActiveComposition();
  const compWidth = activeComp?.width || 1920;
  const compHeight = activeComp?.height || 1080;

  const handlePropertyChange = (property: AnimatableProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  };

  const posXPx = transform.position.x * (compWidth / 2);
  const posYPx = transform.position.y * (compHeight / 2);
  const posZPx = transform.position.z * (compWidth / 2);
  const handlePosXChange = (px: number) => handlePropertyChange('position.x', px / (compWidth / 2));
  const handlePosYChange = (px: number) => handlePropertyChange('position.y', px / (compHeight / 2));
  const handlePosZChange = (px: number) => handlePropertyChange('position.z', px / (compWidth / 2));

  const scaleXPct = transform.scale.x * 100;
  const scaleYPct = transform.scale.y * 100;
  const scaleZPct = (transform.scale.z ?? 1) * 100;
  const uniformScalePct = (
    supportsScaleZ
      ? (transform.scale.x + transform.scale.y + (transform.scale.z ?? 1)) / 3
      : (transform.scale.x + transform.scale.y) / 2
  ) * 100;
  const handleScaleXChange = (pct: number) => handlePropertyChange('scale.x', pct / 100);
  const handleScaleYChange = (pct: number) => handlePropertyChange('scale.y', pct / 100);
  const handleScaleZChange = (pct: number) => handlePropertyChange('scale.z', pct / 100);
  const handleCameraZoomChange = (pct: number) => {
    const value = pct / 100;
    handlePropertyChange('scale.x', value);
    handlePropertyChange('scale.y', value);
  };
  const handleUniformScaleChange = (pct: number) => {
    const value = pct / 100;
    if (usesCameraControls) {
      handleCameraZoomChange(pct);
      return;
    }
    handlePropertyChange('scale.x', value);
    handlePropertyChange('scale.y', value);
    if (supportsScaleZ) handlePropertyChange('scale.z', value);
  };

  const opacityPct = transform.opacity * 100;
  const handleOpacityChange = (pct: number) => handlePropertyChange('opacity', Math.max(0, Math.min(100, pct)) / 100);
  const speedPct = speed * 100;
  const handleSpeedChange = (pct: number) => handlePropertyChange('speed', pct / 100);

  const cameraControlsHint = isCameraClip
    ? 'Scene cameras drive the shared 3D scene for splats and other 3D objects.'
    : 'Native gaussian splats use these controls as camera orbit, pan and zoom.';

  return (
    <div className="properties-tab-content transform-tab-compact">
      <div className="properties-section">
        {usesCameraControls && (
          <div className="control-row" style={{ color: '#8d99a6', fontSize: '11px' }}>
            {cameraControlsHint}
          </div>
        )}
        {usesCameraControls && (
          <div className="control-row">
            <label className="prop-label">Free Nav</label>
            <button
              className={`btn btn-xs ${gaussianNavEnabled ? 'btn-active' : ''}`}
              onClick={() => setGaussianSplatNavClipId(gaussianNavEnabled ? null : clipId)}
              title={gaussianNavEnabled ? 'Disable preview mouse navigation' : 'Enable preview mouse navigation'}
            >
              {gaussianNavEnabled ? 'On' : 'Off'}
            </button>
            <span style={{ color: '#8d99a6', fontSize: '11px' }}>LMB orbit, MMB/RMB/Shift+LMB pan, wheel zoom</span>
          </div>
        )}
        {!isCameraClip && (
          <div className="control-row">
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
        {!isCameraClip && (
          <div className="control-row">
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
          <div className="control-row">
            <KeyframeToggle clipId={clipId} property="opacity" value={transform.opacity} />
            <label className="prop-label">Opacity</label>
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
          <div className="control-row">
            <KeyframeToggle clipId={clipId} property="speed" value={speed} />
            <label className="prop-label">Speed <span className="menu-wip-badge">WIP</span></label>
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
        <div className="control-row">
          <PositionKeyframeToggle clipId={clipId} x={transform.position.x} y={transform.position.y} z={transform.position.z} />
          <label className="prop-label">{usesCameraControls ? 'Camera' : 'Position'}</label>
          <div className="multi-value-row">
            <LabeledValue
              label={usesCameraControls ? 'Pan X' : 'X'}
              value={posXPx}
              onChange={handlePosXChange}
              defaultValue={0}
              decimals={1}
              sensitivity={0.5}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
            />
            <LabeledValue
              label={usesCameraControls ? 'Pan Y' : 'Y'}
              value={posYPx}
              onChange={handlePosYChange}
              defaultValue={0}
              decimals={1}
              sensitivity={0.5}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
            />
            {isEffectively3D && (
              <LabeledValue
                label={usesCameraControls ? 'Dist' : 'Z'}
                value={posZPx}
                onChange={handlePosZChange}
                defaultValue={0}
                decimals={1}
                sensitivity={0.5}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
              />
            )}
          </div>
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <ScaleKeyframeToggle
            clipId={clipId}
            scaleX={transform.scale.x}
            scaleY={transform.scale.y}
            {...(supportsScaleZ ? { scaleZ: transform.scale.z ?? 1 } : {})}
          />
          <label className="prop-label">{usesCameraControls ? 'Zoom' : 'Scale'}</label>
          <div className="multi-value-row">
            <LabeledValue
              label={usesCameraControls ? 'Zoom' : 'All'}
              value={uniformScalePct}
              onChange={usesCameraControls ? handleCameraZoomChange : handleUniformScaleChange}
              defaultValue={100}
              decimals={1}
              suffix="%"
              min={1}
              sensitivity={1}
              onDragStart={handleBatchStart}
              onDragEnd={handleBatchEnd}
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
              />
            )}
          </div>
        </div>
      </div>

      <div className="properties-section">
        <div className="control-row">
          <RotationKeyframeToggle clipId={clipId} x={transform.rotation.x} y={transform.rotation.y} z={usesCameraControls ? 0 : transform.rotation.z} />
          <label className="prop-label">{usesCameraControls ? 'Orbit' : 'Rotation'}</label>
          <div className="multi-value-row rotation-row">
            {isEffectively3D && (
              <RotationValue
                label={usesCameraControls ? 'Pitch' : 'X'}
                degrees={transform.rotation.x}
                onChange={(value) => handlePropertyChange('rotation.x', value)}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
              />
            )}
            {isEffectively3D && (
              <RotationValue
                label={usesCameraControls ? 'Yaw' : 'Y'}
                degrees={transform.rotation.y}
                onChange={(value) => handlePropertyChange('rotation.y', value)}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
              />
            )}
            {!usesCameraControls && (
              <RotationValue
                label="Z"
                degrees={transform.rotation.z}
                onChange={(value) => handlePropertyChange('rotation.z', value)}
                onDragStart={handleBatchStart}
                onDragEnd={handleBatchEnd}
              />
            )}
          </div>
        </div>
      </div>

      <div className="properties-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            if (isCameraClip) {
              updateClipTransform(clipId, {
                position: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1 },
                rotation: { x: 0, y: 0, z: 0 },
              });
              return;
            }

            updateClipTransform(clipId, {
              opacity: 1,
              blendMode: 'normal',
              position: { x: 0, y: 0, z: 0 },
              scale: supportsScaleZ ? { x: 1, y: 1, z: 1 } : { x: 1, y: 1 },
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
