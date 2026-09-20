import { sampleCableConfig } from './cableAnimation';
import { createCableShadowReceiver, writeCableShadows } from './cableShadows';
import { sharedCableWind } from './cableWind';
import { cableFacePoints, createFaceContact } from './cableFaceSurface';
import { cableSimulationOrder, cableMidpoint } from './cableConnections';
import type { CableState } from './cablePhysics';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { trackingPreviewTransform } from '../planarTracking/trackingPreviewTransform';
import { surfaceSourceTime } from '../planarTracking/surfaceEffects';
import { landmarkRuntime } from '../landmarkTracking/landmarkRuntime';
import { faceTrackKey, samplePreciseFace } from '../landmarkTracking/preciseFaceSampling';
import { projectCableDepth, cableWindAtTime } from './cableDepth';
import { createCable, stepCable } from './cablePhysics';
import { cableFrameLayout, FACE_CABLE_ANCHORS, isFaceCableConfig, encodeCableBake, type FaceCableConfig } from './cableData';

/** A bounded, stationary-pose approximation, not a replay of the clip's motion history. */
export function previewFaceCables(clipId: string, configs: FaceCableConfig[], time: number, effectId = ''): string {
  const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId), comp = media.getActiveComposition();
  if (!clip || !comp || time < 0 || time >= clip.duration) throw new Error('Move the playhead inside this clip.');
  if (clip.is3D || clip.parentClipId || clip.sourceRect || clip.transform.rotation.x || clip.transform.rotation.y || clip.transform.position.z) throw new Error('Preview requires an unparented 2D video.');
  if (!configs.length || configs.length > 32 || configs.some(c => !isFaceCableConfig(c) || (!c.fromCableId && c.from === c.to))) throw new Error('Choose two different anchors.');
  const simulationOrder = cableSimulationOrder(configs);
  const states = new Map<string, CableState>();
  const sourceId = clip.source?.mediaFileId ?? clip.mediaFileId ?? clipId;
  const series = landmarkRuntime.getSeries(faceTrackKey(clipId));
  if (!series?.faceTracking || series.sourceId !== sourceId) throw new Error('Track this face precisely first.');
  const file = media.files.find(f => f.id === sourceId);
  const source = { width: file?.width ?? clip.source?.videoElement?.videoWidth ?? 0, height: file?.height ?? clip.source?.videoElement?.videoHeight ?? 0 };
  if (!source.width || !source.height) throw new Error('Source dimensions unavailable.');
  const keys = timeline.getClipKeyframes(clipId);
  if (keys.some(k => ['rotation.x', 'rotation.y', 'position.z'].includes(k.property))) throw new Error('Animated 3D transforms are not supported.');
  const mapping = trackingPreviewTransform(getInterpolatedClipTransform(keys, time, clip.transform, { stabilizationEnabled: clip.videoInspectorSections?.stabilization }), source, comp);
  const face = samplePreciseFace(series, surfaceSourceTime(clip, time, keys.filter(k => k.property === 'speed')))?.faces[0];
  const params = clip.effects.find(e => e.id === effectId)?.params ?? {};
  const version = params.faceShadows ? 4 : 3;
  const aspect = comp.width / comp.height, layout = cableFrameLayout(version, configs);
  const facePoints = (params.faceCollision || params.faceShadows) && face?.length ? cableFacePoints(face, mapping, aspect) : undefined;
  const contact = params.faceCollision && facePoints ? createFaceContact(facePoints) : undefined;
  const receiver = params.faceShadows && facePoints ? createCableShadowReceiver(facePoints, params) : undefined;
  const data = new Float32Array(layout.stride);
  simulationOrder.forEach(index => {
    const config = sampleCableConfig(configs[index], effectId, keys, time);
    if (!face?.length) return;
    const anchor = (key: keyof typeof FACE_CABLE_ANCHORS) => {
      const indices = FACE_CABLE_ANCHORS[key].indices;
      if (facePoints) return indices.reduce((p, i) => ({ x: p.x + facePoints[i].x / indices.length, y: p.y + facePoints[i].y / indices.length, z: p.z + (facePoints[i].z ?? 0) / indices.length }), { x: 0, y: 0, z: 0 });
      const uv = indices.reduce((p, i) => ({ x: p.x + face[i].x / indices.length, y: p.y + face[i].y / indices.length }), { x: 0, y: 0 });
      const point = mapping.toComposition(uv);
      return { x: point.x * aspect, y: point.y };
    };
    const parent = config.fromCableId ? states.get(config.fromCableId) : null;
    if (config.fromCableId && !parent) return;
    const a: import('./cablePhysics').CablePoint = parent ? cableMidpoint(parent) : anchor(config.from), b = anchor(config.to);
    const state = createCable(a, b, Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - ('z' in b ? Number(b.z) : 0)) * config.slack, config.segments ?? 24);
    const physics = { ...config, ...(sharedCableWind(params, effectId, keys, time) ?? { windZ: cableWindAtTime(config.windZ ?? 0, config.windGusts ?? 0, time) }), contact, radius: config.width / 2160 };
    for (let i = 0; i < 120; i++) stepCable(state, a, b, 1 / 120, config.gravity, config.damping, physics);
    const projected = state.points.map(point => projectCableDepth(point, aspect));
    if (projected.some(p => !p)) return;
    states.set(config.id, state);
    const offset = layout.offsets[index];
    const center = mapping.toSource({ x: a.x / aspect, y: a.y });
    const edge = mapping.toSource({ x: (a.x + config.width / 1080 / 2) / aspect, y: a.y });
    data[offset] = 1;
    data[offset + 1] = Math.hypot((edge.x - center.x) * source.width / source.height, edge.y - center.y);
    projected.forEach((point, i) => {
      const uv = mapping.toSource(point!);
      data.set([uv.x, uv.y, point!.scale], offset + 2 + i * 3);
    });
    if (version === 4) writeCableShadows(data, offset + 2 + projected.length * 3, state.points, receiver, aspect, mapping);
  });
  return encodeCableBake({ version, fps: 1, frames: 1, duration: 1, cables: configs, data });
}
