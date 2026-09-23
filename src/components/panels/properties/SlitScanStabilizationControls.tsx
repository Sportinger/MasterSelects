import { useEffect, useRef, useState } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import { useTimelineStore } from '../../../stores/timeline';
import { useTrackingStore } from '../../../stores/trackingStore';
import { useHistoryStore } from '../../../stores/historyStore';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { createSlitScanProtectionFromTrack, trackSlitScanObject } from '../../../services/planarTracking/slitScanStabilizationActions';
import { slitScanProtectionMask } from '../../../services/planarTracking/slitScanProtectionMask';
import './trackingPanel.css';

export function SlitScanStabilizationControls({ clipId, effectInstanceId, params, onChange }: Omit<EffectControlProps, 'effectId'>) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const locked = useTimelineStore(state => state.isExporting || !!state.tracks.find(item => item.id === clip?.trackId)?.locked);
  const assets = useTrackingStore(state => state.assets);
  const mediaId = clip?.source?.mediaFileId ?? clip?.mediaFileId;
  const choices = assets.filter(asset => asset.sourceMediaId === mediaId);
  const selected = String(params.stabilizationAssetId ?? '');
  const asset = choices.find(item => item.id === selected);
  const [feather, setFeather] = useState(30);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [clipId, effectInstanceId]);
  const blocked = locked || busy || !clipId || !effectInstanceId;
  const run = async () => {
    if (blocked || controller.current || !clipId || !effectInstanceId) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setMessage('Preparing object tracking…');
    try { setMessage(await trackSlitScanObject(clipId, effectInstanceId, feather, abort.signal, setMessage)); }
    catch (error) { setMessage(abort.signal.aborted ? 'Cancelled · previous settings kept' : error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); controller.current = null; }
  };
  const createMask = () => {
    if (blocked || !clipId || !effectInstanceId) return;
    try {
      if (selected) createSlitScanProtectionFromTrack(clipId, effectInstanceId, feather);
      else {
        const history = useHistoryStore.getState(), batch = history.startBatch('Create Slit Scan selection');
        try {
          const timeline = useTimelineStore.getState();
          const id = timeline.addMask(clipId, slitScanProtectionMask([{ x: .3, y: .3 }, { x: .7, y: .3 }, { x: .7, y: .7 }, { x: .3, y: .7 }], feather));
          timeline.updateClipEffect(clipId, effectInstanceId, { protectionMask: id });
          timeline.setActiveMask(clipId, id);
        } finally { if (batch.opened) history.endBatch(); }
      }
      setMessage(selected ? 'Reference protection mask created · edit it in Masks' : 'Selection created · fit it to the object in Masks, then Track mask & stabilize');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="tracking-panel" onPointerUp={event => {
    (event.target instanceof HTMLElement ? event.target.closest('button') : null)?.blur();
  }}><ResolveInspectorSection title="Object stabilization" defaultOpen>
    <ResolveInspectorRow label="Tracking"><InspectorSelect ariaLabel="Slit Scan stabilization tracking" value={selected}
      disabled={!!blocked} options={[{ value: '', label: 'Off' },
        ...(selected && !asset ? [{ value: selected, label: 'Missing tracking result', disabled: true }] : []),
        ...choices.map(item => ({ value: item.id, label: item.name }))]}
      onChange={value => {
        const next = choices.find(item => item.id === value);
        onChange({ ...params, stabilizationAssetId: value, ...(next ? { stabilizationReference: next.track.referenceTime } : {}) });
        setMessage('');
      }} /></ResolveInspectorRow>
    {selected && <>
      <ResolveInspectorNumberRow label="Reference (source s)" value={Number(params.stabilizationReference ?? asset?.track.referenceTime ?? 0)}
        defaultValue={asset?.track.referenceTime ?? 0} min={0} max={clip?.outPoint ?? 60} hardMin={0} step={.001} disabled={!!blocked}
        onChange={value => onChange({ ...params, stabilizationReference: value })} />
      <ResolveInspectorNumberRow label="Strength" ariaLabel="Stabilization strength" value={Number(params.stabilizationStrength ?? 1)}
        defaultValue={1} min={0} max={1} hardMin={0} hardMax={1} step={.01} disabled={!!blocked}
        onChange={value => onChange({ ...params, stabilizationStrength: value })} />
      <ResolveInspectorRow label="Rotation"><InspectorSelect ariaLabel="Stabilization rotation" disabled={!!blocked}
        value={String(params.stabilizationRotation ?? 'on')} options={[{ value: 'on', label: 'Lock rotation' }, { value: 'off', label: 'Keep rotation' }]}
        onChange={value => onChange({ ...params, stabilizationRotation: value })} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Scale"><InspectorSelect ariaLabel="Stabilization scale" disabled={!!blocked}
        value={String(params.stabilizationScale ?? 'on')} options={[{ value: 'on', label: 'Lock size' }, { value: 'off', label: 'Keep size changes' }]}
        onChange={value => onChange({ ...params, stabilizationScale: value })} /></ResolveInspectorRow>
    </>}
    <ResolveInspectorNumberRow label="New mask feather" value={feather} defaultValue={30} min={0} max={200} hardMin={0} hardMax={1000}
      numberMax={1000} step={1} suffix="px" disabled={!!blocked} onChange={setFeather} />
    <div className="tracking-panel-actions">
      <button type="button" disabled={!!blocked || (!!selected && !asset)} onClick={createMask}>{selected ? 'Create protection mask' : 'Create selection mask'}</button>
      <button type="button" disabled={!!blocked || !!selected || !params.protectionMask} onClick={() => void run()}>Track mask &amp; stabilize</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel tracking</button>}
    </div>
    {message && <p className="effect-info" role="status">{message}</p>}
  </ResolveInspectorSection></div>;
}
