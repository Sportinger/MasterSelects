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
import { ResolveInspectorSection, ResolveInspectorRow } from '../resolveInspector/ResolveInspectorPrimitives';
import '../trackingPanel.css';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { objectEnclosure } from '../../../../services/objectTracking/objectEnclosure';
import { createObjectMask } from '../../../../services/objectTracking/objectMask';
const LegacyControls = lazy(() => import('./LegacySurfaceTrackingTab').then(m => ({default: m.LegacySurfaceTrackingTab})));

export function SurfaceTrackingTab({clipId, assetId}: {clipId?: string; assetId?: string}) {
  const isSource = useTimelineStore(s => {const clip=s.clips.find(c=>c.id===clipId);return clip?.source?.type==='video'&&!clip.source.liveInputId&&!clip.trackingBinding;});
  return <div className="tracking-panel">{isSource && clipId && <DepthEstimationControls key={`depth:${clipId}`} clipId={clipId} />}{isSource && clipId && <PreciseFaceTrackingControls key={clipId} clipId={clipId} />}{isSource || assetId ? <TrackingResultTab clipId={clipId} assetId={assetId}/> : clipId ? <TrackingConnectionControls clipId={clipId}/> : null}</div>;
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
  const handleUseResult = (action: 'use' | 'scene-3d', project = false) => {
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
    <ResolveInspectorSection title="Object & surface" defaultOpen indicator="none">
    <ResolveInspectorSection title="Tracks" indicator="none" collapsible={false}>
      <div className="tracking-result-list" role="list" aria-label="Saved tracks">
        {w.tracks.map(t => <div role="listitem" key={t.id} className={`tracking-result-item${w.track?.id===t.id?' is-selected':''}`}>
          <button className="tracking-result-select" aria-pressed={w.track?.id===t.id} disabled={blocked} onClick={()=>w.select(t.id)}>
            <span>{assets.find(a=>a.track.id===t.id&&a.sourceMediaId===t.sourceId)?.name??t.name}</span>
            <small>{t.object?'Object':t.terrain?'3D':'Surface'} / {t.terrain?.cameras.length??t.samples.length} frames</small>
          </button>
          <button className="tracking-result-delete" aria-label={`Delete ${t.name}`} title={`Delete ${t.name}`} disabled={blocked} onClick={()=>w.remove(t.id)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 6v6M9 6v6"/></svg>
          </button>
        </div>)}
        {!w.tracks.length&&<span className="tracking-empty">No tracks</span>}
      </div>
    {canTrack && <>
      <div className="surface-buttons">
        <button disabled={blocked || !w.url} title="Set four corners in Preview, then track from the playhead" onClick={() => {
          w.create();
        }}>+ Surface</button>
        <button disabled={blocked||!w.url} title="Click a person or object, then refine its outline" onClick={()=>{
          w.createObject();
        }}>+ Object</button>
        <button disabled={blocked || !w.url} title="Solve a short camera move and coarse surface. Import a reconstruction for detailed geometry." onClick={() => {
          w.create();
          w.setRange({from: Math.max(w.from, w.time - 2), to: Math.min(w.to, w.time + 2)});
          editor.setEditor({tool:'surface', view:'video'});
          w.setMessage('');
        }}>+ 3D</button>
      </div>
      {!w.url && <span className="surface-quality">Relink the video to calculate new tracking.</span>}
      <input hidden ref={input} type="file" accept=".json,.msterrain.json" onChange={e => {const file=e.target.files?.[0]; if(file) void w.importFile(file);e.currentTarget.value='';}}/>
      <button disabled={blocked} title="Import a .msterrain.json camera and mesh reconstruction" onClick={() => input.current?.click()}>Import 3D</button>
    </>}
    </ResolveInspectorSection>
    {w.track && <>
      <ResolveInspectorRow label="Name"><input className="tracking-name" aria-label="Tracking result name" key={`${w.track.id}:${asset?.name}`} defaultValue={asset?.name ?? w.track.name} disabled={blocked} onBlur={e=>{
        const name=e.currentTarget.value.trim(); if(!name)return;
        if(asset)useTrackingStore.getState().renameAsset(asset.id,name);else w.update({name});
      }} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></ResolveInspectorRow>
      {w.track.terrain&&<div className="surface-buttons" role="group" aria-label="Tracking preview view">
        <button aria-pressed={editor.view==='video'} onClick={() => editor.setEditor({view:'video'})}>Video</button>
        {w.track.terrain && <button aria-pressed={editor.view==='3d'} onClick={() => editor.setEditor({view:'3d',tool:'inspect'})}>3D</button>}
      </div>
      }<div className="tracking-coverage" aria-label="Tracked source coverage" title="Colored sections have tracking. Gaps have no solution.">
        {ranges.map((range,i) => <i key={i} style={{left:`${Math.max(0,(range.from-w.from)/duration)*100}%`,width:`${Math.max(0,Math.min(w.to,range.to)-Math.max(w.from,range.from))/duration*100}%`}}/>)}
      </div>
      <span className="surface-quality">{w.track.terrain ? `${w.track.terrain.cameras.length} camera frames · ${w.track.terrain.medianError.toFixed(2)} px` : `${w.track.samples.length} tracked frames`}
        {' / '}{w.track.samples.filter(s=>s.manual).length} user frames</span>
      {w.track.object&&<ResolveInspectorSection title="Selection" indicator="none">
        <div className="surface-buttons" role="group" aria-label="Selection click mode"><button disabled={blocked&&editor.tool!=='pick-object'} aria-pressed={!editor.objectSubtract} onClick={()=>editor.setEditor({objectSubtract:false,tool:'pick-object'})}>+ Include</button><button disabled={blocked&&editor.tool!=='pick-object'} aria-pressed={editor.objectSubtract} onClick={()=>editor.setEditor({objectSubtract:true,tool:'pick-object'})}>− Exclude</button></div>
        <div className="surface-buttons"><button disabled={blocked} aria-pressed={editor.tool==='pick-object'} onClick={()=>editor.setEditor({tool:'pick-object',view:'video'})}>Refine</button>
          <button disabled={(blocked&&editor.tool!=='pick-object')||editor.objectPrompts.length<2} onClick={()=>editor.setEditor({objectPrompts:editor.objectPrompts.slice(0,-1)})}>Undo click</button>
          <button disabled={blocked||!editor.objectPrompts.length} onClick={()=>editor.setEditor({objectPrompts:[],tool:'pick-object'})}>Reset</button></div>
        <ResolveInspectorNumberRow label="Points" ariaLabel="Object outline points" value={w.contour.length} defaultValue={6} min={4} max={32} numberMax={64} hardMin={3} hardMax={64} step={1} disabled={blocked}
          onChange={value=>editor.setEditor({tool:'object',objectPaddingDraft:w.objectPadding,contourDraft:objectEnclosure(w.detailContour,value,w.objectPadding)})}/>
        <ResolveInspectorNumberRow label="Padding" ariaLabel="Selection padding" value={w.objectPadding*100} defaultValue={10} min={0} max={50} hardMin={0} hardMax={50} step={1} suffix="%" disabled={blocked}
          onChange={value=>editor.setEditor({tool:'object',objectPaddingDraft:value/100,contourDraft:objectEnclosure(w.detailContour,w.contour.length,value/100)})}/>
        <ResolveInspectorRow label="Render outline"><input aria-label="Render outline" type="checkbox" checked={w.track.enabled} disabled={blocked} onChange={e=>w.update({enabled:e.target.checked})}/></ResolveInspectorRow>
      </ResolveInspectorSection>}
      {canTrack && <ResolveInspectorSection title="Track" indicator="none">
          <div className="surface-buttons"><button disabled={blocked} aria-pressed={editor.tool===(w.track.object?'object':'surface')} onClick={() => editor.setEditor({tool:w.track!.object?'object':'surface',view:'video',draft:null})}>{w.track.object?'Edit outline':'Set area'}</button>
            <button disabled={blocked} aria-pressed={editor.tool==='occlusion'} onClick={() => editor.setEditor({tool:'occlusion',view:'video',draft:w.quad})}>Exclude area</button>
            <button disabled={blocked || (!editor.draft&&!editor.contourDraft)} onClick={w.saveCorrection}>Apply correction</button></div>
          {(['from','to'] as const).map(key=><ResolveInspectorNumberRow key={key} label={key==='from'?'Start':'End'} ariaLabel={`Tracking range ${key}`} value={w.range[key]} defaultValue={key==='from'?w.from:w.to} min={w.from} max={w.to} hardMin={w.from} hardMax={w.to} step={1/w.fps} decimals={3} suffix="s" disabled={blocked} onChange={value=>w.setRange({...w.range,[key]:value})}/>)}
          <div className="surface-buttons"><button disabled={blocked||!w.url} onClick={() => void w.run('surface',-1)}>← Track</button><button disabled={blocked||!w.url} onClick={() => void w.run('surface',1)}>Track →</button>
            {!w.track.object&&<button disabled={blocked||!w.url} title="Short solve: 8–180 source frames. Detailed meshes can be imported." onClick={() => void w.run('3d')}>Reconstruct</button>}</div>
      </ResolveInspectorSection>}
      <ResolveInspectorSection title="Use track" indicator="none" defaultOpen={false}><div className="surface-buttons"><button disabled={blocked || !ranges.length} onClick={() => handleUseResult('use')}>Attach element</button>
        {w.track.object&&clipId&&<button disabled={blocked||!ranges.length} onClick={()=>{
          try{createObjectMask(clipId,w.track!);w.setMessage('Animated mask created');}
          catch(error){w.setMessage(error instanceof Error?error.message:String(error));}
        }}>Create animated mask</button>}
        {!w.track.object&&<button disabled={blocked || !ranges.length} onClick={() => handleUseResult('use',true)}>Project onto surface</button>}
        {w.track.terrain && calibration?.exactSupported && <button disabled={blocked} onClick={() => handleUseResult('scene-3d')}>Create 3D scene</button>}
        {w.track.terrain && calibration && !calibration.exactSupported && <button disabled={blocked} title={`The model stays exact. The scene camera approximates the lens: up to ${calibration.maxPixelError.toFixed(2)} pixels at reconstruction resolution. Video surface projection keeps the full calibration.`} onClick={()=>{
          const result=w.publish();if(result)requestTrackingAssetAction('scene-3d',result,{allowApproximateCamera:true});
        }}>Create 3D scene · approximate lens</button>}</div>
      {editor.attachMode&&editor.assetId&&<TrackingAttachPicker assetId={editor.assetId} sourceClipId={clipId} mode={editor.attachMode}/>}

      </ResolveInspectorSection>
      {canTrack && !w.track.object && <details onToggle={e => setLegacy(e.currentTarget.open)}><summary>Overlay</summary>
        {legacy && <Suspense fallback={null}><LegacyControls clipId={clipId!}/></Suspense>}
      </details>}
    </>}
    {w.busy && <><progress aria-label="Tracking progress" max={1} {...(w.progress===null?{}:{value:w.progress})}/><button onClick={w.cancel}>Cancel</button></>}
    <p role={w.message.startsWith('Stopped')?'alert':'status'} className={`surface-status${w.message.startsWith('Stopped')?' is-stopped':''}`}>{w.message || editor.message}</p>
    </ResolveInspectorSection>
    {canTrack && clipId && <ResolveInspectorSection title="Link clip" defaultOpen={false} indicator="none"><TrackingConnectionControls clipId={clipId}/></ResolveInspectorSection>}
  </div>;
}
