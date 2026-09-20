import { compileCableOperatorGraph } from './cableOperatorGraph';
import { cableSavedDepth } from './cableSavedDepth';
import { sampleCableConfig } from './cableAnimation';
import { createCableSceneBake } from './cableSceneBake';
import { createCableShadowReceiver, writeCableShadows } from './cableShadows';
import { cableFacePoints, createFaceContact } from './cableFaceSurface';
import { cableSimulationOrder, cableMidpoint } from './cableConnections';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useHistoryStore } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { trackingPreviewTransform } from '../planarTracking/trackingPreviewTransform';
import { surfaceSourceTime } from '../planarTracking/surfaceEffects';
import { landmarkRuntime } from '../landmarkTracking/landmarkRuntime';
import { faceTrackKey, samplePreciseFace } from '../landmarkTracking/preciseFaceSampling';
import { renderHostPort } from '../render/renderHostPort';
import { projectCableDepth, cableWindAtTime } from './cableDepth';
import { createCable, stepCable, type CableState, type CablePoint } from './cablePhysics';
import { cableFrameLayout, FACE_CABLE_ANCHORS, MAX_CABLE_FLOATS, MAX_FACE_CABLES, isFaceCableConfig, encodeCableBake, type FaceCableConfig } from './cableData';
import type { Keyframe } from '../../types/keyframes';
import { cableDepthGrid, calibratedCableDepth, calibrateCableDepth, type CableDepthCalibration } from './cableSceneDepth';
import { openCableDepthReader } from './cableDepthReader';
import { createCableDepthContact } from './cableDepthContact';

function neighborKeys(groups: Keyframe[][], time: number): Keyframe[] {
  return groups.flatMap(keys => {
    let lo = 0, hi = keys.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (keys[mid].time <= time) lo = mid + 1; else hi = mid; }
    return keys.slice(Math.max(0, lo - 1), Math.min(keys.length, lo + 1));
  });
}

