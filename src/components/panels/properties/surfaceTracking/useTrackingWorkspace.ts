import { trackingTimelineTime } from '../../../../services/planarTracking/trackingTimelineTime';
import { refineObjectSamples } from '../../../../services/objectTracking/objectRefinement';
import { deleteSurfaceTrack } from '../../../../services/planarTracking/deleteSurfaceTrack';
import { trackingLivePreview } from '../../../../services/planarTracking/trackingLivePreview';
import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTrackingStore } from '../../../../stores/trackingStore';
import { useTrackingEditorStore } from '../../../../stores/trackingEditorStore';
import { editSurfaceTracks } from '../../../../services/planarTracking/surfaceTrackEditing';
import { publishTrackingAsset } from '../../../../services/planarTracking/trackingAssets';
import { surfaceSourceTime } from '../../../../services/planarTracking/surfaceEffects';
import { replaceSamples, sampleSurface, validQuad } from '../../../../services/planarTracking/surfaceGeometry';
import { sampleTerrainCamera } from '../../../../services/planarTracking/terrainProjection';
import { trackSurface } from '../../../../services/planarTracking/trackSurface';
import { solveTerrain } from '../../../../services/planarTracking/solveTerrain';
import { parseDenseTerrain, MAX_TERRAIN_IMPORT_BYTES } from '../../../../services/planarTracking/denseTerrainImport';
import type { PlanarTrack, SurfaceQuad } from '../../../../types/planarTracking';
import { contourBounds, validContour } from '../../../../services/objectTracking/objectContour';
import { openObjectFrames } from '../../../../services/objectTracking/objectFrames';
import { ObjectSelectionSession } from '../../../../services/objectTracking/selectObject';
import { objectEnclosure } from '../../../../services/objectTracking/objectEnclosure';
import { trackObject } from '../../../../services/objectTracking/trackObject';

export const DEFAULT_TRACKING_QUAD: SurfaceQuad = [{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}];

export function getTrackingWorkspaceBounds(track: PlanarTrack | undefined, fps: number): {from: number; to: number} | null {
  if (!track) return null;
  const frames = track.terrain?.cameras.length ? track.terrain.cameras : track.samples;
  if (frames.length > 0) {
    return frames.reduce((bounds, frame) => {
      const duration = frame.duration && frame.duration > 0 ? frame.duration : 1 / fps;
      return {from: Math.min(bounds.from, frame.time), to: Math.max(bounds.to, frame.time + duration)};
    }, {from: Number.POSITIVE_INFINITY, to: Number.NEGATIVE_INFINITY});
  }
  return Number.isFinite(track.visibleFrom) && Number.isFinite(track.visibleTo) && track.visibleTo >= track.visibleFrom
    ? {from: track.visibleFrom, to: track.visibleTo}
    : null;
}

