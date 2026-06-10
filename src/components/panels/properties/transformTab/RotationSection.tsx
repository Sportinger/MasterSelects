import { KeyframeToggle } from '../shared';
import { RotationValue } from './ValueControls';
import type { CreateMidiTarget, TransformTabTransform } from './transformTabTypes';

interface RotationSectionProps {
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  isEffectively3D: boolean;
  transform: TransformTabTransform;
  usesCameraControls: boolean;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onCameraLookRotationChange: (axis: 'x' | 'y' | 'z', value: number) => void;
  onRotationChange: (property: 'rotation.x' | 'rotation.y' | 'rotation.z', value: number) => void;
}

export function RotationSection({
  clipId,
  createMidiTarget,
  isEffectively3D,
  transform,
  usesCameraControls,
  onBatchEnd,
  onBatchStart,
  onCameraLookRotationChange,
  onRotationChange,
}: RotationSectionProps) {
  return (
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
                ? onCameraLookRotationChange('x', value)
                : onRotationChange('rotation.x', value)}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.x" value={transform.rotation.x} />}
              midiTarget={createMidiTarget(
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
                ? onCameraLookRotationChange('y', value)
                : onRotationChange('rotation.y', value)}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.y" value={transform.rotation.y} />}
              midiTarget={createMidiTarget(
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
              ? onCameraLookRotationChange('z', value)
              : onRotationChange('rotation.z', value)}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="rotation.z" value={transform.rotation.z} />}
            midiTarget={createMidiTarget(
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
  );
}
