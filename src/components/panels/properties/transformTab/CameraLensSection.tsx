import type { AnimatableProperty } from '../../../../types';
import type { SceneCameraSettings } from '../../../../stores/mediaStore/types';
import { DEFAULT_CAMERA_LENS, type ToneMapping } from '../../../../engine/native3d/pathtrace/contracts/ptTypes';
import { InspectorSelect, type InspectorSelectOption } from '../../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from '../resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from '../shared';

const TONE_MAPPING_OPTIONS: InspectorSelectOption<ToneMapping>[] = [
  { value: 'auto', label: 'Auto', title: 'Standard for Raster, AgX for Path Traced' },
  { value: 'standard', label: 'Standard' },
  { value: 'agx', label: 'AgX' },
  { value: 'aces', label: 'ACES' },
  { value: 'neutral', label: 'Neutral' },
];

interface CameraLensSectionProps {
  clipId: string;
  settings: SceneCameraSettings;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onPropertyChange: (property: AnimatableProperty, value: number) => void;
  onToneMappingChange: (value: ToneMapping) => void;
  onEnabledChange: (enabled: boolean) => void;
}

/**
 * Physical camera of a 3D camera clip (path tracing plan 4.5/4.9): exposure and view transform for
 * both engines; aperture, focus and shutter for depth of field and motion blur. An f-stop of 0 is a
 * pinhole, a focus distance of 0 focuses on the camera target, a shutter angle of 0 disables blur.
 */
export function CameraLensSection({ clipId, settings, onBatchEnd, onBatchStart, onPropertyChange, onToneMappingChange, onEnabledChange }: CameraLensSectionProps) {
  const exposure = settings.exposure ?? DEFAULT_CAMERA_LENS.exposure;
  const fStop = settings.fStop ?? DEFAULT_CAMERA_LENS.fStop;
  const focusDistance = settings.focusDistance ?? DEFAULT_CAMERA_LENS.focusDistance;
  const shutterAngle = settings.shutterAngle ?? DEFAULT_CAMERA_LENS.shutterAngle;
  const toggle = (property: AnimatableProperty, value: number) => <KeyframeToggle clipId={clipId} property={property} value={value} />;
  return (
    <ResolveInspectorSection defaultOpen={false} enabled={settings.physicalCameraEnabled !== false}
      onEnabledChange={onEnabledChange} title="Physical Camera">
      <ResolveInspectorNumberRow label="Exposure" suffix="EV" decimals={2} value={exposure} defaultValue={DEFAULT_CAMERA_LENS.exposure}
        min={-8} max={8} step={0.01} numberMin={-16} numberMax={16} hardMin={-16} hardMax={16} sensitivity={0.05}
        keyframeToggle={toggle('camera.exposure', exposure)} onDragStart={onBatchStart} onDragEnd={onBatchEnd}
        onChange={value => onPropertyChange('camera.exposure', value)} />
      <ResolveInspectorRow label="Tone Mapping">
        <InspectorSelect ariaLabel="Tone mapping" value={settings.toneMapping ?? DEFAULT_CAMERA_LENS.toneMapping}
          options={TONE_MAPPING_OPTIONS} onChange={onToneMappingChange} onReset={() => onToneMappingChange(DEFAULT_CAMERA_LENS.toneMapping)} />
      </ResolveInspectorRow>
      <ResolveInspectorNumberRow label="f-Stop" ariaLabel="Aperture f-stop (0 disables depth of field)" decimals={2} value={fStop}
        defaultValue={DEFAULT_CAMERA_LENS.fStop} min={0} max={22} step={0.1} numberMax={64} hardMin={0} hardMax={64} sensitivity={0.05}
        keyframeToggle={toggle('camera.fStop', fStop)} onDragStart={onBatchStart} onDragEnd={onBatchEnd}
        onChange={value => onPropertyChange('camera.fStop', value)} />
      <ResolveInspectorRow label="Depth of Field">
        <span>{fStop > 0 ? 'On · lower f-stop = more blur' : 'Off · set f-stop above 0'}</span>
      </ResolveInspectorRow>
      <ResolveInspectorNumberRow label="Focus Distance" ariaLabel="Focus distance (0 focuses on the camera target)" decimals={3}
        value={focusDistance} defaultValue={DEFAULT_CAMERA_LENS.focusDistance} min={0} max={20} step={0.001} numberMax={100000}
        hardMin={0} sensitivity={0.01} keyframeToggle={toggle('camera.focusDistance', focusDistance)} onDragStart={onBatchStart}
        onDragEnd={onBatchEnd} onChange={value => onPropertyChange('camera.focusDistance', value)} />
      <ResolveInspectorNumberRow label="Shutter" ariaLabel="Shutter angle (0 disables motion blur)" suffix="°" decimals={0}
        value={shutterAngle} defaultValue={DEFAULT_CAMERA_LENS.shutterAngle} min={0} max={360} step={1} hardMin={0} hardMax={360}
        sensitivity={1} keyframeToggle={toggle('camera.shutterAngle', shutterAngle)} onDragStart={onBatchStart} onDragEnd={onBatchEnd}
        onChange={value => onPropertyChange('camera.shutterAngle', value)} />
    </ResolveInspectorSection>
  );
}
