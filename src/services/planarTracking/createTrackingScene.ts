import { useMediaStore, type Composition, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { AnimatableProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import type { TerrainReconstruction } from '../../types/terrainTracking';
import type { CompositionTimelineData, SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import {
  buildTrackingSceneCameraPlan,
  type TrackingSceneCameraPose,
  type TrackingSceneSourceTiming,
} from './trackingSceneCamera';
import {
  buildTrackingSceneMesh,
  encodeTrackingSceneGlb,
  type TrackingSceneGeometrySource,
} from './trackingSceneGeometry';

export interface CreateTrackingSceneInput {
  assetId: string;
  name: string;
  sourceMediaId: string;
  terrain: TerrainReconstruction;
  sourceVideoClipId?: string;
  /** Explicit consent to collapse unsupported lens terms to one centered pinhole. */
  allowApproximateCamera?: boolean;
}

export interface CreateTrackingSceneResult {
  composition: Composition;
  meshMediaItem: MediaFile;
  compositionId: string;
  meshMediaId: string;
  modelClipId: string;
  cameraClipId: string;
  cameraClipIds: string[];
  vertexCount: number;
  triangleCount: number;
  poseCount: number;
  geometrySource: TrackingSceneGeometrySource;
  cameraApproximation: ReturnType<typeof buildTrackingSceneCameraPlan>['calibration'];
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function generatedFileName(name: string, assetId: string, bytes: ArrayBuffer): string {
  const stem = name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'tracking';
  let hash = 0x811c9dc5;
  for (const value of new Uint8Array(bytes)) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  for (let index = 0; index < assetId.length; index += 1) {
    hash ^= assetId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${stem}-terrain-${(hash >>> 0).toString(16).padStart(8, '0')}.glb`;
}

function findSourceTiming(sourceVideoClipId: string | undefined): TrackingSceneSourceTiming | undefined {
  if (!sourceVideoClipId) return undefined;
  const timeline = useTimelineStore.getState();
  const active = timeline.clips.find((clip) => clip.id === sourceVideoClipId);
  if (active) return { clip: active, keyframes: timeline.getClipKeyframes(active.id) };

  const media = useMediaStore.getState();
  for (const composition of media.compositions) {
    const clip = composition.timelineData?.clips.find((candidate) => candidate.id === sourceVideoClipId);
    if (clip) return { clip, keyframes: clip.keyframes ?? [] };
  }
  // A project-owned tracking asset remains reusable after its original clip
  // is removed. In that case the solved source PTS becomes the scene clock.
  return undefined;
}

function sourceMediaIdForClip(clip: TrackingSceneSourceTiming['clip']): string | undefined {
  const runtime = clip as TimelineClip;
  return runtime.source?.mediaFileId ?? runtime.mediaFileId;
}

function poseKeyframes(clipId: string, poses: readonly TrackingSceneCameraPose[]): Keyframe[] {
  const properties: Array<[AnimatableProperty, (pose: TrackingSceneCameraPose) => number]> = [
    ['position.x', (pose) => pose.position.x],
    ['position.y', (pose) => pose.position.y],
    ['position.z', (pose) => pose.position.z],
    ['rotation.x', (pose) => pose.rotation.x],
    ['rotation.y', (pose) => pose.rotation.y],
    ['rotation.z', (pose) => pose.rotation.z],
  ];
  return poses.flatMap((pose) => properties.map(([property, value]) => ({
    id: id('tracking-camera-key'),
    clipId,
    property,
    time: pose.time,
    value: value(pose),
    easing: 'linear',
  })));
}

function sceneTrack(trackId: string, name: string): TimelineTrack {
  return { id: trackId, name, type: 'video', height: 70, muted: false, visible: true, solo: false };
}

function cameraClips(
  trackId: string,
  name: string,
  plan: ReturnType<typeof buildTrackingSceneCameraPlan>,
): SerializableClip[] {
  const cameraLabel = plan.calibration.exactSupported
    ? 'Solved Camera'
    : `Approximate Camera (${plan.calibration.maxPixelError.toFixed(2)}px max)`;
  return plan.segments.map((segment, index) => {
    const clipId = id('tracking-camera');
    const first = segment.poses[0]!;
    return {
      id: clipId,
      trackId,
      name: plan.segments.length === 1 ? `${name} · ${cameraLabel}` : `${name} · ${cameraLabel} ${index + 1}`,
      mediaFileId: '',
      startTime: segment.startTime,
      duration: segment.duration,
      inPoint: 0,
      outPoint: segment.duration,
      sourceType: 'camera',
      naturalDuration: Number.MAX_SAFE_INTEGER,
      cameraSettings: { ...plan.settings },
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { ...first.position },
        anchor: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { ...first.rotation },
      },
      effects: [],
      keyframes: poseKeyframes(clipId, segment.poses),
    };
  });
}

/** Materialize a solved terrain as a reusable model and an ordinary animated-camera composition. */
export async function createTrackingScene(input: CreateTrackingSceneInput): Promise<CreateTrackingSceneResult> {
  if (!input.assetId.trim() || !input.sourceMediaId.trim()) {
    throw new Error('Create 3D Scene requires a tracking asset and its source media.');
  }
  const media = useMediaStore.getState();
  const sourceMedia = media.files.find((candidate) => candidate.id === input.sourceMediaId);

  const sourceTiming = findSourceTiming(input.sourceVideoClipId);
  const timingMediaId = sourceTiming ? sourceMediaIdForClip(sourceTiming.clip) : undefined;
  if (timingMediaId && timingMediaId !== input.sourceMediaId) {
    throw new Error('The selected source clip does not belong to this tracking result.');
  }

  const mesh = buildTrackingSceneMesh(input.terrain);
  const cameraPlan = buildTrackingSceneCameraPlan({
    terrain: input.terrain,
    bounds: mesh.bounds,
    sourceTiming,
    preferredFrameRate: sourceMedia?.fps ?? 30,
    allowApproximateCamera: input.allowApproximateCamera,
  });
  const glb = encodeTrackingSceneGlb(mesh, {
    assetId: input.assetId,
    sourceMediaId: input.sourceMediaId,
    geometrySource: mesh.source,
  });
  const displayName = input.name.trim() || 'Tracking';
  const fileName = generatedFileName(displayName, input.assetId, glb);
  const imported = await useMediaStore.getState().importFile(
    new File([glb], fileName, { type: 'model/gltf-binary' }),
    null,
    { forceCopyToProject: true, projectFileName: fileName },
  );
  if (imported.type !== 'model') throw new Error('The generated terrain could not be imported as a 3D model.');

  const cameraTrackId = id('tracking-camera-track');
  const modelTrackId = id('tracking-model-track');
  const modelClipId = id('tracking-model');
  const cameras = cameraClips(cameraTrackId, displayName, cameraPlan);
  const modelClip: SerializableClip = {
    id: modelClipId,
    trackId: modelTrackId,
    name: `${displayName} · Terrain Mesh`,
    mediaFileId: imported.id,
    startTime: 0,
    duration: cameraPlan.duration,
    inPoint: 0,
    outPoint: cameraPlan.duration,
    sourceType: 'model',
    naturalDuration: cameraPlan.duration,
    is3D: true,
    threeDEffectorsEnabled: true,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      // Imported models are normalized about their bounds by ModelRuntimeCache.
      // Restore the reconstruction scale and center once on the shared clip ref.
      position: { ...mesh.bounds.center },
      anchor: { x: 0, y: 0, z: 0 },
      scale: { x: mesh.bounds.maxDimension, y: mesh.bounds.maxDimension, z: mesh.bounds.maxDimension },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
  const timelineData: CompositionTimelineData = {
    tracks: [
      sceneTrack(cameraTrackId, cameraPlan.calibration.exactSupported ? 'Solved Camera' : 'Approximate Camera'),
      sceneTrack(modelTrackId, 'Terrain Mesh'),
    ],
    clips: [...cameras, modelClip],
    // Open on the first solved pose; coverage may start after a trimmed/gapped
    // source interval, where time zero intentionally has no camera clip.
    playheadPosition: cameras[0]?.startTime ?? 0,
    duration: cameraPlan.duration,
    durationLocked: true,
    zoom: Math.max(10, Math.min(120, 900 / cameraPlan.duration)),
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
  };
  const sceneName = cameraPlan.calibration.exactSupported
    ? `${displayName} · 3D Scene`
    : `${displayName} · 3D Scene (approximate camera)`;
  const composition = useMediaStore.getState().createComposition(sceneName, {
    parentId: null,
    width: input.terrain.intrinsics.width,
    height: input.terrain.intrinsics.height,
    frameRate: cameraPlan.frameRate,
    duration: cameraPlan.duration,
    backgroundColor: '#000000',
    timelineData,
  });
  const cameraClipIds = cameras.map((clip) => clip.id);
  return {
    composition,
    meshMediaItem: imported,
    compositionId: composition.id,
    meshMediaId: imported.id,
    modelClipId,
    cameraClipId: cameraClipIds[0]!,
    cameraClipIds,
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    poseCount: cameraPlan.segments.reduce((sum, segment) => sum + segment.poses.length, 0),
    geometrySource: mesh.source,
    cameraApproximation: cameraPlan.calibration,
  };
}
