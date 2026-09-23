import type { EffectControlProps } from '../../../effects/types';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { SlitScanGeometryControls } from './SlitScanGeometryControls';
import { slitScanParams, slitScanNumber } from '../../../effects/time/slit-scan/parameters';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { KeyframeToggle } from './shared';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { Fragment, useSyncExternalStore } from 'react';
import { getTemporalStatus, subscribeTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { useMediaStore } from '../../../stores/mediaStore';
import { SlitScanStabilizationControls } from './SlitScanStabilizationControls';
import { hybridTemporalSampleLimit } from '../../../effects/time/sourceTemporalLimits';
import { SlitScanTimeFieldControls } from './SlitScanTimeFieldControls';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';

export function SlitScanControls({ params, onChange, clipId, effectInstanceId, operatorGraph }: EffectControlProps & { operatorGraph?: EffectOperatorGraph }) {
  const motionStatus = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(`${effectInstanceId}:dis`));
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const masks = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.masks);
  const files = useMediaStore(state => state.files);
  const mediaId = useTimelineStore(state => {
    const clip = state.clips.find(item => item.id === clipId); return clip?.source?.mediaFileId ?? clip?.mediaFileId;
  });
  const media = files.find(file => file.id === mediaId);
  const originalHistory = ['hybrid', 'resident'].includes(String(params.temporalStorage));
  const sampleLimit = originalHistory ? hybridTemporalSampleLimit(media?.width, media?.height) : 256;
  const selectedMask = masks?.find(mask => mask.id === params.protectionMask);
  const changeNumber = (key: string, value: number) => clipId && effectInstanceId
    ? setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
    : onChange({ ...params, [key]: value });
  const renderGroup = (group: string) => <ResolveInspectorSection key={group} title={group}
      bypassGroupId={({ 'Time map': 'time-map', 'Subject protection': 'subject-protection', 'Protected center': 'scan-protection' } as Record<string, string>)[group]}
      defaultOpen={group === 'Sampling' || group === 'Time'}>
      {Object.entries(slitScanParams).filter(([key, parameter]) => parameter.group === group && !['temporalMode', 'temporalResolution'].includes(key)).map(([key, parameter]) => {
        if (key === 'temporalMemory' && params.temporalStorage !== 'resident') return null;
        if (key === 'temporalBatch' && !originalHistory) return null;
        if (parameter.type === 'select') return <ResolveInspectorRow key={key} label={parameter.label}>
          <InspectorSelect ariaLabel={`Slit Scan ${parameter.label}`} value={String(params[key] ?? parameter.default)}
            options={parameter.options!} onChange={value => onChange({ ...params, [key]: value })} />
        </ResolveInspectorRow>;
        const property = `effect.${effectInstanceId}.${key}` as AnimatableProperty;
        if (key === 'delay' && clipId && effectInstanceId) return <ParameterSourceNumberRow key={key} clipId={clipId} property={property} />;
        const maximum = key === 'temporalSamples' ? sampleLimit : parameter.max!;
        return <Fragment key={key}>{key === 'angle' && <ResolveInspectorRow label="Scan direction">
          <InspectorSelect ariaLabel="Slit Scan scan direction"
            value={[0, 90, -90, 180].includes(slitScanNumber(params, key)) ? String(slitScanNumber(params, key)) : 'custom'}
            options={[{ value: '0', label: 'Left → right' }, { value: '90', label: 'Top → bottom' },
              { value: '-90', label: 'Bottom → top' }, { value: '180', label: 'Right → left' }, { value: 'custom', label: 'Custom angle', disabled: true }]}
            onChange={value => changeNumber(key, Number(value))} />
        </ResolveInspectorRow>}<ResolveInspectorNumberRow label={parameter.label} value={Math.min(maximum, slitScanNumber(params, key))}
          defaultValue={Number(parameter.default)} min={parameter.min!} max={maximum} step={parameter.step!}
          actions={key === 'timeFactor' ? <ResolveInspectorIconButton ariaLabel="Bypass slowdown"
            title="Bypass slowdown: keep the Time factor acceleration" active={params.bypassSlowdown === true}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onChange({ ...params, bypassSlowdown: params.bypassSlowdown !== true }); }}>
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m2 3 5 5-5 5V3Zm7 0 5 5-5 5V3Z" /></svg>
          </ResolveInspectorIconButton> : key === 'scanStretchThreshold' ? <ResolveInspectorIconButton
            ariaLabel="Show stretch mask" title="Show DIS stretch above the threshold in red (preview only)"
            active={params.scanSmoothingPreview === true}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onChange({ ...params, scanSmoothingPreview: params.scanSmoothingPreview !== true }); }}>
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" /><circle cx="8" cy="8" r="2" /></svg>
          </ResolveInspectorIconButton> : undefined}
          keyframeToggle={parameter.animatable && clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={property} value={slitScanNumber(params, key)} /> : undefined}
          hardMin={parameter.min} hardMax={maximum} onChange={value => changeNumber(key, key === 'temporalSamples' ? Math.round(value) : value)} /></Fragment>;
      })}
      {group === 'Sampling' && (params.scanSmoothingPreview === true || Number(params.scanSmoothing) > 0) && motionStatus &&
        <ResolveInspectorRow label="Motion analysis"><span role="status" title={motionStatus}>{motionStatus}</span></ResolveInspectorRow>}
  </ResolveInspectorSection>;
  return <div className="effects-tab transform-tab-compact">
    {renderGroup('Sampling')}
    <ResolveInspectorSection title="Preview quality" defaultOpen>
      <ResolveInspectorRow label="Quality"><InspectorSelect ariaLabel="Slit Scan preview quality"
        value={params.temporalResolution === 'native' ? 'full' : 'preview'}
        options={[{ value: 'preview', label: 'Small preview · 160 px' }, { value: 'full', label: originalHistory ? 'Full size · original' : 'Full size · follows Proxy mode' }]}
        onChange={value => onChange({ ...params, temporalResolution: value === 'full' ? 'native' : '160' })} /></ResolveInspectorRow>
      {params.temporalStorage === 'resident' && params.temporalResolution === 'native' && <ResolveInspectorRow label="Preview quality">
        <InspectorSelect ariaLabel="Slit Scan preview quality" value={String(params.temporalPreview ?? 'full')}
          options={slitScanParams.temporalPreview.options!}
          onChange={value => onChange({ ...params, temporalPreview: value })} />
      </ResolveInspectorRow>}
    </ResolveInspectorSection>
    {renderGroup('Time')}
    {renderGroup('Wave')}
    <SlitScanGeometryControls params={params} onChange={onChange} clipId={clipId} effectInstanceId={effectInstanceId} operatorGraph={operatorGraph} />
    <SlitScanStabilizationControls params={params} onChange={onChange} clipId={clipId} effectInstanceId={effectInstanceId} />
    <SlitScanTimeFieldControls params={params} onChange={onChange} clipId={clipId} effectInstanceId={effectInstanceId} />
    <ResolveInspectorSection title="Protection mask" bypassGroupId="subject-protection" defaultOpen={false}>
      <ResolveInspectorRow label="Clip mask"><InspectorSelect ariaLabel="Slit Scan protection mask"
        value={String(params.protectionMask ?? '')} options={[{ value: '', label: 'None' },
          ...(params.protectionMask && !selectedMask ? [{ value: String(params.protectionMask), label: 'Missing mask', disabled: true }] : []),
          ...(masks ?? []).filter(mask => mask.purpose !== 'crop').map(mask => ({ value: mask.id, label: mask.name }))]}
        onChange={value => onChange({ ...params, protectionMask: value })} /></ResolveInspectorRow>
      {selectedMask && clipId && <ResolveInspectorNumberRow label="Mask feather" value={selectedMask.feather} defaultValue={30}
        min={0} max={200} hardMin={0} hardMax={1000} numberMax={1000} step={1} suffix="px"
        onChange={value => setPropertyValue(clipId, `mask.${selectedMask.id}.feather`, value)} />}
    </ResolveInspectorSection>
    {['Subject protection', 'Protected center'].map(renderGroup)}
  </div>;
}