export async function bakeFaceCables(clipId: string, effectId: string, configs: FaceCableConfig[], signal: AbortSignal, progress: (value: number) => void,
  report: (message: string) => void = () => {}, reuseDepth = false): Promise<void> {
  assertExclusiveTimelineMutationAllowed();
  const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId), comp = media.getActiveComposition();
  if (!clip || !comp || timeline.isExporting || timeline.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked, or exporting.');
  if (clip.parentClipId || clip.sourceRect || clip.transform.rotation.x || clip.transform.rotation.y || clip.transform.position.z) throw new Error('Bake cables from an unparented frontal video without crop or 3D tilt. Camera and light clips remain freely editable.');
  if (!configs.length || configs.length > MAX_FACE_CABLES) throw new Error(`Choose 1–${MAX_FACE_CABLES} cables.`);
  for (const c of configs) {
    if (!isFaceCableConfig(c) || (!c.fromCableId && c.from === c.to)) throw new Error('Invalid cable settings.');
  }
  const simulationOrder = cableSimulationOrder(configs);
  const parentIndices = configs.map(c => configs.findIndex(parent => parent.id === c.fromCableId));
  const sourceId = clip.source?.mediaFileId ?? clip.mediaFileId ?? clipId;
  const series = landmarkRuntime.getSeries(faceTrackKey(clipId));
  if (!series?.faceTracking || series.sourceId !== sourceId) throw new Error('Track this face precisely first.');
  const file = media.files.find(f => f.id === sourceId);
  const source = { width: file?.width ?? clip.source?.videoElement?.videoWidth ?? 0, height: file?.height ?? clip.source?.videoElement?.videoHeight ?? 0 };
  if (!source.width || !source.height) throw new Error('Source dimensions are unavailable.');
  const operatorPlan = compileCableOperatorGraph(clip.effects.find(e => e.id === effectId)?.params ?? {});
  const { params: effectParams, saved: savedDepth } = cableSavedDepth(operatorPlan.params, operatorPlan.useSavedDepth, reuseDepth);
  const version = effectParams.faceShadows && !effectParams.scene3D ? 4 : 3;
  const layout = cableFrameLayout(version, configs);
  const fps = comp.frameRate, frames = Math.ceil(clip.duration * fps) + 1;
  if (!Number.isFinite(frames) || frames < 2 || frames > 18_001 || frames * layout.stride > MAX_CABLE_FLOATS) throw new Error('This cable bake is too large; use a shorter clip or fewer cables.');
  const keys = timeline.getClipKeyframes(clipId);
  const cableKeys = keys.filter(k => k.property.startsWith(`effect.${effectId}.`));
  if (keys.some(k => ['rotation.x', 'rotation.y', 'position.z'].includes(k.property))) throw new Error('Animated 3D transforms are not supported by face cables.');
  const transformSignature = JSON.stringify(clip.transform);
  const groups = new Map<string, Keyframe[]>();
  for (const k of keys) if (/^(position|scale|rotation|anchor)\./.test(k.property)) groups.set(k.property, [...(groups.get(k.property) ?? []), k]);
  const sorted = [...groups.values()].map(g => g.toSorted((a, b) => a.time - b.time));
  const speedKeys = keys.filter(k => k.property === 'speed');
  const aspect = comp.width / comp.height;
  const depthGrid = effectParams.scene3D && effectParams.sceneDepth ? cableDepthGrid(source.width, source.height) : undefined;
  const depthBinding = depthGrid ? JSON.stringify({ sourceId, source, width: comp.width, height: comp.height, fps,
    inPoint: clip.inPoint, outPoint: clip.outPoint, duration: clip.duration, speed: clip.speed, reversed: clip.reversed,
    transform: clip.transform, transformKeys: sorted, speedKeys, speedSection: clip.videoInspectorSections?.speedChange,
    transitionSourceMap: clip.transitionSourceMap, transitionSourceTimeOverride: clip.transitionSourceTimeOverride,
    strength: Number(effectParams.sceneDepthStrength) || 1, referenceFace: effectParams.depthReferenceFace }) : undefined;
  const mappingBinding = depthBinding ? undefined : JSON.stringify({ source, width: comp.width, height: comp.height, transform: clip.transform, transformKeys: sorted });
  const sceneBake = effectParams.scene3D ? createCableSceneBake(configs, fps, frames, clip.duration, aspect, depthGrid, depthBinding, operatorPlan.surfacePlan, mappingBinding) : undefined;
  type Pose = { mapping: ReturnType<typeof trackingPreviewTransform>; transform: typeof clip.transform; anchors: (null | [CablePoint, CablePoint])[]; facePoints?: CablePoint[] };
  const poses: Pose[] = [];
  const lengths = configs.map(() => 0);
  let depthReader: Awaited<ReturnType<typeof openCableDepthReader>> | undefined;
  let calibration: CableDepthCalibration | undefined, previousDepthTime = -Infinity;
  try {
    if (depthGrid && !savedDepth) depthReader = await openCableDepthReader(clip.source?.videoElement?.currentSrc ?? '', clip.file, signal, report);
    if (savedDepth) report('Reusing saved scene depth; checking face and timing...');
    for (let frame = 0; frame < frames; frame++) {
      signal.throwIfAborted();
      const time = Math.min(frame / fps, clip.duration - 1e-6);
      const transform = getInterpolatedClipTransform(neighborKeys(sorted, time), time, clip.transform, { stabilizationEnabled: clip.videoInspectorSections?.stabilization });
      const mapping = trackingPreviewTransform(transform, source, comp);
      const face = samplePreciseFace(series, surfaceSourceTime(clip, time, speedKeys), Number(effectParams.trackingSmoothing ?? 0))?.faces[0];
      const facePoints = (effectParams.faceCollision || effectParams.faceShadows || effectParams.scene3D) && face?.length ? cableFacePoints(face, mapping, aspect) : undefined;
      sceneBake?.writeFace(frame, face, facePoints, transform, mapping);
      if (savedDepth) sceneBake!.reuseDepth(frame, savedDepth);
      if (depthReader && depthGrid) {
        const sourceTime = surfaceSourceTime(clip, time, speedKeys);
        report(`Estimating scene depth: ${frame + 1} / ${frames}`);
        const depth = await depthReader.read(sourceTime);
        const origin = mapping.toComposition({ x: 0, y: 0 }), unit = mapping.toComposition({ x: 1, y: 0 });
        const width = Math.hypot((unit.x - origin.x) * aspect, unit.y - origin.y);
        const strength = Math.max(0.1, Math.min(2, Number(effectParams.sceneDepthStrength) || 1));
        if (Math.abs(sourceTime - previousDepthTime) > 0.5) calibration = undefined;
        calibration = calibrateCableDepth(depth, effectParams.depthReferenceFace ? face : undefined, effectParams.depthReferenceFace ? facePoints : undefined, width, strength, calibration);
        sceneBake!.writeDepth(frame, calibratedCableDepth(depth, depthGrid, calibration), transform);
        previousDepthTime = sourceTime;
        progress((frame + 1) / frames * 0.25);
      }
      const anchors = configs.map((config, index): [CablePoint, CablePoint] | null => {
        if (!face?.length) return null;
        const anchor = (key: keyof typeof FACE_CABLE_ANCHORS) => {
          const indices = FACE_CABLE_ANCHORS[key].indices;
          if (facePoints) return indices.reduce((p, i) => ({ x: p.x + facePoints[i].x / indices.length, y: p.y + facePoints[i].y / indices.length, z: p.z + (facePoints[i].z ?? 0) / indices.length }), { x: 0, y: 0, z: 0 });
          const uv = indices.reduce((p, i) => ({ x: p.x + face[i].x / indices.length, y: p.y + face[i].y / indices.length }), { x: 0, y: 0 });
          const projected = mapping.toComposition(uv);
          return { x: projected.x * aspect, y: projected.y };
        };
        const a = anchor(config.from), b = anchor(config.to);
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
        if (!config.fromCableId) lengths[index] = Math.max(lengths[index], Math.hypot(a.x - b.x, a.y - b.y, ('z' in a ? Number(a.z) : 0) - ('z' in b ? Number(b.z) : 0)));
        return [a, b];
      });
      poses.push({ mapping, transform, anchors, facePoints });
      if (frame % 32 === 0) { progress(frame / frames * 0.25); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
  } finally { depthReader?.close(); }
  report('Simulating cables...');
  if (!lengths.some(v => v > 0)) throw new Error('No usable anchor pairs in the tracked range.');
  const data = new Float32Array(frames * layout.stride);
  const states: (CableState | null)[] = configs.map(() => null);
  const previousAnchors: (null | [CablePoint, CablePoint])[] = configs.map(() => null);
  const substeps = Math.max(1, Math.ceil(120 / fps)), dt = 1 / fps / substeps;
  for (let frame = 0; frame < frames; frame++) {
    signal.throwIfAborted();
    const faceContact = effectParams.faceCollision && poses[frame].facePoints ? createFaceContact(poses[frame].facePoints!) : undefined;
    const depthContact = sceneBake?.scene.depthGrid && effectParams.sceneDepthCollision !== false && poses[frame].anchors.some(Boolean)
      ? createCableDepthContact(sceneBake.scene, frame, poses[frame].transform, aspect) : undefined;
    const contact = depthContact ? (point: CablePoint, previous: CablePoint, radius: number) => {
      depthContact(point, previous, radius); faceContact?.(point, previous, radius);
    } : faceContact;
    const receiver = version === 4 && poses[frame].facePoints ? createCableShadowReceiver(poses[frame].facePoints!, effectParams) : undefined;
    for (const cable of simulationOrder) {
      let anchors = poses[frame].anchors[cable];
      const config = sampleCableConfig(configs[cable], effectId, cableKeys, frame / fps), parent = parentIndices[cable];
      if (parent >= 0) {
        const parentState = states[parent];
        anchors = anchors && parentState && data[frame * layout.stride + layout.offsets[parent]]
          ? [cableMidpoint(parentState), anchors[1]] : null;
      }
      if (!anchors) { states[cable] = null; previousAnchors[cable] = null; continue; }
      const physics = (time: number) => {
        const fields = operatorPlan.forces(effectId, cableKeys, Math.max(0, time));
        return { ...config, damping: config.damping + fields.damping,
          windX: fields.force[0], windY: -fields.force[1],
          windZ: fields.force[2] + (fields.replacesCableWind ? 0 : cableWindAtTime(config.windZ ?? 0, config.windGusts ?? 0, Math.max(0, time))),
          contact, radius: config.width / 2160 };
      };
      const [a, b] = anchors, lastAnchors = previousAnchors[cable];
      previousAnchors[cable] = anchors;
      if (config.fromCableId && !lengths[cable]) lengths[cable] = Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
      const jumped = lastAnchors && Math.max((config.lockFrom !== false ? Math.hypot(a.x - lastAnchors[0].x, a.y - lastAnchors[0].y, (a.z ?? 0) - (lastAnchors[0].z ?? 0)) : 0), (config.lockTo !== false ? Math.hypot(b.x - lastAnchors[1].x, b.y - lastAnchors[1].y, (b.z ?? 0) - (lastAnchors[1].z ?? 0)) : 0)) > 0.25;
      if (states[cable]) states[cable]!.length = lengths[cable] * config.slack;
      if (!states[cable] || jumped) {
        states[cable] = createCable(a, b, lengths[cable] * config.slack, config.segments ?? 24);
        for (let warm = 0; warm < (config.lockFrom !== false && config.lockTo !== false ? 120 : 0); warm++) stepCable(states[cable]!, a, b, 1 / 120, config.gravity, physics(frame / fps).damping, physics(frame / fps));
      } else {
        for (let step = 1; step <= substeps; step++) {
          const t = step / substeps;
          const mix = (now: CablePoint, old: CablePoint) => ({ x: old.x + (now.x - old.x) * t, y: old.y + (now.y - old.y) * t, z: (old.z ?? 0) + ((now.z ?? 0) - (old.z ?? 0)) * t });
          stepCable(states[cable]!, mix(a, lastAnchors?.[0] ?? a), mix(b, lastAnchors?.[1] ?? b), dt, config.gravity, physics((frame - 1 + t) / fps).damping, physics((frame - 1 + t) / fps));
        }
      }
      const offset = frame * layout.stride + layout.offsets[cable];
      sceneBake?.writeCable(frame, cable, states[cable]!.points, config, poses[frame].transform);
      data[offset] = 1;
      const mapping = poses[frame].mapping;
      const center = mapping.toSource({ x: a.x / aspect, y: a.y });
      const edge = mapping.toSource({ x: (a.x + config.width / 1080 / 2) / aspect, y: a.y });
      data[offset + 1] = Math.hypot((edge.x - center.x) * source.width / source.height, edge.y - center.y);
      const projected = states[cable]!.points.map(point => projectCableDepth(point, aspect));
      // Reject invalid coordinates; strong wind uses bounded depth projection.
      if (projected.some(point => !point)) { data[offset] = 0; continue; }
      projected.forEach((point, i) => {
        const uv = mapping.toSource(point!);
        data[offset + 2 + i * 3] = uv.x; data[offset + 3 + i * 3] = uv.y;
        data[offset + 4 + i * 3] = point!.scale;
      });
      if (version === 4) writeCableShadows(data, offset + 2 + projected.length * 3, states[cable]!.points, receiver, aspect, mapping);
    }
    if (frame % 16 === 0) { progress(0.25 + frame / frames * 0.7); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  }
  signal.throwIfAborted();
  const bakedData = encodeCableBake({ version, fps, frames, duration: clip.duration, cables: configs, data });
  const current = useTimelineStore.getState(), currentClip = current.clips.find(c => c.id === clipId);
  if (!currentClip || current.isExporting || current.tracks.find(t => t.id === currentClip.trackId)?.locked
    || currentClip.inPoint !== clip.inPoint || currentClip.outPoint !== clip.outPoint || currentClip.duration !== clip.duration
    || (currentClip.source?.mediaFileId ?? currentClip.mediaFileId ?? clipId) !== sourceId
    || JSON.stringify(currentClip.transform) !== transformSignature || current.clipKeyframes.get(clipId) !== timeline.clipKeyframes.get(clipId)
    || currentClip.speed !== clip.speed || currentClip.reversed !== clip.reversed
    || useMediaStore.getState().getActiveComposition()?.width !== comp.width
    || useMediaStore.getState().getActiveComposition()?.height !== comp.height
    || useMediaStore.getState().getActiveComposition()?.frameRate !== fps
    || currentClip.videoInspectorSections?.stabilization !== clip.videoInspectorSections?.stabilization
    || currentClip.effects !== clip.effects || media.activeCompositionId !== useMediaStore.getState().activeCompositionId) throw new Error('The clip changed while baking. Bake again.');
  assertExclusiveTimelineMutationAllowed();
  const previous = clip.effects.find(e => e.id === effectId && e.type === 'face-cables');
  if (!previous) throw new Error('The cable effect was removed.');
  const effect = { id: previous.id, type: 'face-cables' as const, name: 'Face Cables', enabled: previous.enabled,
    params: { ...previous.params, operatorGraph: JSON.stringify(operatorPlan.graph), bakedData, sceneData: sceneBake?.encode() ?? '', settings: JSON.stringify(configs) } };
  const history = useHistoryStore.getState(), batch = history.startBatch('Bake face cables');
  try {
    current.updateClip(clipId, { is3D: !!sceneBake, effects: clip.effects.map(e => e.id === effectId ? effect : e) });
    useTimelineStore.getState().invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) history.endBatch(); }
  progress(1);
}