export function useTrackingWorkspace(clipId?: string, assetId?: string) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  const playhead = useTimelineStore(s => s.playheadPosition);
  const locked = useTimelineStore(s => s.isExporting || !!s.tracks.find(t => t.id === clip?.trackId)?.locked);
  const file = useMediaStore(s => s.files.find(f => f.id === (clip?.source?.mediaFileId ?? clip?.mediaFileId)));
  const asset = useTrackingStore(s => s.assets.find(a => a.id === assetId));
  const editor = useTrackingEditorStore();
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState(''), [url, setUrl] = useState('');
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const selectionSession=useRef<ObjectSelectionSession|null>(null);
  const handledPrompts=useRef<unknown>(null);
  const tracks = clip?.planarTracks ?? [];
  const requestedTrackId = asset?.track.id ?? editor.trackId;
  const track = tracks.find(t => t.id === requestedTrackId) ?? asset?.track ?? tracks[0];
  const fpsCandidate = track?.fps ?? file?.fps ?? 30;
  const fps = Number.isFinite(fpsCandidate) && fpsCandidate > 0 ? fpsCandidate : 30;
  const time = clip ? surfaceSourceTime(clip, Math.max(0, playhead - clip.startTime), useTimelineStore.getState().getClipKeyframes(clip.id)) : track?.referenceTime ?? 0;
  const sample = track ? sampleSurface(track, time) : null;
  const camera = track?.terrain ? sampleTerrainCamera(track.terrain, time) : null;
  const quad = (editor.trackId === track?.id ? editor.draft : null) ?? sample?.quad ?? track?.referenceQuad ?? DEFAULT_TRACKING_QUAD;
  const assetBounds = getTrackingWorkspaceBounds(track, fps);
  const from = clip?.inPoint ?? assetBounds?.from ?? 0;
  const to = clip ? Math.max(from, (clip.outPoint ?? from) - 1 / fps) : assetBounds?.to ?? from;
  const [range, setRange] = useState({from, to});
  useEffect(() => { setRange({from, to}); }, [clipId, assetId, track?.id, from, to]);
  const sourceFile = clip?.file ?? file?.file;
  const runtimeUrl = clip?.source?.videoElement?.currentSrc || file?.url || '';
  useEffect(() => {
    if (runtimeUrl) { setUrl(runtimeUrl); return; }
    if (sourceFile) { const owned = URL.createObjectURL(sourceFile); setUrl(owned); return () => URL.revokeObjectURL(owned); }
    setUrl('');
  }, [runtimeUrl, sourceFile]);
  useEffect(() => () => controller.current?.abort(), [clipId, assetId]);
  useEffect(() => {
    useTrackingEditorStore.getState().setEditor({active: true, clipId: clipId ?? null, assetId: assetId ?? null, trackId: track?.id ?? null});
  }, [clipId, assetId, track?.id]);
  useEffect(() => () => useTrackingEditorStore.getState().setEditor({active: false, actionBusy:false, draft: null, contourDraft: null, objectPaddingDraft:null, objectPrompts: [], tool: 'inspect', view: 'video'}), []);
  useEffect(() => { if(useTrackingEditorStore.getState().tool==='pick-object')controller.current?.abort(); selectionSession.current?.dispose(); selectionSession.current=null; const restored=sample?.manual?structuredClone(sample.objectPrompts??[]):[]; handledPrompts.current=restored; useTrackingEditorStore.getState().setEditor({draft: null, contourDraft: null,objectPaddingDraft:null,objectPrompts:restored}); }, [time, track?.id]);
  useEffect(()=>()=>{selectionSession.current?.dispose();trackingLivePreview.clear();},[]);
  useEffect(()=>{trackingLivePreview.clear();},[time,track?.id,editor.tool]);
  useEffect(() => { useTrackingEditorStore.getState().setEditor({actionBusy:busy}); },[busy]);
  const contour=editor.contourDraft??sample?.contour??track?.object?.referenceContour??quad;
  const objectPadding=editor.objectPaddingDraft??track?.object?.padding??.10;
  const detailContour=sample?.detailContour??(sample?.manual||Math.abs(time-(track?.referenceTime??0))<1/fps?track?.object?.detailContour:sample?.contour)??contour;

  useEffect(() => {
    const prompts=editor.objectPrompts;
    if(!prompts.length||handledPrompts.current===prompts)return;
    if(!clip||!track?.object||!url||busyRef.current||locked)return;
    handledPrompts.current=prompts;
    const original=track, sourceId=track.sourceId, originalTime=time;
    const abort=new AbortController();controller.current=abort;busyRef.current=true;setBusy(true);setMessage('Loading selection model…');
    void (async()=>{
      const reader=await openObjectFrames({id:sourceId,url,file:sourceFile},abort.signal);
      try {
        const frame=await reader.read(originalTime);
        const session=selectionSession.current??=new ObjectSelectionSession();
        const detail=await session.select(frame.pixels,`${sourceId}:${frame.time}`,prompts,abort.signal,setMessage);
        if(useTrackingEditorStore.getState().objectPrompts!==prompts)return;
        abort.signal.throwIfAborted();
        const points=objectEnclosure(detail,original.samples.length?original.object!.referenceContour.length:6,objectPadding);
        if(!validContour(points))throw new Error('Selection needs a more detailed outline. Try another point.');
        const current=useTimelineStore.getState();
        const currentClip=current.clips.find(c=>c.id===clip.id);
        if(!currentClip||Math.abs(surfaceSourceTime(currentClip,Math.max(0,current.playheadPosition-currentClip.startTime),current.getClipKeyframes(clip.id))-originalTime)>1e-6)throw new Error('Playhead moved during selection. Click the object again on this frame.');
        editSurfaceTracks(clip.id,'Select object',list=>{
          if(list.find(t=>t.id===original.id)!==original)throw new Error('Tracking changed during selection. Try again.');
          const next={...original,referenceTime:frame.time,referenceQuad:contourBounds(points),object:{referenceContour:points,detailContour:detail,padding:objectPadding}};
          const anchor={time:frame.time,duration:frame.duration,quad:next.referenceQuad,contour:points,detailContour:detail,confidence:1,manual:true,objectPrompts:structuredClone(prompts)};
          return list.map(t=>t.id===original.id?{...next,samples:refineObjectSamples(original.samples,[...original.samples.filter(s=>s.manual&&Math.abs(s.time-frame.time)>1e-6),anchor])}:t);
        });
        useTrackingEditorStore.getState().setEditor({tool:'pick-object',contourDraft:null});
        setMessage('Selection updated');
      }finally{reader.close();}
    })().catch(error=>setMessage(abort.signal.aborted?'Selection cancelled; previous result kept.':error instanceof Error?error.message:String(error)))
      .finally(()=>{busyRef.current=false;setBusy(false);controller.current=null;});
  // Coalesce rapid clicks while inference runs; only the latest prompt set commits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editor.objectPrompts,busy]);

  const update = (patch: Partial<PlanarTrack>) => {
    if (!track || !clipId) return;
    editSurfaceTracks(clipId, 'Edit tracking', list => list.map(t => t.id === track.id ? {...t, ...patch} : t));
  };
  const create = (kind:'surface'|'object'='surface'): PlanarTrack => {
    if (!clipId || !clip) throw new Error('Select a source video clip.');
    const next: PlanarTrack = {id: crypto.randomUUID(), name: `Surface ${tracks.length + 1}`, sourceId: clip.source?.mediaFileId ?? clip.mediaFileId ?? clipId,
      fps, referenceTime: time, referenceQuad: structuredClone(DEFAULT_TRACKING_QUAD), samples: [], occlusions: [], enabled: false,
      color: '#50c8ff', opacity: 1, fill: 0, lineWidth: 2, inset: 0, shape: 'outline', visibleFrom: from, visibleTo: to, fade: 0,
      ...(kind==='object'?{name:`Object ${tracks.length+1}`,enabled:false,object:{referenceContour:structuredClone(DEFAULT_TRACKING_QUAD),detailContour:structuredClone(DEFAULT_TRACKING_QUAD)}}:{})};
    editSurfaceTracks(clipId, 'Create tracking result', list => [...list, next]);
    useTrackingEditorStore.getState().setEditor({trackId: next.id, draft: next.referenceQuad, contourDraft:null, objectPaddingDraft:null, objectPrompts:[], tool: kind==='object'?'pick-object':'surface'});
    return next;
  };
  const report = (fn: () => unknown) => { try { fn(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const run = async (kind: 'surface' | '3d', direction: -1 | 1 = 1) => {
    if (!clip || !clipId || !url || busyRef.current || locked) return;
    const abort = new AbortController(); controller.current = abort; busyRef.current = true; setBusy(true); setProgress(null);
    try {
      if (!validQuad(quad)) throw new Error('Adjust the four corners so they do not cross.');
      if (![range.from, range.to].every(Number.isFinite) || range.from < from || range.to > to || range.from >= range.to || time < range.from || time > range.to) throw new Error('Choose a range inside this clip that includes the playhead.');
      const original = track ?? create();
      useTrackingEditorStore.getState().setEditor({tool:'inspect',view:'video',objectPrompts:[]});
      trackingLivePreview.clear();
      const onFrame = (sample: import('../../../../types/planarTracking').SurfaceSample, pixels: ImageData) => {
        if(!abort.signal.aborted)trackingLivePreview.show({clipId,trackId:original.id,pixels,sample});
      };
      let patch: Partial<PlanarTrack>;
      if (kind === '3d') {
        setMessage('Reconstructing camera and surface…');
        const terrain = await solveTerrain({url, file: sourceFile, from: range.from, to: range.to, referenceTime: time, quad, signal: abort.signal, onProgress: setMessage});
        patch = {terrain, projection: 'mesh'};
      } else {
        setMessage(original.object?'Tracking object…':'Tracking surface…');
        const end = direction > 0 ? range.to : range.from;
        const result = original.object
          ? await trackObject({asset:{id:original.sourceId,url,file:sourceFile},from:time,to:end,contour,padding:objectPadding,detail:editor.contourDraft&&editor.objectPaddingDraft===null?contour:detailContour,signal:abort.signal,onProgress:setProgress,onFrame})
          : await trackSurface({url, file: sourceFile, track: original, from: time, to: end, quad, signal: abort.signal, onProgress: setProgress,onFrame});
        const refined=original.object?refineObjectSamples(result.samples,original.samples.filter(s=>s.manual&&s.time>=(result.samples[0]?.time??Math.min(time,end))-1e-6&&s.time<=(result.samples.at(-1)?.time??Math.max(time,end))+1e-6)):result.samples;
        patch = {...replaceSamples(original, refined, result.samples[0]?.time??time, result.samples.at(-1)?.time??time), referenceTime: (direction>0?result.samples[0]:result.samples.at(-1))?.time??time, referenceQuad: structuredClone(original.object?contourBounds(contour):quad),
          ...(original.object?{object:{referenceContour:structuredClone(contour),detailContour:structuredClone(editor.contourDraft&&editor.objectPaddingDraft===null?contour:detailContour),padding:objectPadding}}:{})};
        setMessage(result.stopped ? `Stopped: ${result.stopped}` : `Complete: ${result.samples.length} frames tracked`);
      }
      abort.signal.throwIfAborted();
      editSurfaceTracks(clipId, kind === '3d' ? 'Reconstruct 3D' : original.object ? 'Track object' : 'Track surface', list => {
        if (list.find(t => t.id === original.id) !== original) throw new Error('Tracking changed during the operation. Please try again.');
        return list.map(t => t.id === original.id ? {...t, ...patch} : t);
      });
      useTrackingEditorStore.getState().setEditor({draft: null, contourDraft:null, objectPaddingDraft:null, tool: 'inspect'});
      if (kind === '3d') setMessage('3D reconstruction ready');
      const last=trackingLivePreview.frame;
      if(last) {
        const timeline=useTimelineStore.getState(),media=useMediaStore.getState();
        const outputFps=media.compositions.find(c=>c.id===media.activeCompositionId)?.frameRate??30;
        timeline.setPlayheadPosition(trackingTimelineTime(clip,last.sample,timeline.getClipKeyframes(clipId),outputFps,timeline.playheadPosition));
        trackingLivePreview.clear();
      }
    } catch (error) { setMessage(abort.signal.aborted ? 'Stopped by you. Previous result kept.' : `Stopped: ${error instanceof Error ? error.message : String(error)}`); }
    finally { busyRef.current = false; setBusy(false); setProgress(null); controller.current = null; }
  };
  const importFile = async (input: File) => {
    if (!clip || !clipId || busyRef.current || locked) return;
    busyRef.current = true; setBusy(true);
    try {
      if (input.size > MAX_TERRAIN_IMPORT_BYTES) throw new Error('Reconstruction exceeds 100 MB.');
      const terrain = parseDenseTerrain(await input.text(), file?.name);
      const original = !track||track.object ? create() : track;
      editSurfaceTracks(clipId, 'Import tracking reconstruction', list => list.map(t => t.id === original.id ? {...t, terrain, projection: 'mesh'} : t));
      setMessage('Camera and mesh imported');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCorrection = () => report(() => {
    if (!track || !validQuad(quad)) throw new Error('Adjust the four corners first.');
    if (editor.tool === 'occlusion') update({occlusions: [...track.occlusions.filter(k => Math.abs(k.time - time) > 1e-6), {time, quad}].toSorted((a,b) => a.time-b.time)});
    else {
      if(track.object&&!validContour(contour))throw new Error('Outline edges must not cross. Keep at least three points.');
      const correctionTime = sample?.time ?? time;
      const correctionDuration = sample?.duration && sample.duration > 0 ? sample.duration : 1 / fps;
      const bounds=track.object?contourBounds(contour):quad;
      const corrected=replaceSamples(track, [{time: correctionTime, duration: correctionDuration, quad:bounds, confidence: 1, manual: true,...(track.object?{objectPrompts:structuredClone(editor.objectPrompts),contour:structuredClone(contour),detailContour:structuredClone(editor.objectPaddingDraft===null?contour:detailContour)}:{})}], correctionTime, correctionTime);
      update({...corrected,...(track.object?{samples:refineObjectSamples(track.samples,corrected.samples.filter(s=>s.manual))}:{}), referenceTime: correctionTime, referenceQuad: structuredClone(bounds),
        ...(track.object?{object:{referenceContour:structuredClone(contour),detailContour:structuredClone(editor.contourDraft&&editor.objectPaddingDraft===null?contour:detailContour),padding:objectPadding}}:{})});
    }
    useTrackingEditorStore.getState().setEditor({draft: null, contourDraft:null, objectPaddingDraft:null, tool: 'inspect'});
  });
  const publish = () => { if (track && clipId) return publishTrackingAsset(clipId, track); return asset; };
  return {clip, track, tracks, asset, fps, time, from, to, range, setRange, sample, camera, quad, contour, detailContour, objectPadding, busy, locked, progress, message, setMessage, url,
    select: (id: string) => useTrackingEditorStore.getState().setEditor({trackId: id, assetId: null, draft: null, contourDraft:null, objectPaddingDraft:null, objectPrompts:[], tool: 'inspect'}),
    remove: (id:string) => report(()=>{if(!clipId||busyRef.current||locked)return;deleteSurfaceTrack(clipId,id);if(track?.id===id)useTrackingEditorStore.getState().setEditor({trackId:null,draft:null,contourDraft:null,objectPrompts:[],tool:'inspect'});trackingLivePreview.clear();}),
    create: () => report(()=>create()), createObject:()=>report(()=>create('object')), update, run, importFile, saveCorrection, publish, cancel: () => controller.current?.abort()};
}
