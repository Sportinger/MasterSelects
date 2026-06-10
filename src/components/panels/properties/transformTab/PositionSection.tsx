import { KeyframeToggle } from '../shared';
import { LabeledValue } from './ValueControls';
import type { PositionValueContext } from './transformValues';
import type { CreateMidiTarget, TransformTabTransform } from './transformTabTypes';

interface PositionSectionProps {
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  isEffectively3D: boolean;
  positionValues: PositionValueContext;
  transform: TransformTabTransform;
  usesCameraControls: boolean;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onCameraPositionXChange: (value: number) => void;
  onCameraPositionYChange: (value: number) => void;
  onCameraPositionZChange: (value: number) => void;
  onPosXChange: (value: number) => void;
  onPosYChange: (value: number) => void;
  onPosZChange: (value: number) => void;
}

export function PositionSection({
  clipId,
  createMidiTarget,
  isEffectively3D,
  positionValues,
  transform,
  usesCameraControls,
  onBatchEnd,
  onBatchStart,
  onCameraPositionXChange,
  onCameraPositionYChange,
  onCameraPositionZChange,
  onPosXChange,
  onPosYChange,
  onPosZChange,
}: PositionSectionProps) {
  return (
    <div className="properties-section">
      <div className="control-row transform-param-row">
        <span className="keyframe-toggle-placeholder" />
        <label className="prop-label">Position</label>
        <div className="multi-value-row">
          <LabeledValue
            label="X"
            value={usesCameraControls ? positionValues.cameraPositionX : positionValues.posXValue}
            onChange={usesCameraControls ? onCameraPositionXChange : onPosXChange}
            defaultValue={0}
            decimals={positionValues.positionDecimals}
            sensitivity={positionValues.positionSensitivity}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={
              <KeyframeToggle clipId={clipId} property="position.x" value={transform.position.x} />
            }
            midiTarget={createMidiTarget(
              'position.x',
              usesCameraControls ? 'Camera Position X' : 'Position X',
              transform.position.x,
              usesCameraControls ? -5 : -2,
              usesCameraControls ? 5 : 2,
            )}
          />
          <LabeledValue
            label="Y"
            value={usesCameraControls ? positionValues.cameraPositionY : positionValues.posYValue}
            onChange={usesCameraControls ? onCameraPositionYChange : onPosYChange}
            defaultValue={0}
            decimals={positionValues.positionDecimals}
            sensitivity={positionValues.positionSensitivity}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={
              <KeyframeToggle clipId={clipId} property="position.y" value={transform.position.y} />
            }
            midiTarget={createMidiTarget(
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
              value={usesCameraControls ? positionValues.cameraPositionZ : positionValues.posZValue}
              onChange={usesCameraControls ? onCameraPositionZChange : onPosZChange}
              defaultValue={0}
              decimals={positionValues.positionDecimals}
              sensitivity={positionValues.positionSensitivity}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={
                <KeyframeToggle
                  clipId={clipId}
                  property="position.z"
                  value={transform.position.z}
                />
              }
              midiTarget={createMidiTarget(
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
  );
}
