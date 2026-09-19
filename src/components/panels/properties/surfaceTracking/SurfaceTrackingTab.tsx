import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useTrackingEditorStore } from '../../../../stores/trackingEditorStore';
import { useTrackingStore } from '../../../../stores/trackingStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { trackingCoverage } from '../../../../services/planarTracking/trackingCoverage';
import { requestTrackingAssetAction } from '../../../../services/planarTracking/trackingAssetActions';
import { useTrackingWorkspace } from './useTrackingWorkspace';
import { TrackingConnectionControls } from './TrackingConnectionControls';
import { TrackingAttachPicker } from './TrackingAttachPicker';
import { assessTrackingSceneCalibration } from '../../../../services/planarTracking/trackingSceneCamera';
import './surfaceTracking.css';
import { DepthEstimationControls } from '../DepthEstimationControls';
import { PreciseFaceTrackingControls } from '../PreciseFaceTrackingControls';
const LegacyControls = lazy(() => import('./LegacySurfaceTrackingTab').then(m => ({default: m.LegacySurfaceTrackingTab})));

export function SurfaceTrackingTab({clipId, assetId}: {clipId?: string; assetId?: string}) {
  const isSource = useTimelineStore(s => {const clip=s.clips.find(c=>c.id===clipId);return clip?.source?.type==='video'&&!clip.source.liveInputId&&!clip.trackingBinding;});
  return <>{isSource && clipId && <DepthEstimationControls key={`depth:${clipId}`} clipId={clipId} />}{isSource && clipId && <PreciseFaceTrackingControls key={clipId} clipId={clipId} />}{isSource || assetId ? <TrackingResultTab clipId={clipId} assetId={assetId}/> : clipId ? <TrackingConnectionControls clipId={clipId}/> : null}</>;
}

