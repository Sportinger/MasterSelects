import type { EffectControlProps } from '../../../effects/types';
import { slitScanParams, slitScanNumber } from '../../../effects/time/slit-scan/parameters';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { KeyframeToggle } from './shared';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { Fragment, useSyncExternalStore } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { getTemporalStatus, subscribeTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { SlitScanStabilizationControls } from './SlitScanStabilizationControls';

export function SlitScanControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const masks = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.masks);
  const files = useMediaStore(state => state.files);
  const selectedMask = masks?.find(mask => mask.id === params.protectionMask);
  const preparationStatus = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(effectInstanceId ?? ''));
  const changeNumber = (key: string, value: number) => clipId && effectInstanceId
    ? setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
    : onChange({ ...params, [key]: value });
  return <div className="effects-tab transform-tab-compact">
    <ResolveInspectorSection title="Preview quality" defaultOpen>
      <ResolveInspectorRow label="Quality"><InspectorSelect ariaLabel="Slit Scan preview quality"
        value={params.temporalResolution === 'native' ? 'full' : 'preview'}
        options={[{ value: 'preview', label: 'Small preview · 160 px' }, { value: 'full', label: 'Full size · follows Proxy mode' }]}
        onChange={value => onChange({ ...params, temporalResolution: value === 'full' ? 'native' : '160' })} /></ResolveInspectorRow>
      <p className="effect-info">Both qualities use the same source times. Full size uses the full proxy resolution when timeline Proxy mode is on, otherwise the original resolution. Small preview scales to 160 px. Composition size stays unchanged.</p>
      {preparationStatus && <p className="effect-info" role="status">{preparationStatus}</p>}
    </ResolveInspectorSection>
    <SlitScanStabilizationControls params={params} onChange={onChange} clipId={clipId} effectInstanceId={effectInstanceId} />
    <ResolveInspectorSection title="Time map source" defaultOpen>
      <ResolveInspectorRow label="Image / video"><InspectorSelect ariaLabel="Slit Scan time map source"
        value={String(params.mapMediaId ?? '')} options={[{ value: '', label: 'Profile only' },
          ...files.filter(file => file.type === 'image' || file.type === 'video').map(file => ({ value: file.id, label: file.name }))]}
        onChange={value => onChange({ ...params, mapMediaId: value, mapAmount: value ? 1 : 0 })} /></ResolveInspectorRow>
      <p className="effect-info">Imported images, depth or mask videos use normalized clip coordinates. Map start aligns video time zero to the composition timeline; boundaries hold the first or last frame.</p>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Protection mask" defaultOpen>
      <ResolveInspectorRow label="Clip mask"><InspectorSelect ariaLabel="Slit Scan protection mask"
        value={String(params.protectionMask ?? '')} options={[{ value: '', label: 'None' },
          ...(params.protectionMask && !selectedMask ? [{ value: String(params.protectionMask), label: 'Missing mask', disabled: true }] : []),
          ...(masks ?? []).filter(mask => mask.purpose !== 'crop').map(mask => ({ value: mask.id, label: mask.name }))]}
        onChange={value => onChange({ ...params, protectionMask: value })} /></ResolveInspectorRow>
      {selectedMask && clipId && <ResolveInspectorNumberRow label="Mask feather" value={selectedMask.feather} defaultValue={30}
        min={0} max={200} hardMin={0} hardMax={1000} numberMax={1000} step={1} suffix="px"
        onChange={value => setPropertyValue(clipId, `mask.${selectedMask.id}.feather`, value)} />}
      {selectedMask?.enabled === false && <p className="effect-info" role="status">This mask is disabled. Enable its Render switch in Masks to protect the object.</p>}
      <p className="effect-info">White protects the current frame. Use “Effect input only” in Masks to keep the full clip visible.</p>
    </ResolveInspectorSection>
    {['Time', 'Sampling', 'Time map', 'Subject protection', 'Protected center', 'Wave'].map(group => <ResolveInspectorSection key={group} title={group} defaultOpen={group === 'Time'}>
      {Object.entries(slitScanParams).filter(([key, parameter]) => parameter.group === group && !['temporalMode', 'temporalResolution'].includes(key)).map(([key, parameter]) => {
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
          keyframeToggle={parameter.animatable && clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={property} value={slitScanNumber(params, key)} /> : undefined}
          hardMin={parameter.min} hardMax={parameter.max} onChange={value => changeNumber(key, value)} /></Fragment>;
      })}
    </ResolveInspectorSection>)}
    <p className="effect-info">Source sampling applies clip trim and speed. Earlier effects are not reevaluated: render them to a video first. Clip boundaries hold. Frames load through a bounded cache; export waits for the requested result. Full Res may need preparation time.</p>
  </div>;
}
