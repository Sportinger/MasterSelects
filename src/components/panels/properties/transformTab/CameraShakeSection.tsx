import type { AnimatableProperty } from '../../../../types';
import type { SceneCameraSettings } from '../../../../stores/mediaStore/types';
import { ResolveInspectorSection } from '../resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { KeyframeToggle } from '../shared';

interface Props {
  clipId: string;
  settings: SceneCameraSettings;
  onBatchStart: () => void;
  onBatchEnd: () => void;
  onPropertyChange: (property: AnimatableProperty, value: number) => void;
}
export function CameraShakeSection({ clipId, settings, onBatchStart, onBatchEnd, onPropertyChange }: Props) {
  const fields = [
    ['shakeAmount', 'Strength', 0, 0, 20, .01, '°'],
    ['shakeFrequency', 'Frequency', 8, .1, 30, .1, 'Hz'],
    ['shakeSeed', 'Seed', 17, 0, 9999, 1, undefined],
  ] as const;
  return <ResolveInspectorSection title="Camera Shake" defaultOpen={false}>
    {fields.map(([key, label, initial, min, max, step, suffix]) => {
      const property = `camera.${key}` as const;
      const value = settings[key] ?? initial;
      return <ResolveInspectorNumberRow key={key} label={label} value={value} defaultValue={initial}
        min={min} max={max} hardMin={min} hardMax={max} step={step} suffix={suffix}
        decimals={step === 1 ? 0 : step === .1 ? 1 : 2} sensitivity={step}
        keyframeToggle={<KeyframeToggle clipId={clipId} property={property} value={value} />}
        onDragStart={onBatchStart} onDragEnd={onBatchEnd} onChange={next => onPropertyChange(property, next)} />;
    })}
  </ResolveInspectorSection>;
}
