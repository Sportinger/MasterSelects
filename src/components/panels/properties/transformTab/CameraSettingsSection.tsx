import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../../../stores/mediaStore/types';
import {
  MAX_CAMERA_FOV_DEGREES,
  MIN_CAMERA_FOV_DEGREES,
  fovToFullFrameFocalLengthMm,
} from '../../../../utils/cameraLens';
import { KeyframeToggle } from '../shared';
import { LabeledValue } from './ValueControls';
import type { CameraValueContext, CreateMidiTarget } from './transformTabTypes';

interface CameraSettingsSectionProps {
  camera: CameraValueContext;
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onCameraFarChange: (value: number) => void;
  onCameraFocalLengthChange: (value: number) => void;
  onCameraFovChange: (value: number) => void;
  onCameraNearChange: (value: number) => void;
  onCameraResolutionHeightChange: (value: number) => void;
  onCameraResolutionWidthChange: (value: number) => void;
}

export function CameraSettingsSection({
  camera,
  clipId,
  createMidiTarget,
  onBatchEnd,
  onBatchStart,
  onCameraFarChange,
  onCameraFocalLengthChange,
  onCameraFovChange,
  onCameraNearChange,
  onCameraResolutionHeightChange,
  onCameraResolutionWidthChange,
}: CameraSettingsSectionProps) {
  return (
    <div className="properties-section">
      <div className="control-row transform-param-row">
        <span className="keyframe-toggle-placeholder" />
        <label className="prop-label">Lens</label>
        <div className="multi-value-row">
          <LabeledValue
            label="FOV"
            value={camera.settings.fov}
            onChange={onCameraFovChange}
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.fov}
            decimals={1}
            suffix="deg"
            min={MIN_CAMERA_FOV_DEGREES}
            max={MAX_CAMERA_FOV_DEGREES}
            sensitivity={0.5}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.fov" value={camera.settings.fov} />}
            midiTarget={createMidiTarget(
              'camera.fov',
              'Camera FOV',
              camera.settings.fov,
              MIN_CAMERA_FOV_DEGREES,
              MAX_CAMERA_FOV_DEGREES,
            )}
          />
          <LabeledValue
            label="mm"
            value={camera.focalLengthMm}
            onChange={onCameraFocalLengthChange}
            defaultValue={fovToFullFrameFocalLengthMm(DEFAULT_SCENE_CAMERA_SETTINGS.fov)}
            decimals={1}
            suffix="mm"
            min={camera.minFocalLengthMm}
            max={camera.maxFocalLengthMm}
            sensitivity={0.5}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
          />
        </div>
      </div>
      <div className="control-row transform-param-row">
        <span className="keyframe-toggle-placeholder" />
        <label className="prop-label">Planes</label>
        <div className="multi-value-row">
          <LabeledValue
            label="Near"
            value={camera.settings.near}
            onChange={onCameraNearChange}
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.near}
            decimals={3}
            min={0.001}
            max={100}
            sensitivity={0.05}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.near" value={camera.settings.near} />}
            midiTarget={createMidiTarget('camera.near', 'Camera Near', camera.settings.near, 0.001, 100)}
          />
          <LabeledValue
            label="Far"
            value={camera.settings.far}
            onChange={onCameraFarChange}
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.far}
            decimals={1}
            min={1}
            max={100000}
            sensitivity={10}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={<KeyframeToggle clipId={clipId} property="camera.far" value={camera.settings.far} />}
            midiTarget={createMidiTarget('camera.far', 'Camera Far', camera.settings.far, 1, 100000)}
          />
        </div>
      </div>
      <div className="control-row transform-param-row">
        <span className="keyframe-toggle-placeholder" />
        <label className="prop-label">Res</label>
        <div className="multi-value-row">
          <LabeledValue
            label="X"
            value={camera.resolutionWidth}
            onChange={onCameraResolutionWidthChange}
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.resolutionWidth ?? 1920}
            decimals={0}
            min={1}
            max={32768}
            sensitivity={16}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={
              <KeyframeToggle
                clipId={clipId}
                property="camera.resolutionWidth"
                value={camera.resolutionWidth}
              />
            }
            midiTarget={createMidiTarget(
              'camera.resolutionWidth',
              'Camera Res X',
              camera.resolutionWidth,
              1,
              32768,
            )}
          />
          <LabeledValue
            label="Y"
            value={camera.resolutionHeight}
            onChange={onCameraResolutionHeightChange}
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.resolutionHeight ?? 1080}
            decimals={0}
            min={1}
            max={32768}
            sensitivity={16}
            onDragStart={onBatchStart}
            onDragEnd={onBatchEnd}
            keyframeToggle={
              <KeyframeToggle
                clipId={clipId}
                property="camera.resolutionHeight"
                value={camera.resolutionHeight}
              />
            }
            midiTarget={createMidiTarget(
              'camera.resolutionHeight',
              'Camera Res Y',
              camera.resolutionHeight,
              1,
              32768,
            )}
          />
        </div>
      </div>
    </div>
  );
}
