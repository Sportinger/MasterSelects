import { useEffect, useMemo, useState } from 'react';

import type { AnimatableProperty } from '../../../../types';
import {
  KeyframeToggle,
  MultiKeyframeToggle,
  ScaleKeyframeToggle,
} from '../shared';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveInspectorSection,
  ResolveLinkIcon,
  ResolveResetIcon,
} from '../resolveInspector/ResolveInspectorPrimitives';
import type { PositionValueContext } from './transformValues';
import type { CreateMidiTarget, TransformTabTransform } from './transformTabTypes';
import { LayerDimensionToggle } from './LayerModeControls';
import { LabeledValue } from './ValueControls';
import { AnchorPointRows } from './AnchorPointRows';
import { HandleOnlyRange } from './HandleOnlyRange';

interface ResolveTransformSectionProps {
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  enabled: boolean;
  isEffectively3D: boolean;
  isLocked3D: boolean;
  positionValues: PositionValueContext;
  showLayerDimensionToggle: boolean;
  supportsScaleZ: boolean;
  transform: TransformTabTransform;
  usesCameraControls: boolean;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onCameraPositionXChange: (value: number) => void;
  onCameraPositionYChange: (value: number) => void;
  onCameraPositionZChange: (value: number) => void;
  onCameraLookRotationChange: (axis: 'x' | 'y' | 'z', value: number) => void;
  onAnchorChange: (property: 'anchor.x' | 'anchor.y' | 'anchor.z', value: number) => void;
  onFitToFrame?: () => void;
  onFlipX: () => void;
  onFlipY: () => void;
  onEnabledChange: (enabled: boolean) => void;
  onPosXChange: (value: number) => void;
  onPosYChange: (value: number) => void;
  onPosZChange: (value: number) => void;
  onResetProperties: (
    label: string,
    entries: Array<{ property: AnimatableProperty; value: number }>,
  ) => void;
  onRotationChange: (property: 'rotation.x' | 'rotation.y' | 'rotation.z', value: number) => void;
  onScaleAllChange: (value: number) => void;
  onScaleXChange: (value: number) => void;
  onScaleYChange: (value: number) => void;
  onScaleZChange: (value: number) => void;
  onToggle3D: () => void;
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ResolveInspectorIconButton
      ariaLabel={`Reset ${label}`}
      className="resolve-inspector-reset-button"
      onClick={onClick}
      title={`Reset ${label} to defaults and delete keyframes`}
    >
      <ResolveResetIcon />
    </ResolveInspectorIconButton>
  );
}

function FlipIcon({ axis }: { axis: 'x' | 'y' }) {
  return axis === 'x' ? (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path className="resolve-flip-glyph-fill" d="M6.5 8 3.5 5.5v5L6.5 8Zm3 0 3-2.5v5L9.5 8Z" />
      <path d="M8 2.5v11" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path className="resolve-flip-glyph-fill" d="M8 6.5 5.5 3.5h5L8 6.5Zm0 3 2.5 3h-5L8 9.5Z" />
      <path d="M2.5 8h11" />
    </svg>
  );
}

function StaticField({ axis }: { axis?: 'X' | 'Y' }) {
  return (
    <span className={`resolve-inspector-field-static${axis ? '' : ' is-plain'}`}>
      {axis && <span>{axis}</span>}
      <output>0.000</output>
    </span>
  );
}

