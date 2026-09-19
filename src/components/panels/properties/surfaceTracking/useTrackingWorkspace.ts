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
  useEffect(() => () => useTrackingEditorStore.getState().setEditor({active: false, draft: null, tool: 'inspect', view: 'video'}), []);
  useEffect(() => { useTrackingEditorStore.getState().setEditor({draft: null}); }, [time, track?.id]);

  const update = (patch: Partial<PlanarTrack>) => {
    if (!track || !clipId) return;
    editSurfaceTracks(clipId, 'Edit tracking', list => list.map(t => t.id === track.id ? {...t, ...patch} : t));
  };
  const create = (): PlanarTrack => {
    if (!clipId || !clip) throw new Error('Select a source video clip.');
    const next: PlanarTrack = {id: crypto.randomUUID(), name: `Surface ${tracks.length + 1}`, sourceId: clip.source?.mediaFileId ?? clip.mediaFileId ?? clipId,
      fps, referenceTime: time, referenceQuad: structuredClone(DEFAULT_TRACKING_QUAD), samples: [], occlusions: [], enabled: false,
      color: '#50c8ff', opacity: 1, fill: 0, lineWidth: 2, inset: 0, shape: 'outline', visibleFrom: from, visibleTo: to, fade: 0};
    editSurfaceTracks(clipId, 'Create tracking result', list => [...list, next]);
    useTrackingEditorStore.getState().setEditor({trackId: next.id, draft: next.referenceQuad, tool: 'surface'});
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
      let patch: Partial<PlanarTrack>;
      if (kind === '3d') {
        setMessage('Reconstructing camera and surface…');
        const terrain = await solveTerrain({url, file: sourceFile, from: range.from, to: range.to, referenceTime: time, quad, signal: abort.signal, onProgress: setMessage});
        patch = {terrain, projection: 'mesh'};
      } else {
        setMessage('Tracking surface…');
        const end = direction > 0 ? range.to : range.from;
        const result = await trackSurface({url, file: sourceFile, track: original, from: time, to: end, quad, signal: abort.signal, onProgress: setProgress});
        patch = {...replaceSamples(original, result.samples, Math.min(time, end), Math.max(time, end)), referenceTime: time, referenceQuad: structuredClone(quad)};
        setMessage(result.stopped ? `Stopped: ${result.stopped}` : `${result.samples.length} frames tracked`);
      }
      abort.signal.throwIfAborted();
      editSurfaceTracks(clipId, kind === '3d' ? 'Reconstruct 3D' : 'Track surface', list => {
        if (list.find(t => t.id === original.id) !== original) throw new Error('Tracking changed during the operation. Please try again.');
        return list.map(t => t.id === original.id ? {...t, ...patch} : t);
      });
      useTrackingEditorStore.getState().setEditor({draft: null, tool: 'inspect'});
      if (kind === '3d') setMessage('3D reconstruction ready');
    } catch (error) { setMessage(abort.signal.aborted ? 'Cancelled — previous result kept' : error instanceof Error ? error.message : String(error)); }
    finally { busyRef.current = false; setBusy(false); setProgress(null); controller.current = null; }
  };
  const importFile = async (input: File) => {
    if (!clip || !clipId || busyRef.current || locked) return;
    busyRef.current = true; setBusy(true);
    try {
      if (input.size > MAX_TERRAIN_IMPORT_BYTES) throw new Error('Reconstruction exceeds 100 MB.');
      const terrain = parseDenseTerrain(await input.text(), file?.name);
      const original = track ?? create();
      editSurfaceTracks(clipId, 'Import tracking reconstruction', list => list.map(t => t.id === original.id ? {...t, terrain, projection: 'mesh'} : t));
      setMessage('Camera and mesh imported');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCorrection = () => report(() => {
    if (!track || !validQuad(quad)) throw new Error('Adjust the four corners first.');
    if (editor.tool === 'occlusion') update({occlusions: [...track.occlusions.filter(k => Math.abs(k.time - time) > 1e-6), {time, quad}].toSorted((a,b) => a.time-b.time)});
    else {
      const correctionTime = sample?.time ?? time;
      const correctionDuration = sample?.duration && sample.duration > 0 ? sample.duration : 1 / fps;
      update({...replaceSamples(track, [{time: correctionTime, duration: correctionDuration, quad, confidence: 1, manual: true}], correctionTime, correctionTime), referenceTime: correctionTime, referenceQuad: structuredClone(quad)});
    }
    useTrackingEditorStore.getState().setEditor({draft: null, tool: 'inspect'});
  });
  const publish = () => { if (track && clipId) return publishTrackingAsset(clipId, track); return asset; };
  return {clip, track, tracks, asset, fps, time, from, to, range, setRange, sample, camera, quad, busy, locked, progress, message, setMessage, url,
    select: (id: string) => useTrackingEditorStore.getState().setEditor({trackId: id, assetId: null, draft: null, tool: 'inspect'}),
    create: () => report(create), update, run, importFile, saveCorrection, publish, cancel: () => controller.current?.abort()};
}
