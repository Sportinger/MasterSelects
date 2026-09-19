import { useEffect, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useTrackingStore } from '../../../../stores/trackingStore';
import { useTrackingEditorStore } from '../../../../stores/trackingEditorStore';
import { bindClipToTrackingAsset } from '../../../../services/planarTracking/trackingBinding';
import { requestTrackingAssetAction } from '../../../../services/planarTracking/trackingAssetActions';
import { layerBuilder } from '../../../../services/layerBuilder';
import { renderHostPort } from '../../../../services/render/renderHostPort';
import { TerrainAttachmentControls } from './TerrainAttachmentControls';
import type { TrackingBinding } from '../../../../types/trackingBinding';

export function TrackingConnectionControls({clipId}: {clipId:string}) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  const locked = useTimelineStore(s => s.isExporting || !!s.tracks.find(t => t.id === clip?.trackId)?.locked);
  const assets = useTrackingStore(s => s.assets);
  const pendingAssetId = useTrackingEditorStore(s => s.assetId);
  const placementMessage = useTrackingEditorStore(s => s.message);
  const binding = clip?.trackingBinding;
  const legacyAttachment = clip?.terrainAttachment ?? clip?.terrainScreenAnchor?.attachment;
  const legacyTrackId = legacyAttachment?.trackId;
  const legacyAssetId = assets.find(a => a.track.id === legacyTrackId)?.id;
  const preferredAssetId = binding?.assetId ?? legacyAssetId ?? (!legacyTrackId ? pendingAssetId : null) ?? '';
  const [selected, setSelected] = useState(preferredAssetId);
  const [error, setError] = useState('');
  const asset = assets.find(a => a.id === (binding?.assetId ?? selected));
  const canPlaceInPreview = useTimelineStore(s => !!binding?.targetVideoClipId && s.clips.some(c => c.id === binding.targetVideoClipId));
  useEffect(() => {
    setSelected(preferredAssetId);
    setError('');
  }, [clipId, preferredAssetId]);
  useEffect(() => {
    useTrackingEditorStore.getState().setEditor({message:''});
  }, [clipId]);
  useEffect(() => {
    if (!binding) return;
    useTrackingEditorStore.getState().setEditor({active:true,clipId,assetId:binding.assetId,tool:'inspect'});
    return () => useTrackingEditorStore.getState().setEditor({active:false,tool:'inspect'});
  }, [clipId,binding?.assetId]);
  if (!clip) return null;
  const invalidate = () => {layerBuilder.invalidateCache();renderHostPort.requestRender();};
  const update = (patch:Partial<TrackingBinding>) => {
    const current = useTimelineStore.getState().clips.find(c => c.id === clipId)?.trackingBinding;
    if (!current || locked) return;
    useTimelineStore.getState().updateClip(clipId,{trackingBinding:{...current,...patch}});invalidate();
  };
  const connect = (mode:'follow'|'surface') => {
    try {bindClipToTrackingAsset(clipId, selected || asset?.id || '', mode);setError('');useTrackingEditorStore.getState().setEditor({message:''});invalidate();}
    catch(e) {setError(e instanceof Error?e.message:String(e));}
  };
  return <div className="surface-tracking tracking-connection" onPointerUp={e => (e.target instanceof HTMLElement ? e.target.closest('button') : null)?.blur()}>
    <strong>{binding||legacyAttachment?'Linked tracking':'Connect to tracking'}</strong>
    <label>Result <select aria-label="Connect tracking result" value={selected} disabled={locked} onChange={e => {
      setSelected(e.target.value);
      setError('');
      useTrackingEditorStore.getState().setEditor({message:''});
    }}>
      <option value="">Choose result…</option>{assets.map(a => <option value={a.id} key={a.id}>{a.name}{a.track.terrain?' · 3D':' · Surface'}</option>)}
    </select></label>
    {!assets.length && <span className="surface-quality">Track a video first. Its result will appear here.</span>}
    <div className="surface-buttons"><button disabled={locked||!selected} aria-pressed={binding?.mode==='follow'} title="Keep the clip facing the viewer while its position follows the tracked surface" onClick={() => connect('follow')}>Follow position</button>
      <button disabled={locked||!selected} aria-pressed={binding?.mode==='surface'} title="Warp the clip onto the tracked surface" onClick={() => connect('surface')}>Project onto surface</button></div>
    {binding && <>
      {!asset && <span role="alert">Tracking result is missing. Choose another result or unlink.</span>}
      <div className="surface-buttons"><button disabled={locked||!asset||!canPlaceInPreview} title={canPlaceInPreview?'Place on the source video in Preview':'The linked source video must be in this composition. You can also edit Surface X/Y below.'} onClick={() => useTrackingEditorStore.getState().setEditor({active:true,clipId,assetId:binding.assetId,tool:'place',view:'video',message:'Click the surface in Preview to place the clip.'})}>Place in Preview</button>
        {asset && <button onClick={() => requestTrackingAssetAction('open',asset)}>Open result</button>}
        <button disabled={locked} onClick={() => {useTimelineStore.getState().updateClip(clipId,{trackingBinding:undefined,terrainAttachment:undefined,terrainScreenAnchor:undefined});useTrackingEditorStore.getState().setEditor({tool:'inspect'});invalidate();}}>Unlink</button></div>
      {binding.placement && binding.mode==='surface' && (['width','height','rotation'] as const).map(key => <label key={key}>{key[0].toUpperCase()+key.slice(1)}<input aria-label={`Tracking projection ${key}`} type="number" step={key==='rotation'?1:.01} min={key==='rotation'?undefined:.00001} disabled={locked} value={binding.placement![key]} onChange={e => {
        const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&(key==='rotation'||n>0)) update({placement:{...binding.placement!,[key]:n}});
      }}/></label>)}
      <details><summary>Position &amp; timing</summary><div className="tracking-section">
        {(['x','y'] as const).map(axis=><label key={`surface-${axis}`}>Surface {axis.toUpperCase()}<input aria-label={`Tracking surface ${axis}`} title={asset?.track.terrain?'Reconstruction units':'Normalized tracked surface coordinates'} type="number" step=".01" disabled={locked} value={(binding.placement??binding.point)[axis]} onChange={e=>{
          const n=e.currentTarget.valueAsNumber;if(!Number.isFinite(n))return;
          update({...(binding.placement?{placement:{...binding.placement,[axis]:n}}:{}),...(!asset?.track.terrain?{point:{...binding.point,[axis]:n}}:{})});
        }}/></label>)}
        {binding.mode==='follow'&&(['x','y'] as const).map(axis => <label key={axis}>Offset {axis.toUpperCase()}<input type="number" step=".01" disabled={locked} value={binding.offset[axis]} onChange={e => {const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n))update({offset:{...binding.offset,[axis]:n}});}}/></label>)}
        {!binding.targetVideoClipId && <label>Source start<input title="Source video time at this clip's beginning" type="number" step=".01" disabled={locked} value={binding.sourceStart ?? 0} onChange={e => {const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>=0)update({sourceStart:n});}}/></label>}
      </div></details>
    </>}
    {!binding && legacyAttachment && <>
      <TerrainAttachmentControls clipId={clipId}/>
      <button disabled={locked} onClick={()=>{useTimelineStore.getState().updateClip(clipId,{terrainAttachment:undefined,terrainScreenAnchor:undefined});invalidate();}}>Unlink</button>
    </>}
    <p role="status" className="surface-status">{error || placementMessage}</p>
  </div>;
}