function SliderValue({
  createMidiTarget,
  label,
  midiLabel,
  onBatchEnd,
  onBatchStart,
  onChange,
  property,
  value,
}: {
  createMidiTarget: CreateMidiTarget;
  label: string;
  midiLabel: string;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onChange: (value: number) => void;
  property: 'rotation.x' | 'rotation.y' | 'rotation.z';
  value: number;
}) {
  const sliderValue = Math.max(-180, Math.min(180, value));

  return (
    <div className="resolve-inspector-slider-value">
      <HandleOnlyRange
        aria-label={`${label} slider`}
        max={180}
        min={-180}
        onChange={onChange}
        onDragEnd={onBatchEnd}
        onDragStart={onBatchStart}
        step={0.1}
        value={sliderValue}
      />
      <LabeledValue
        ariaLabel={label}
        className="resolve-inspector-field resolve-inspector-field--plain"
        decimals={3}
        defaultValue={0}
        label=""
        midiTarget={createMidiTarget(property, midiLabel, value, -360, 360)}
        onChange={onChange}
        onDragEnd={onBatchEnd}
        onDragStart={onBatchStart}
        sensitivity={0.25}
        value={value}
      />
    </div>
  );
}

export function ResolveTransformSection({
  clipId,
  createMidiTarget,
  enabled,
  isEffectively3D,
  isLocked3D,
  positionValues,
  showLayerDimensionToggle,
  supportsScaleZ,
  transform,
  usesCameraControls,
  onBatchEnd,
  onBatchStart,
  onCameraPositionXChange,
  onCameraPositionYChange,
  onCameraPositionZChange,
  onCameraLookRotationChange,
  onAnchorChange,
  onFitToFrame,
  onFlipX,
  onFlipY,
  onEnabledChange,
  onPosXChange,
  onPosYChange,
  onPosZChange,
  onResetProperties,
  onRotationChange,
  onScaleAllChange,
  onScaleXChange,
  onScaleYChange,
  onScaleZChange,
  onToggle3D,
}: ResolveTransformSectionProps) {
  const [zoomLinked, setZoomLinked] = useState(true);

  useEffect(() => {
    setZoomLinked(true);
  }, [clipId]);

  const allKeyframeEntries = useMemo(() => {
    const entries: Array<{ property: AnimatableProperty; value: number }> = [
      { property: 'position.x', value: transform.position.x },
      { property: 'position.y', value: transform.position.y },
      { property: 'rotation.z', value: transform.rotation.z },
    ];
    if (!usesCameraControls) {
      entries.push(
        { property: 'anchor.x', value: transform.anchor?.x ?? 0 },
        { property: 'anchor.y', value: transform.anchor?.y ?? 0 },
        { property: 'scale.x', value: transform.scale.x },
        { property: 'scale.y', value: transform.scale.y },
      );
      if (transform.scale.all !== undefined) {
        entries.push({ property: 'scale.all', value: transform.scale.all });
      }
      if (supportsScaleZ) {
        entries.push({ property: 'scale.z', value: transform.scale.z ?? 1 });
      }
      if (isEffectively3D) {
        entries.push({ property: 'anchor.z', value: transform.anchor?.z ?? 0 });
      }
    }
    if (isEffectively3D) {
      entries.push(
        { property: 'position.z', value: transform.position.z },
        { property: 'rotation.x', value: transform.rotation.x },
        { property: 'rotation.y', value: transform.rotation.y },
      );
    }
    return entries;
  }, [isEffectively3D, supportsScaleZ, transform, usesCameraControls]);

  const resetEntries = (
    entries: Array<{ property: AnimatableProperty; value: number }>,
    label: string,
  ) => onResetProperties(label, entries);
  const transformResetEntries = allKeyframeEntries.map(({ property }) => ({
    property,
    value: property.startsWith('scale.')
      ? 1
      : property === 'position.z' && usesCameraControls
        ? 1
        : 0,
  }));

  const positionX = usesCameraControls ? positionValues.cameraPositionX : positionValues.posXValue;
  const positionY = usesCameraControls ? positionValues.cameraPositionY : positionValues.posYValue;
  const positionZ = usesCameraControls ? positionValues.cameraPositionZ : positionValues.posZValue;
  const handleScaleX = (next: number) => {
    onScaleXChange(next);
    if (!zoomLinked) return;
    const factor = Math.abs(transform.scale.x) > 0.000001 ? next / transform.scale.x : 1;
    onScaleYChange(Math.abs(transform.scale.x) > 0.000001 ? transform.scale.y * factor : next);
  };
  const handleScaleY = (next: number) => {
    onScaleYChange(next);
    if (!zoomLinked) return;
    const factor = Math.abs(transform.scale.y) > 0.000001 ? next / transform.scale.y : 1;
    onScaleXChange(Math.abs(transform.scale.y) > 0.000001 ? transform.scale.x * factor : next);
  };

  return (
    <div className="resolve-transform-section">
      <ResolveInspectorSection
        enabled={enabled}
        headerActions={(
          <>
            <MultiKeyframeToggle
              clipId={clipId}
              dragId={`${clipId}:resolve-transform`}
              entries={allKeyframeEntries}
              title="Add transform keyframes"
            />
            <ResetButton
              label="transform"
              onClick={() => resetEntries(transformResetEntries, 'Reset transform')}
            />
          </>
        )}
        onEnabledChange={onEnabledChange}
        title="Transform"
      >
        {showLayerDimensionToggle && !usesCameraControls && (
          <ResolveInspectorRow label="Layer Mode">
            <LayerDimensionToggle
              ariaLabelPrefix="Layer Mode"
              isEffectively3D={isEffectively3D}
              isLocked3D={isLocked3D}
              onToggle3D={onToggle3D}
            />
          </ResolveInspectorRow>
        )}

        {!usesCameraControls && (
          <ResolveInspectorRow
            actions={(
              <>
                <ScaleKeyframeToggle
                  clipId={clipId}
                  scaleX={transform.scale.x}
                  scaleY={transform.scale.y}
                />
                <ResetButton
                  label="zoom"
                  onClick={() => resetEntries([
                    { property: 'scale.x', value: 1 },
                    { property: 'scale.y', value: 1 },
                  ], 'Reset zoom')}
                />
              </>
            )}
            label="Zoom"
          >
            <div className="resolve-inspector-values resolve-inspector-values--pair">
              <LabeledValue
                ariaLabel="Zoom X"
                className="resolve-inspector-field"
                decimals={3}
                defaultValue={1}
                label="X"
                midiTarget={createMidiTarget('scale.x', 'Zoom X', transform.scale.x, -4, 4)}
                onChange={handleScaleX}
                onDragEnd={onBatchEnd}
                onDragStart={onBatchStart}
                sensitivity={0.01}
                value={transform.scale.x}
              />
              <ResolveInspectorIconButton
                active={zoomLinked}
                ariaLabel={zoomLinked ? 'Unlink zoom axes' : 'Link zoom axes'}
                className="resolve-inspector-link-button"
                onClick={() => setZoomLinked(current => !current)}
              >
                <ResolveLinkIcon />
              </ResolveInspectorIconButton>
              <LabeledValue
                ariaLabel="Zoom Y"
                className="resolve-inspector-field"
                decimals={3}
                defaultValue={1}
                label="Y"
                midiTarget={createMidiTarget('scale.y', 'Zoom Y', transform.scale.y, -4, 4)}
                onChange={handleScaleY}
                onDragEnd={onBatchEnd}
                onDragStart={onBatchStart}
                sensitivity={0.01}
                value={transform.scale.y}
              />
            </div>
          </ResolveInspectorRow>
        )}

        <ResolveInspectorRow
          actions={(
            <>
              <MultiKeyframeToggle
                clipId={clipId}
                dragId={`${clipId}:resolve-position-xy`}
                entries={[
                  { property: 'position.x', value: transform.position.x },
                  { property: 'position.y', value: transform.position.y },
                ]}
                title="Add position keyframes"
              />
              <ResetButton
                label="position"
                onClick={() => resetEntries([
                  { property: 'position.x', value: 0 },
                  { property: 'position.y', value: 0 },
                ], 'Reset position')}
              />
            </>
          )}
          label="Position"
        >
          <div className="resolve-inspector-values resolve-inspector-values--pair">
            <LabeledValue
              ariaLabel="Position X"
              className="resolve-inspector-field"
              decimals={3}
              defaultValue={0}
              label="X"
              midiTarget={createMidiTarget('position.x', 'Position X', transform.position.x, -2, 2)}
              onChange={usesCameraControls ? onCameraPositionXChange : onPosXChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={positionValues.positionSensitivity}
              value={positionX}
            />
            <span aria-hidden="true" />
            <LabeledValue
              ariaLabel="Position Y"
              className="resolve-inspector-field"
              decimals={3}
              defaultValue={0}
              label="Y"
              midiTarget={createMidiTarget('position.y', 'Position Y', transform.position.y, -2, 2)}
              onChange={usesCameraControls ? onCameraPositionYChange : onPosYChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={positionValues.positionSensitivity}
              value={positionY}
            />
          </div>
        </ResolveInspectorRow>

        <ResolveInspectorRow
          actions={(
            <>
              <KeyframeToggle clipId={clipId} property="rotation.z" value={transform.rotation.z} />
              <ResetButton
                label="rotation"
                onClick={() => resetEntries([
                  { property: 'rotation.z', value: 0 },
                ], 'Reset rotation')}
              />
            </>
          )}
          label="Rotation Angle"
        >
          <SliderValue
            createMidiTarget={createMidiTarget}
            label="Rotation Angle"
            midiLabel="Rotation Angle"
            onBatchEnd={onBatchEnd}
            onBatchStart={onBatchStart}
            onChange={value => usesCameraControls
              ? onCameraLookRotationChange('z', value)
              : onRotationChange('rotation.z', value)}
            property="rotation.z"
            value={transform.rotation.z}
          />
        </ResolveInspectorRow>

        {!usesCameraControls && (
          <AnchorPointRows
            clipId={clipId}
            createMidiTarget={createMidiTarget}
            isEffectively3D={isEffectively3D}
            transform={transform}
            onBatchEnd={onBatchEnd}
            onBatchStart={onBatchStart}
            onChange={onAnchorChange}
            onReset={() => resetEntries([
              { property: 'anchor.x', value: 0 },
              { property: 'anchor.y', value: 0 },
              { property: 'anchor.z', value: 0 },
            ], 'Reset anchor point')}
          />
        )}

        {(['x', 'y'] as const).map((axis) => {
          const label = axis === 'x' ? 'Pitch' : 'Yaw';
          const property = `rotation.${axis}` as const;
          const value = transform.rotation[axis];
          return (
            <ResolveInspectorRow
              actions={isEffectively3D ? (
                <>
                  <KeyframeToggle clipId={clipId} property={property} value={value} />
                  <ResetButton
                    label={label.toLowerCase()}
                    onClick={() => resetEntries([{ property, value: 0 }], `Reset ${label.toLowerCase()}`)}
                  />
                </>
              ) : undefined}
              disabled={!isEffectively3D}
              key={axis}
              label={label}
              title={!isEffectively3D ? 'Enable 3D layer controls to edit this value' : undefined}
            >
              {isEffectively3D ? (
                <SliderValue
                  createMidiTarget={createMidiTarget}
                  label={label}
                  midiLabel={usesCameraControls ? `Camera ${label}` : `Rotation ${axis.toUpperCase()}`}
                  onBatchEnd={onBatchEnd}
                  onBatchStart={onBatchStart}
                  onChange={next => usesCameraControls
                    ? onCameraLookRotationChange(axis, next)
                    : onRotationChange(property, next)}
                  property={property}
                  value={value}
                />
              ) : (
                <div className="resolve-inspector-slider-value">
                  <input aria-label={`${label} slider`} disabled max={180} min={-180} type="range" value={0} readOnly />
                  <StaticField />
                </div>
              )}
            </ResolveInspectorRow>
          );
        })}

        {!usesCameraControls && (
          <ResolveInspectorRow label="Flip">
            <div className="resolve-inspector-flip-controls">
              <ResolveInspectorIconButton
                ariaLabel="Flip horizontal"
                className="resolve-inspector-flip-button"
                onClick={onFlipX}
              >
                <FlipIcon axis="x" />
              </ResolveInspectorIconButton>
              <ResolveInspectorIconButton
                ariaLabel="Flip vertical"
                className="resolve-inspector-flip-button"
                onClick={onFlipY}
              >
                <FlipIcon axis="y" />
              </ResolveInspectorIconButton>
              {onFitToFrame && (
                <ResolveInspectorIconButton
                  ariaLabel="Fit source to composition"
                  className="resolve-inspector-fit-button"
                  onClick={onFitToFrame}
                >
                  Fit
                </ResolveInspectorIconButton>
              )}
            </div>
          </ResolveInspectorRow>
        )}

        {isEffectively3D && (
          <ResolveInspectorRow
            actions={(
              <>
                <KeyframeToggle clipId={clipId} property="position.z" value={transform.position.z} />
                <ResetButton
                  label="position Z"
                  onClick={() => resetEntries([
                    { property: 'position.z', value: usesCameraControls ? 1 : 0 },
                  ], 'Reset position Z')}
                />
              </>
            )}
            label="Position Z"
          >
            <div className="resolve-inspector-values resolve-inspector-values--single">
              <LabeledValue
                ariaLabel="Position Z"
                className="resolve-inspector-field resolve-inspector-field--plain"
                decimals={3}
                defaultValue={0}
                label=""
                midiTarget={createMidiTarget('position.z', 'Position Z', transform.position.z, -20, 20)}
                onChange={usesCameraControls ? onCameraPositionZChange : onPosZChange}
                onDragEnd={onBatchEnd}
                onDragStart={onBatchStart}
                sensitivity={positionValues.positionSensitivity}
                value={positionZ}
              />
            </div>
          </ResolveInspectorRow>
        )}

        {!usesCameraControls && transform.scale.all !== undefined && (
          <ResolveInspectorRow
            actions={(
              <>
                <KeyframeToggle clipId={clipId} property="scale.all" value={transform.scale.all} />
                <ResetButton
                  label="scale all"
                  onClick={() => resetEntries([{ property: 'scale.all', value: 1 }], 'Reset scale all')}
                />
              </>
            )}
            className="resolve-inspector-master-only"
            label="Scale All"
          >
            <LabeledValue
              ariaLabel="Scale All"
              className="resolve-inspector-field resolve-inspector-field--plain"
              decimals={3}
              defaultValue={1}
              label=""
              midiTarget={createMidiTarget('scale.all', 'Scale All', transform.scale.all, 0.01, 4)}
              min={0.01}
              onChange={onScaleAllChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={0.01}
              value={transform.scale.all}
            />
          </ResolveInspectorRow>
        )}

        {!usesCameraControls && supportsScaleZ && (
          <ResolveInspectorRow
            actions={(
              <>
                <KeyframeToggle clipId={clipId} property="scale.z" value={transform.scale.z ?? 1} />
                <ResetButton
                  label="zoom Z"
                  onClick={() => resetEntries([{ property: 'scale.z', value: 1 }], 'Reset zoom Z')}
                />
              </>
            )}
            className="resolve-inspector-master-only"
            label="Zoom Z"
          >
            <LabeledValue
              ariaLabel="Zoom Z"
              className="resolve-inspector-field resolve-inspector-field--plain"
              decimals={3}
              defaultValue={1}
              label=""
              midiTarget={createMidiTarget('scale.z', 'Zoom Z', transform.scale.z ?? 1, 0.01, 4)}
              min={0.01}
              onChange={onScaleZChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={0.01}
              value={transform.scale.z ?? 1}
            />
          </ResolveInspectorRow>
        )}
      </ResolveInspectorSection>
    </div>
  );
}