function TrackingResultTab({clipId,assetId}:{clipId?:string;assetId?:string}) {
  const w = useTrackingWorkspace(clipId, assetId);
  const editor = useTrackingEditorStore();
  const input = useRef<HTMLInputElement>(null);
  const [legacy, setLegacy] = useState(false);
  const ranges = useMemo(() => w.track ? trackingCoverage(w.track) : [], [w.track]);
  const assets = useTrackingStore(s => s.assets);
  const asset = assets.find(a => a.id === assetId || (a.track.id === w.track?.id && a.sourceMediaId === w.track?.sourceId));
  const canTrack = w.clip?.source?.type === 'video' && !w.clip.source.liveInputId;
  const blocked = w.busy || w.locked || editor.actionBusy;
  const useResult = (action: 'use' | 'scene-3d', project = false) => {
    const result = w.publish();
    if (result) {
      if(action==='use') editor.setEditor({assetId:result.id,attachMode:project?'surface':'follow',message:''});
      else requestTrackingAssetAction(action, {...result, sourceVideoClipId: clipId ?? result.sourceVideoClipId});
    }
  };
  const duration = Math.max(1e-6, w.to-w.from);
  const calibration = w.track?.terrain ? assessTrackingSceneCalibration(w.track.terrain.intrinsics) : null;
  return <div className="surface-tracking tracking-workspace" onPointerUp={e => {
    (e.target instanceof HTMLElement ? e.target.closest('button') : null)?.blur();
  }}>
    <div className="surface-heading"><strong>Tracking</strong>{canTrack && <button title="Create another reusable result" disabled={blocked} onClick={w.create}>+ Result</button>}</div>
    {!!w.tracks.length && !assetId && <label>Result <select aria-label="Tracking result" value={w.track?.id ?? ''} disabled={blocked} onChange={e => w.select(e.target.value)}>
      {w.tracks.map(t => <option key={t.id} value={t.id}>{assets.find(a=>a.track.id===t.id&&a.sourceMediaId===t.sourceId)?.name??t.name}</option>)}
    </select></label>}
    {w.track && <label>Name <input aria-label="Tracking result name" key={`${w.track.id}:${asset?.name}`} defaultValue={asset?.name ?? w.track.name} disabled={blocked} onBlur={e => {
      const name = e.currentTarget.value.trim(); if (!name) return;
      if (asset) useTrackingStore.getState().renameAsset(asset.id, name); else w.update({name});
    }} onKeyDown={e => {if (e.key === 'Enter') e.currentTarget.blur();}}/></label>}
    {canTrack && <>
      <div className="surface-buttons">
        <button disabled={blocked || !w.url} title="Set four corners in Preview, then track from the playhead" onClick={() => {
          if (!w.track || w.track.terrain) w.create(); else editor.setEditor({tool:'surface', view:'video'});
        }}>Track surface</button>
        <button disabled={blocked || !w.url} title="Solve a short camera move and coarse surface. Import a reconstruction for detailed geometry." onClick={() => {
          if (!w.track) w.create();
          w.setRange({from: Math.max(w.from, w.time - 2), to: Math.min(w.to, w.time + 2)});
          editor.setEditor({tool:'surface', view:'video'});
          w.setMessage('Set the area in Preview, then choose Reconstruct.');
        }}>Reconstruct 3D</button>
      </div>
      {!w.url && <span className="surface-quality">Relink the video to calculate new tracking.</span>}
      <input hidden ref={input} type="file" accept=".json,.msterrain.json" onChange={e => {const file=e.target.files?.[0]; if(file) void w.importFile(file);e.currentTarget.value='';}}/>
      <button disabled={blocked} title="Import a .msterrain.json camera and mesh reconstruction" onClick={() => input.current?.click()}>Import reconstruction…</button>
    </>}
    {w.track && <>
      <div className="surface-buttons" role="group" aria-label="Tracking preview view">
        <button aria-pressed={editor.view==='video'} onClick={() => editor.setEditor({view:'video'})}>Video</button>
        {w.track.terrain && <button aria-pressed={editor.view==='3d'} onClick={() => editor.setEditor({view:'3d',tool:'inspect'})}>3D</button>}
      </div>
      <div className="tracking-coverage" aria-label="Tracked source coverage" title="Colored sections have tracking. Gaps have no solution.">
        {ranges.map((range,i) => <i key={i} style={{left:`${Math.max(0,(range.from-w.from)/duration)*100}%`,width:`${Math.max(0,Math.min(w.to,range.to)-Math.max(w.from,range.from))/duration*100}%`}}/>)}
      </div>
      <span className="surface-quality">{w.track.terrain ? `${w.track.terrain.cameras.length} camera frames · ${w.track.terrain.medianError.toFixed(2)} px` : `${w.track.samples.length} tracked frames`}
        {' · '}{w.camera || w.sample ? 'Tracked here' : 'No tracking here'}</span>
      {canTrack && <details open={editor.tool==='surface' || editor.tool==='occlusion'}>
        <summary>Track &amp; correct</summary><div className="tracking-section">
          <div className="surface-buttons"><button disabled={blocked} aria-pressed={editor.tool==='surface'} onClick={() => editor.setEditor({tool:'surface',view:'video',draft:null})}>Set area</button>
            <button disabled={blocked} aria-pressed={editor.tool==='occlusion'} onClick={() => editor.setEditor({tool:'occlusion',view:'video',draft:w.quad})}>Exclude area</button>
            <button disabled={blocked || !editor.draft} onClick={w.saveCorrection}>Apply correction</button></div>
          <div className="tracking-range">{(['from','to'] as const).map(key => <label key={key}>{key==='from'?'Start':'End'}<input type="number" aria-label={`Tracking range ${key}`} step={1/w.fps} min={w.from} max={w.to} value={Number(w.range[key].toFixed(3))} disabled={blocked} onChange={e => {const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n))w.setRange({...w.range,[key]:n});}}/></label>)}</div>
          <div className="surface-buttons"><button disabled={blocked||!w.url} onClick={() => void w.run('surface',-1)}>← Track</button><button disabled={blocked||!w.url} onClick={() => void w.run('surface',1)}>Track →</button>
            <button disabled={blocked||!w.url} title="Short solve: 8–180 source frames. Detailed meshes can be imported." onClick={() => void w.run('3d')}>Reconstruct</button></div>
        </div>
      </details>}
      <div className="surface-buttons"><button disabled={blocked || !ranges.length} onClick={() => useResult('use')}>Attach element</button>
        <button disabled={blocked || !ranges.length} onClick={() => useResult('use',true)}>Project onto surface</button>
        {w.track.terrain && calibration?.exactSupported && <button disabled={blocked} onClick={() => useResult('scene-3d')}>Create 3D scene</button>}
        {w.track.terrain && calibration && !calibration.exactSupported && <button disabled={blocked} title={`The model stays exact. The scene camera approximates the lens: up to ${calibration.maxPixelError.toFixed(2)} pixels at reconstruction resolution. Video surface projection keeps the full calibration.`} onClick={()=>{
          const result=w.publish();if(result)requestTrackingAssetAction('scene-3d',result,{allowApproximateCamera:true});
        }}>Create 3D scene · approximate lens</button>}</div>
      {editor.attachMode&&editor.assetId&&<TrackingAttachPicker assetId={editor.assetId} sourceClipId={clipId} mode={editor.attachMode}/>}
      {asset && <span className="surface-quality" title="Stored once with the project. Linked clips share the geometry.">Saved in Media · Tracking</span>}
      {canTrack && <details onToggle={e => setLegacy(e.currentTarget.open)}><summary>Legacy overlay controls</summary>
        {legacy && <Suspense fallback={null}><LegacyControls clipId={clipId!}/></Suspense>}
      </details>}
    </>}
    {w.busy && <><progress max={1} {...(w.progress===null?{}:{value:w.progress})}/><button onClick={w.cancel}>Cancel</button></>}
    <p role="status" className="surface-status">{w.message || editor.message}</p>
    {canTrack && clipId && <details><summary>Connect this clip to tracking</summary><TrackingConnectionControls clipId={clipId}/></details>}
  </div>;
}
