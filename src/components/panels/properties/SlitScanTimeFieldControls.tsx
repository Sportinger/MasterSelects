import type { EffectControlProps } from '../../../effects/types';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { slitScanNumber, slitScanParams } from '../../../effects/time/slit-scan/parameters';
import { slitScanTimeFieldPreset, slitScanTimeFieldPresets } from '../../../effects/time/slit-scan/timeFieldParameters';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { DepthEstimationControls } from './DepthEstimationControls';
import { KeyframeToggle } from './shared';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';

export function SlitScanTimeFieldControls({ params, onChange, clipId, effectInstanceId }: Omit<EffectControlProps, 'effectId'>) {
  const files = useMediaStore(state => state.files);
  const masks = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.masks);
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const source = String(params.mapSource ?? 'external');
  const selectedMask = masks?.find(mask => mask.id === params.mapMaskId);
  const imageSource = source === 'input' || source === 'external';
  const row = (key: string) => {
    const parameter = slitScanParams[key];
    if (parameter.type === 'select') return <ResolveInspectorRow key={key} label={parameter.label}>
      <InspectorSelect ariaLabel={`Slit Scan ${parameter.label}`} value={String(params[key] ?? parameter.default)}
        options={parameter.options!} onChange={value => onChange({ ...params, [key]: value,
          ...(key === 'mapSource' ? { mapAmount: value === 'external' && !params.mapMediaId ? 0 : 1 } : {}) })} />
    </ResolveInspectorRow>;
    const property = `effect.${effectInstanceId}.${key}` as AnimatableProperty;
    if (clipId && effectInstanceId && ['mapAmount', 'mapNoiseAmount'].includes(key)) {
      return <ParameterSourceNumberRow key={key} clipId={clipId} property={property} />;
    }
    return <ResolveInspectorNumberRow key={key} label={parameter.label} value={slitScanNumber(params, key)}
      defaultValue={Number(parameter.default)} min={parameter.min!} max={parameter.max!} step={parameter.step!}
      hardMin={parameter.min} hardMax={parameter.max}
      keyframeToggle={parameter.animatable && clipId && effectInstanceId
        ? <KeyframeToggle clipId={clipId} property={property} value={slitScanNumber(params, key)} /> : undefined}
      onChange={value => clipId && effectInstanceId ? setPropertyValue(clipId, property, value) : onChange({ ...params, [key]: value })} />;
  };
  return <>
    <ResolveInspectorSection title="RGB time" bypassGroupId="rgb-time" defaultOpen={false}>
      {row('rgbTimeMode')}
      {params.rgbTimeMode === 'separate' && <>
        {['rgbRedOffset', 'rgbGreenOffset', 'rgbBlueOffset', 'rgbTimePreview'].map(row)}
        <p className="tracking-panel-status">Offsets stay inside Delay. Protection applies to every channel; alpha uses base time. Scan smoothing is bypassed.</p>
      </>}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Time field source" bypassGroupId="time-map" defaultOpen={false}>
      <ResolveInspectorRow label="Preset"><InspectorSelect ariaLabel="Slit Scan time field preset" value=""
        options={[{ value: '', label: 'Apply preset…', disabled: true }, ...slitScanTimeFieldPresets.map(({ value, label }) => ({ value, label }))]}
        onChange={value => { const preset = slitScanTimeFieldPreset(value); if (preset) onChange({ ...params, ...preset }); }} /></ResolveInspectorRow>
      {row('mapSource')}
      {source === 'external' && <ResolveInspectorRow label="Image / video"><InspectorSelect ariaLabel="Slit Scan time map source"
        value={String(params.mapMediaId ?? '')} options={[{ value: '', label: 'Profile only' },
          ...(params.mapMediaId && !files.some(file => file.id === params.mapMediaId) ? [{ value: String(params.mapMediaId), label: 'Missing media', disabled: true }] : []),
          ...files.filter(file => file.type === 'image' || file.type === 'video').map(file => ({ value: file.id, label: file.name }))]}
        onChange={value => {
          const depth = files.find(file => file.id === value)?.depthMap;
          onChange({ ...params, mapMediaId: value, mapAmount: value ? 1 : 0, mapAlignment: depth ? 'source' : 'timeline',
            ...(depth ? { mapChannel: 'luminance', mapInvert: depth.nearIsWhite ? 'on' : 'off' } : {}) });
        }} /></ResolveInspectorRow>}
      {source === 'mask' && <ResolveInspectorRow label="Time mask"><InspectorSelect ariaLabel="Slit Scan time field mask"
        value={String(params.mapMaskId ?? '')} options={[{ value: '', label: 'None (scan profile)' },
          ...(params.mapMaskId && !selectedMask ? [{ value: String(params.mapMaskId), label: 'Missing mask', disabled: true }] : []),
          ...(masks ?? []).filter(mask => mask.purpose !== 'crop').map(mask => ({ value: mask.id, label: mask.name }))]}
        onChange={value => onChange({ ...params, mapMaskId: value })} /></ResolveInspectorRow>}
      {imageSource && row('mapChannel')}
      {imageSource && params.mapChannel === 'hue' && <>{row('mapHueMode')}{row('mapHuePhase')}</>}
      {row('mapAmount')}
      {source === 'external' && <>{row('mapAlignment')}{params.mapAlignment !== 'source' && row('mapStart')}</>}
    </ResolveInspectorSection>
    {source === 'motion' && <ResolveInspectorSection title="Motion field" bypassGroupId="field-motion" defaultOpen={false}>
      {row('mapMotionMode')}{params.mapMotionMode === 'direction' && row('mapMotionAngle')}
      {['mapMotionMin', 'mapMotionMax', 'mapMotionConfidence'].map(row)}
    </ResolveInspectorSection>}
    {source === 'external' && clipId && effectInstanceId && <DepthEstimationControls clipId={clipId} timeMapEffectId={effectInstanceId} />}
    <ResolveInspectorSection title="Field shaping" bypassGroupId="field-shaping" defaultOpen={false}>
      {['mapMin', 'mapMax', 'mapGamma', 'mapInvert'].map(row)}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Field combination" bypassGroupId="field-combination" defaultOpen={false}>
      {row('mapCombine')}{row('mapNoiseAmount')}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Field noise" bypassGroupId="field-noise" defaultOpen={false}>
      {['mapNoiseMode', 'mapNoiseScale', 'mapNoiseSeed', 'mapNoiseDriftX', 'mapNoiseDriftY'].map(row)}
    </ResolveInspectorSection>
  </>;
}
