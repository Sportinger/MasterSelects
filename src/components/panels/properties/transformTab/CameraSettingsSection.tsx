import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../../../stores/mediaStore/types';
import {
  MAX_CAMERA_FOV_DEGREES,
  MIN_CAMERA_FOV_DEGREES,
  fovToFullFrameFocalLengthMm,
} from '../../../../utils/cameraLens';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveInspectorSection,
  ResolveResetIcon,
} from '../resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from '../shared';
import { LabeledValue } from './ValueControls';
import type { CameraValueContext, CreateMidiTarget } from './transformTabTypes';
import { HandleOnlyRange } from './HandleOnlyRange';

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
  onResetLens: () => void;
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
  onResetLens,
}: CameraSettingsSectionProps) {
  return (
    <div className="resolve-camera-settings-sections">
      <ResolveInspectorSection
        headerActions={(
          <ResolveInspectorIconButton
            ariaLabel="Reset lens"
            className="resolve-inspector-reset-button"
            onClick={onResetLens}
            title="Reset lens to default and delete FOV keyframes"
          >
            <ResolveResetIcon />
          </ResolveInspectorIconButton>
        )}
        indicator="none"
        title="Lens"
      >
        <ResolveInspectorRow
          actions={<KeyframeToggle clipId={clipId} property="camera.fov" value={camera.settings.fov} />}
          label="Field of View"
        >
          <div className="resolve-inspector-slider-value">
            <HandleOnlyRange
              aria-label="Field of View slider"
              max={MAX_CAMERA_FOV_DEGREES}
              min={MIN_CAMERA_FOV_DEGREES}
              onChange={onCameraFovChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              step={0.1}
              value={camera.settings.fov}
            />
            <LabeledValue
              ariaLabel="Field of View"
              className="resolve-inspector-field resolve-inspector-field--plain"
              decimals={1}
              defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.fov}
              label=""
              max={MAX_CAMERA_FOV_DEGREES}
              midiTarget={createMidiTarget(
                'camera.fov',
                'Camera FOV',
                camera.settings.fov,
                MIN_CAMERA_FOV_DEGREES,
                MAX_CAMERA_FOV_DEGREES,
              )}
              min={MIN_CAMERA_FOV_DEGREES}
              onChange={onCameraFovChange}
              onDragEnd={onBatchEnd}
              onDragStart={onBatchStart}
              sensitivity={0.5}
              suffix="deg"
              value={camera.settings.fov}
            />
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow
          actions={<KeyframeToggle clipId={clipId} property="camera.fov" value={camera.settings.fov} />}
          label="Focal Length"
        >
          <LabeledValue
            ariaLabel="Focal Length"
            className="resolve-inspector-field resolve-inspector-field--plain"
            defaultValue={fovToFullFrameFocalLengthMm(DEFAULT_SCENE_CAMERA_SETTINGS.fov)}
            decimals={1}
            label=""
            max={camera.maxFocalLengthMm}
            min={camera.minFocalLengthMm}
            onChange={onCameraFocalLengthChange}
            onDragEnd={onBatchEnd}
            onDragStart={onBatchStart}
            sensitivity={0.5}
            suffix="mm"
            value={camera.focalLengthMm}
          />
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection defaultOpen={false} indicator="none" title="Clipping Planes">
        <ResolveInspectorRow
          actions={<KeyframeToggle clipId={clipId} property="camera.near" value={camera.settings.near} />}
          label="Near"
        >
          <LabeledValue
            ariaLabel="Near Clipping Plane"
            className="resolve-inspector-field resolve-inspector-field--plain"
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.near}
            decimals={3}
            max={100}
            label=""
            midiTarget={createMidiTarget('camera.near', 'Camera Near', camera.settings.near, 0.001, 100)}
            min={0.001}
            onChange={onCameraNearChange}
            onDragEnd={onBatchEnd}
            onDragStart={onBatchStart}
            sensitivity={0.05}
            value={camera.settings.near}
          />
        </ResolveInspectorRow>
        <ResolveInspectorRow
          actions={<KeyframeToggle clipId={clipId} property="camera.far" value={camera.settings.far} />}
          label="Far"
        >
          <LabeledValue
            ariaLabel="Far Clipping Plane"
            className="resolve-inspector-field resolve-inspector-field--plain"
            defaultValue={DEFAULT_SCENE_CAMERA_SETTINGS.far}
            decimals={1}
            label=""
            max={100000}
            midiTarget={createMidiTarget('camera.far', 'Camera Far', camera.settings.far, 1, 100000)}
            min={1}
            onChange={onCameraFarChange}
            onDragEnd={onBatchEnd}
            onDragStart={onBatchStart}
            sensitivity={10}
            value={camera.settings.far}
          />
        </ResolveInspectorRow>
      </ResolveInspectorSection>
    </div>
  );
}
