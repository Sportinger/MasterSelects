// Transform Tab - Position, Scale, Rotation, Opacity controls (AE-style compact layout)
import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import type { BlendMode, AnimatableProperty } from '../../../types';
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

// Labeled value cell: tiny axis label + draggable number
function LabeledValue({ label, wip, ...props }: { label: string; wip?: boolean } & React.ComponentProps<typeof DraggableNumber>) {
  return (
    <div className="labeled-value">
      <span className="labeled-value-label">{label}{wip && <span className="menu-wip-badge">🐛</span>}</span>
      <DraggableNumber {...props} />
    </div>
  );
}

// AE-style rotation: "2x +30.0°" — revolutions multiplier + remainder, both draggable
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
        suffix="°"
        sensitivity={0.5}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

export function TransformTab({ clipId, transform, speed = 1, is3D = false }: TransformTabProps) {
  const { setPropertyValue, updateClipTransform, toggle3D, updateClip } = useTimelineStore.getState();
  const wireframe = useTimelineStore(s => s.clips.find(c => c.id === clipId)?.wireframe ?? false);
  const isModel = useTimelineStore(s => s.clips.find(c => c.id === clipId)?.source?.type === 'model');

  const handleBatchStart = useCallback(() => startBatch('Adjust transform'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const activeComp = useMediaStore.getState().getActiveComposition();
  const compWidth = activeComp?.width || 1920;
  const compHeight = activeComp?.height || 1080;

  const handlePropertyChange = (property: AnimatableProperty, value: number) => {
    setPropertyValue(clipId, property, value);
  };

  // Position: normalized -> pixels
  const posXPx = transform.position.x * (compWidth / 2);
  const posYPx = transform.position.y * (compHeight / 2);
  const posZPx = transform.position.z * (compWidth / 2);
  const handlePosXChange = (px: number) => handlePropertyChange('position.x', px / (compWidth / 2));
  const handlePosYChange = (px: number) => handlePropertyChange('position.y', px / (compHeight / 2));
  const handlePosZChange = (px: number) => handlePropertyChange('position.z', px / (compWidth / 2));

  // Scale: multiplier -> percentage
  const scaleXPct = transform.scale.x * 100;
  const scaleYPct = transform.scale.y * 100;
  const scaleZPct = (transform.scale.z ?? 1) * 100;
  const uniformScalePct = ((transform.scale.x + transform.scale.y) / 2) * 100;
  const handleScaleXChange = (pct: number) => handlePropertyChange('scale.x', pct / 100);
  const handleScaleYChange = (pct: number) => handlePropertyChange('scale.y', pct / 100);
  const handleScaleZChange = (pct: number) => handlePropertyChange('scale.z', pct / 100);
  const handleUniformScaleChange = (pct: number) => {
    const v = pct / 100;
    handlePropertyChange('scale.x', v);
    handlePropertyChange('scale.y', v);
    if (isModel) handlePropertyChange('scale.z', v);
  };

  const opacityPct = transform.opacity * 100;
  const handleOpacityChange = (pct: number) => handlePropertyChange('opacity', Math.max(0, Math.min(100, pct)) / 100);
  const speedPct = speed * 100;
  const handleSpeedChange = (pct: number) => handlePropertyChange('speed', pct / 100);

  return (
    <div className="properties-tab-content transform-tab-compact">
      {/* 3D Toggle + Appearance + Time */}
      <div className="properties-section">
        <div className="control-row">
          <label className="prop-label">3D Layer</label>
          {isModel ? (
            <span className="btn btn-xs btn-active" style={{ cursor: 'default' }}>3D</span>
          ) : (
            <button
              className={`btn btn-xs ${is3D ? 'btn-active' : ''}`}
              onClick={() => toggle3D(clipId)}
              title={is3D ? 'Disable 3D layer' : 'Enable 3D layer'}
            >
              {is3D ? '3D' : '2D'}
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
        <div className="control-row">
          <KeyframeToggle clipId={clipId} property="opacity" value={transform.opacity} />
          <label className="prop-label">Opacity</label>
          <DraggableNumber value={opacityPct} onChange={handleOpacityChange}
            defaultValue={100} decimals={1} suffix="%" min={0} max={100} sensitivity={1}
            onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
        </div>
        <div className="control-row">
          <KeyframeToggle clipId={clipId} property="speed" value={speed} />
          <label className="prop-label">Speed <span className="menu-wip-badge">🐛</span></label>
          <DraggableNumber value={speedPct} onChange={handleSpeedChange}
            defaultValue={100} decimals={0} suffix="%" min={-400} max={400} sensitivity={1}
            onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
        </div>
      </div>

      {/* Position */}
      <div className="properties-section">
        <div className="control-row">
          <PositionKeyframeToggle clipId={clipId} x={transform.position.x} y={transform.position.y} z={transform.position.z} />
          <label className="prop-label">Position</label>
          <div className="multi-value-row">
            <LabeledValue label="X" value={posXPx} onChange={handlePosXChange}
              defaultValue={0} decimals={1} sensitivity={0.5}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            <LabeledValue label="Y" value={posYPx} onChange={handlePosYChange}
              defaultValue={0} decimals={1} sensitivity={0.5}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            {is3D && (
              <LabeledValue label="Z" value={posZPx} onChange={handlePosZChange}
                defaultValue={0} decimals={1} sensitivity={0.5}
                onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            )}
          </div>
        </div>
      </div>

      {/* Scale */}
      <div className="properties-section">
        <div className="control-row">
          <ScaleKeyframeToggle clipId={clipId} scaleX={transform.scale.x} scaleY={transform.scale.y} />
          <label className="prop-label">Scale</label>
          <div className="multi-value-row">
            <LabeledValue label="All" value={uniformScalePct} onChange={handleUniformScaleChange}
              defaultValue={100} decimals={1} suffix="%" min={1} sensitivity={1}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            <LabeledValue label="X" value={scaleXPct} onChange={handleScaleXChange}
              defaultValue={100} decimals={1} suffix="%" min={1} sensitivity={1}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            <LabeledValue label="Y" value={scaleYPct} onChange={handleScaleYChange}
              defaultValue={100} decimals={1} suffix="%" min={1} sensitivity={1}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            {isModel && (
              <LabeledValue label="Z" value={scaleZPct} onChange={handleScaleZChange}
                defaultValue={100} decimals={1} suffix="%" min={1} sensitivity={1}
                onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            )}
          </div>
        </div>
      </div>

      {/* Rotation -- AE-style: Nx + remainder degrees */}
      <div className="properties-section">
        <div className="control-row">
          <RotationKeyframeToggle clipId={clipId} x={transform.rotation.x} y={transform.rotation.y} z={transform.rotation.z} />
          <label className="prop-label">Rotation</label>
          <div className="multi-value-row rotation-row">
            {is3D && (
              <RotationValue label="X" degrees={transform.rotation.x}
                onChange={(v) => handlePropertyChange('rotation.x', v)}
                onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            )}
            {is3D && (
              <RotationValue label="Y" degrees={transform.rotation.y}
                onChange={(v) => handlePropertyChange('rotation.y', v)}
                onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
            )}
            <RotationValue label="Z" degrees={transform.rotation.z}
              onChange={(v) => handlePropertyChange('rotation.z', v)}
              onDragStart={handleBatchStart} onDragEnd={handleBatchEnd} />
          </div>
        </div>
      </div>

      {/* Reset */}
      <div className="properties-actions">
        <button className="btn btn-sm" onClick={() => {
          updateClipTransform(clipId, {
            opacity: 1, blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
          });
        }}>Reset All</button>
      </div>
    </div>
  );
}
