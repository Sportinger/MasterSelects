import type { EffectControlProps } from '../../../effects/types';
import { slitScanParams, slitScanNumber } from '../../../effects/time/slit-scan/parameters';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { KeyframeToggle } from './shared';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { Fragment } from 'react';

export function SlitScanControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const changeNumber = (key: string, value: number) => clipId && effectInstanceId
    ? setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
    : onChange({ ...params, [key]: value });
  return <div className="effects-tab transform-tab-compact">
    {['Time', 'Protected center', 'Wave'].map(group => <ResolveInspectorSection key={group} title={group} defaultOpen={group === 'Time'}>
      {Object.entries(slitScanParams).filter(([, parameter]) => parameter.group === group).map(([key, parameter]) => {
        if (parameter.type === 'select') return <ResolveInspectorRow key={key} label={parameter.label}>
          <InspectorSelect ariaLabel={`Slit Scan ${parameter.label}`} value={String(params[key] ?? parameter.default)}
            options={parameter.options!} onChange={value => onChange({ ...params, [key]: value })} />
        </ResolveInspectorRow>;
        const property = `effect.${effectInstanceId}.${key}` as AnimatableProperty;
        return <Fragment key={key}>{key === 'angle' && <ResolveInspectorRow label="Scan direction">
          <InspectorSelect ariaLabel="Slit Scan scan direction"
            value={[0, 90, -90, 180].includes(slitScanNumber(params, key)) ? String(slitScanNumber(params, key)) : 'custom'}
            options={[{ value: '0', label: 'Left → right' }, { value: '90', label: 'Top → bottom' },
              { value: '-90', label: 'Bottom → top' }, { value: '180', label: 'Right → left' }, { value: 'custom', label: 'Custom angle', disabled: true }]}
            onChange={value => changeNumber(key, Number(value))} />
        </ResolveInspectorRow>}<ResolveInspectorNumberRow label={parameter.label} value={slitScanNumber(params, key)}
          defaultValue={Number(parameter.default)} min={parameter.min!} max={parameter.max!} step={parameter.step!}
          keyframeToggle={clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={property} value={slitScanNumber(params, key)} /> : undefined}
          hardMin={parameter.min} hardMax={parameter.max} onChange={value => changeNumber(key, value)} /></Fragment>;
      })}
    </ResolveInspectorSection>)}
    <p className="effect-info">Play to fill history. Seeking, looping or starting export resets it. Up to 4 s / 64 frames; history uses a reduced resolution.</p>
  </div>;
}
