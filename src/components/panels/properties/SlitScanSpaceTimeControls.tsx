import { useEffect, useRef, useState } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { spaceTimeParams } from '../../../effects/time/slit-scan/spaceTimeParameters';
import { slitScanNumber } from '../../../effects/time/slit-scan/parameters';
import { bakeSpaceTime } from '../../../services/depthEstimation/bakeSpaceTime';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { findClipOperatorEffect } from '../../../services/operators/clipOperatorGraphOwner';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { KeyframeToggle } from './shared';
import type { AnimatableProperty } from '../../../types/animationProperties';

export function SlitScanSpaceTimeControls({ clipId, effectInstanceId, params, onChange }: Omit<EffectControlProps, 'effectId'>) {
  const files = useMediaStore(state => state.files);
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const locked = useTimelineStore(state => state.isExporting || !!state.tracks.find(t => t.id === clip?.trackId)?.locked);
  const source = files.find(item => item.id === (clip?.source?.mediaFileId ?? clip?.mediaFileId));
  const choices = files.filter(item => item.type === 'video' && item.depthMap?.sourceMediaId === source?.id);
  const [from, setFrom] = useState(clip?.inPoint ?? 0);
  const [to, setTo] = useState(Math.min(clip?.outPoint ?? 2, (clip?.inPoint ?? 0) + 2));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    setFrom(clip?.inPoint ?? 0); setTo(Math.min(clip?.outPoint ?? 2, (clip?.inPoint ?? 0) + 2));
    return () => abort.current?.abort();
  }, [clipId, effectInstanceId, source?.id, clip?.inPoint, clip?.outPoint]);
  const bake = async () => {
    const depth = choices.find(item => item.id === params.spaceTimeDepthId);
    if (!source || !depth || !clip || !clipId || !effectInstanceId || busy || locked) return;
    const controller = new AbortController(); abort.current = controller; setBusy(true);
    const composition = useMediaStore.getState().activeCompositionId;
    const originalData = params.spaceTimeData;
    try {
      if (from < clip.inPoint || to > clip.outPoint) throw new Error('Choose a window inside the clip source range.');
      const data = await bakeSpaceTime(source, depth, from, to, controller.signal, setMessage);
      controller.signal.throwIfAborted();
      const state = useTimelineStore.getState(), freshClip = state.clips.find(item => item.id === clipId);
      const effect = findClipOperatorEffect(freshClip, effectInstanceId, state.clips);
      const freshSource = useMediaStore.getState().files.find(item => item.id === source.id);
      if (!effect || !freshClip || effect.params.spaceTimeData !== originalData || state.isExporting
        || state.tracks.find(t => t.id === freshClip.trackId)?.locked
        || composition !== useMediaStore.getState().activeCompositionId || freshSource?.file !== source.file
        || freshSource?.url !== source.url || freshSource?.fileHash !== source.fileHash
        || (freshClip.source?.mediaFileId ?? freshClip.mediaFileId) !== source.id
        || freshClip.inPoint !== clip.inPoint || freshClip.outPoint !== clip.outPoint) {
        throw new Error('The clip or source changed while baking. Previous observations kept.');
      }
      state.updateClipEffect(clipId, effectInstanceId, { spaceTimeData: data });
      setMessage('Observed surfaces saved in the project. Tilt and slice without rebaking.');
    } catch (error) { setMessage(controller.signal.aborted ? 'Cancelled · previous observations kept' : error instanceof Error ? error.message : String(error)); }
    finally { abort.current = null; setBusy(false); }
  };
  return <>
    <ResolveInspectorRow label="Depth video"><InspectorSelect ariaLabel="Space-time depth video" value={String(params.spaceTimeDepthId ?? '')}
      disabled={busy || locked} options={[{ value: '', label: 'Select baked source depth…' }, ...choices.map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => onChange({ ...params, spaceTimeDepthId: value })} /></ResolveInspectorRow>
    <ResolveInspectorNumberRow label="Source start (s)" value={from} defaultValue={clip?.inPoint ?? 0} min={clip?.inPoint ?? 0}
      max={clip?.outPoint ?? 60} step={.01} disabled={busy || locked} onChange={setFrom} />
    <ResolveInspectorNumberRow label="Source end (s)" value={to} defaultValue={Math.min(clip?.outPoint ?? 2, from + 2)}
      min={from} max={Math.min(clip?.outPoint ?? 60, from + 8)} step={.01} disabled={busy || locked} onChange={setTo} />
    <ResolveInspectorRow label="Observations"><button type="button" disabled={busy || locked || !params.spaceTimeDepthId}
      onClick={event => { if (event.detail) event.currentTarget.blur(); void bake(); }}>Bake space-time window</button>
      {busy && <button type="button" onClick={event => { if (event.detail) event.currentTarget.blur(); abort.current?.abort(); }}>Cancel</button>}
    </ResolveInspectorRow>
    {Object.entries(spaceTimeParams).filter(([, definition]) => !definition.hidden).map(([key, definition]) => definition.type === 'select'
      ? <ResolveInspectorRow key={key} label={definition.label}><InspectorSelect ariaLabel={`Slit Scan ${definition.label}`}
        value={String(params[key] ?? definition.default)} options={definition.options!} onChange={value => onChange({ ...params, [key]: value })} /></ResolveInspectorRow>
      : <ResolveInspectorNumberRow key={key} label={definition.label} value={slitScanNumber(params, key)} defaultValue={Number(definition.default)}
        min={definition.min!} max={definition.max!} hardMin={definition.min} hardMax={definition.max} step={definition.step!}
        keyframeToggle={clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={`effect.${effectInstanceId}.${key}` as AnimatableProperty}
          value={slitScanNumber(params, key)} /> : undefined}
        onChange={value => clipId && effectInstanceId ? useTimelineStore.getState().setPropertyValue(clipId,
          `effect.${effectInstanceId}.${key}` as AnimatableProperty, value) : onChange({ ...params, [key]: value })} />)}
    <p className="tracking-panel-status">Fixed source camera · relative depth · observed front surfaces only. Bake a depth video in Tracking → AI Depth Map first. Slice zero passes through the window midpoint. Source colors are baked before effects.</p>
    {message && <p className="tracking-panel-status" role="status">{message}</p>}
  </>;
}
