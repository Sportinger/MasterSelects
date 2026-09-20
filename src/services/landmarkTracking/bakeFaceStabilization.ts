import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useHistoryStore } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { surfaceSourceTime } from '../planarTracking/surfaceEffects';
import { landmarkRuntime } from './landmarkRuntime';
import { faceTrackKey, samplePreciseFace } from './preciseFaceSampling';
import { solveFaceStabilization, type FaceStabilizationTarget, type FaceStabilizationPose } from './faceStabilization';
import type { Keyframe } from '../../types/keyframes';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { stabilizationCurveSignature, stabilizationInputSignature } from './stabilizationProvenance';

export function bakeFaceStabilization(clipId: string, target: FaceStabilizationTarget, lockCenter: boolean, smoothing: number): number {
  assertExclusiveTimelineMutationAllowed();
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId);
  if (!clip || timeline.isExporting || timeline.tracks.find(t => t.id === clip.trackId)?.locked) {
    throw new Error('The clip is unavailable, locked, or being exported.');
  }
  if (clip.is3D || clip.parentClipId || clip.sourceRect || clip.transform.rotation.x || clip.transform.rotation.y) {
    throw new Error('Face stabilization currently supports unparented 2D clips without source crop or X/Y rotation.');
  }
  const series = landmarkRuntime.getSeries(faceTrackKey(clipId));
  const sourceId = clip.source?.mediaFileId ?? clip.mediaFileId ?? clipId;
  if (!series?.faceTracking || series.sourceId !== sourceId) throw new Error('Track this face precisely first.');
  const media = useMediaStore.getState();
  const composition = media.getActiveComposition();
  if (!composition) throw new Error('Open a composition first.');
  const sourceFile = media.files.find(f => f.id === sourceId);
  const source = { width: sourceFile?.width ?? clip.source?.videoElement?.videoWidth ?? 0,
    height: sourceFile?.height ?? clip.source?.videoElement?.videoHeight ?? 0 };
  if (!source.width || !source.height) throw new Error('Source dimensions are unavailable.');
  const output = { width: composition.width, height: composition.height };
  const fps = composition.frameRate;
  const count = Math.ceil(clip.duration * fps);
  if (!Number.isFinite(count) || count < 1 || count > 18_000) throw new Error('Stabilize between 1 and 18,000 composition frames.');
  const existing = timeline.getClipKeyframes(clipId);
  // A rebake must use original animation, not feed thousands of generated keys
  // back through every property interpolation on every frame.
  const originalKeys = existing.filter(k => !k.id.startsWith('face-stabilize:'));
  const speedKeys = existing.filter(k => k.property === 'speed');
  if (existing.some(k => k.property === 'rotation.x' || k.property === 'rotation.y')) {
    throw new Error('Remove animated X/Y rotation before baking 2D stabilization.');
  }
  const baked: Keyframe[] = [];
  let previous: FaceStabilizationPose | undefined;
  let lastDetectionTime = -Infinity;
  let detected = 0;
  for (let index = 0; index <= count; index++) {
    const time = Math.min(index / fps, clip.duration);
    const base = getInterpolatedClipTransform(originalKeys, time, clip.transform);
    const sourceTime = surfaceSourceTime(clip, Math.min(time, clip.duration - 1e-6), speedKeys);
    const frame = samplePreciseFace(series, sourceTime, smoothing);
    const pose = solveFaceStabilization(frame?.faces[0] ?? [], target, base, source, output, lockCenter,
      time - lastDetectionTime <= 0.2 ? previous?.rotation : undefined);
    if (pose) { previous = pose; lastDetectionTime = time; detected++; }
    // Hold the last trustworthy transform during loss; never invent a face position.
    const value = previous ?? { rotation: base.rotation.z, x: base.position.x, y: base.position.y };
    for (const [property, number] of [['rotation.z', value.rotation], ['position.x', value.x], ['position.y', value.y]] as const) {
      baked.push({ id: `face-stabilize:${crypto.randomUUID()}`, clipId, time, property, value: number, easing: 'linear' });
    }
  }
  if (!detected) throw new Error('No usable face landmarks in the current clip range.');
  const replaced = new Set(['rotation.z', 'position.x', 'position.y']);
  const nextMap = new Map(timeline.clipKeyframes);
  nextMap.set(clipId, [...existing.filter(k => !replaced.has(k.property)), ...baked].toSorted((a, b) => a.time - b.time));
  const history = useHistoryStore.getState(), batch = history.startBatch(`Stabilize ${target}`);
  try {
    const nodeGraph = clip.nodeGraph ?? { version: 1 as const, nodes: [] };
    useTimelineStore.setState({ clipKeyframes: nextMap, clips: timeline.clips.map(candidate => candidate.id !== clipId ? candidate : {
      ...candidate,
      nodeGraph: { ...nodeGraph, stabilization: { ...nodeGraph.stabilization, bake: {
        version: 1, target, lockCenter, smoothing, sourceId, trackingCreatedAt: series.createdAt,
        bakedAt: Date.now(), frameRate: fps, sampleCount: count + 1, detectedSamples: detected,
        inputSignature: stabilizationInputSignature(clip, existing), curveSignature: stabilizationCurveSignature(baked),
      } } },
    }) });
    useTimelineStore.getState().invalidateCache();
    renderHostPort.requestRender();
  } finally { if (batch.opened) history.endBatch(); }
  return count;
}
