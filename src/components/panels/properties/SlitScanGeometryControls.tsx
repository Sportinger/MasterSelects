import { useMemo, useSyncExternalStore } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { slitScanGeometryParams } from '../../../effects/time/slit-scan/geometryParameters';
import { createSlitScanReference } from '../../../effects/time/slit-scan/geometryReference';
import { effectOperatorGraph } from '../../../services/operators/effectGraphOwner';
import { findClipOperatorEffect } from '../../../services/operators/clipOperatorGraphOwner';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { useTimelineStore } from '../../../stores/timeline';
import { useEngineStore } from '../../../stores/engineStore';
import { getTemporalStatus, subscribeTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { KeyframeToggle } from './shared';
import type { AnimatableProperty } from '../../../types/animationProperties';

export function SlitScanGeometryControls({ params, onChange, clipId, effectInstanceId, operatorGraph }: Pick<EffectControlProps, 'params' | 'onChange' | 'clipId' | 'effectInstanceId'> & { operatorGraph?: EffectOperatorGraph }) {
  // Sampler identities belong to the authored graph, not the interpolated
  // parameter snapshot recreated by the inspector on every playhead update.
  const authoredParams = useTimelineStore(state => findClipOperatorEffect(
    state.clips.find(clip => clip.id === clipId), effectInstanceId ?? '', state.clips,
  )?.params);
  const graphParams = authoredParams ?? params;
  const samplerState = useMemo(() => {
    try { return { samplers: effectOperatorGraph({ type: 'slit-scan', params: graphParams, operatorGraph }).nodes.filter(node => node.operator === 'image.sample-history').map(node => node.id), error: '' }; }
    catch (error) { return { samplers: [], error: String(error) }; }
  }, [operatorGraph, graphParams]);
  const { samplers } = samplerState;
  const status = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(`${effectInstanceId}:geometry`) || getTemporalStatus(effectInstanceId ?? ''));
  const motionStatus = useSyncExternalStore(subscribeTemporalStatus, () => getTemporalStatus(`${effectInstanceId}:dis`));
  const mode = String(params.geometryMode ?? '2d');
  const changeMode = (value: string) => {
        const was3D = clipId && useTimelineStore.getState().clips.find(item => item.id === clipId)?.is3D;
        const promoted = value !== '2d' && !was3D;
        if (clipId && (promoted || (value === '2d' && was3D))) {
          useTimelineStore.getState().toggle3D(clipId);
        }
        const sampler = String(params.geometrySampler ?? (samplers.length === 1 ? samplers[0] : samplers.includes('history') && !operatorGraph ? 'history' : ''));
        onChange({ ...params, geometryMode: value, geometrySampler: sampler, geometryVersion: 1,
          geometryLastMode: value === '2d' ? mode : value,
          geometryPromoted3D: value === '2d' ? false : promoted || params.geometryPromoted3D === true,
          geometryReference: params.geometryReference ?? JSON.stringify(createSlitScanReference('perspective')) });
      };
  return <ResolveInspectorSection title="3D geometry" defaultOpen={mode !== '2d'} enabled={mode !== '2d'}
    onEnabledChange={enabled => changeMode(enabled
      ? ['motion-band', 'motion-surface'].includes(String(params.geometryLastMode)) ? String(params.geometryLastMode) : 'time-surface' : '2d')}>
    <ResolveInspectorRow label="Representation"><InspectorSelect ariaLabel="Slit Scan representation" value={mode}
      options={slitScanGeometryParams.geometryMode.options!} onChange={changeMode} /></ResolveInspectorRow>
    {mode !== '2d' && <>
      {samplerState.error && <p role="status" className="tracking-panel-status">{samplerState.error}</p>}
      <ResolveInspectorRow label="Base time sampler"><InspectorSelect ariaLabel="Slit Scan base time sampler"
        value={String(params.geometrySampler ?? '')} options={[{ value: '', label: 'Select sampler…' }, ...samplers.map(value => ({ value, label: value }))]}
        onChange={value => onChange({ ...params, geometrySampler: value })} /></ResolveInspectorRow>
      {Object.entries(slitScanGeometryParams).filter(([key]) => key !== 'geometryMode'
        && (!['geometryMotionAmount', 'geometryMotionGaps'].includes(key) || mode === 'motion-surface')).map(([key, parameter]) => parameter.type === 'select'
        ? <ResolveInspectorRow key={key} label={parameter.label}><InspectorSelect ariaLabel={`Slit Scan ${parameter.label}`}
          value={String(params[key] ?? parameter.default)} options={parameter.options!}
          onChange={value => onChange({ ...params, [key]: value, ...(key === 'geometryProjection'
            ? { geometryReference: JSON.stringify(createSlitScanReference(value === 'orthographic' ? 'orthographic' : 'perspective')) } : {}) })} /></ResolveInspectorRow>
        : <ResolveInspectorNumberRow key={key} label={parameter.label} value={Number(params[key] ?? parameter.default)}
          defaultValue={Number(parameter.default)} min={parameter.min!} max={parameter.max!} step={parameter.step!}
          keyframeToggle={parameter.animatable && clipId && effectInstanceId ? <KeyframeToggle clipId={clipId}
            property={`effect.${effectInstanceId}.${key}` as AnimatableProperty} value={Number(params[key] ?? parameter.default)} /> : undefined}
          onChange={value => clipId && effectInstanceId
            ? useTimelineStore.getState().setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
            : onChange({ ...params, [key]: value })} />)}
      <p className="tracking-panel-status">{mode === 'motion-surface'
        ? 'Tracks grid points from sampled source times to the current time. Untracked regions retain their original XY or leave gaps. Motion is estimated, not recovered scene depth.'
        : mode === 'motion-band'
        ? 'Motion bands follow a linear scan seed. Occlusion ends segments. Alpha below 50% is cut out; depth resolves overlaps.'
        : params.geometryTimeBasis === 'samples'
          ? 'Depth follows source-frame times and blend weights. Current input is the zero-depth reference. No motion analysis is needed when Flow depth is zero.'
          : 'Depth follows the base time query. RGB offsets and image smoothing affect color only.'}</p>
      {status && <p className="tracking-panel-status">{status}</p>}
      {motionStatus && (mode === 'motion-surface' || mode === 'motion-band' || Number(params.geometryFlowDepth ?? 0) !== 0)
        && <p className="tracking-panel-status">{motionStatus}</p>}
      <ResolveInspectorRow label="Reference view"><ResolveInspectorIconButton ariaLabel="Return to Slit Scan reference view"
        onClick={event => {
          if (event.detail > 0) event.currentTarget.blur();
          const projection = params.geometryProjection === 'orthographic' ? 'orthographic' : 'perspective';
          useEngineStore.getState().setPreviewCameraOverride({ position: { x: 0, y: 0, z: 1 / Math.tan(25 * Math.PI / 180) },
            target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: 50, near: .1, far: 1000,
            projection, orthographicScale: 2, applyDefaultDistance: false });
        }}>↶</ResolveInspectorIconButton></ResolveInspectorRow>
      <p className="tracking-panel-status">Reference view changes preview only. Use the scene camera controls to save an export view.</p>
    </>}
  </ResolveInspectorSection>;
}
