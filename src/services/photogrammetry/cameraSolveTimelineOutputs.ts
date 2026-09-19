import type { AnimatableProperty } from '../../types/animationProperties';
import type { TimelineClip } from '../../types/timeline';
import { useHistoryStore } from '../../stores/historyStore';
import { useMediaStore } from '../../stores/mediaStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { CameraSolveDataset } from './cameraSolvingContract';
import { parseSolvedCameraPath, type SolvedCameraPoseKey } from './cameraSolvePoses';
import {
  smoothSolvedCameraPoses,
  snapSolvedCameraPosesToFrames,
} from './cameraSolvePathSmoothing';

export interface CameraTrackCreationResult {
  clipId: string;
  poseCount: number;
  keyframeCount: number;
}

export interface StabilizationCreationResult {
  clipId: string;
  poseCount: number;
  keyframeCount: number;
  cropScale: number;
}

function paddedPoses(poses: SolvedCameraPoseKey[], duration: number): SolvedCameraPoseKey[] {
  if (poses.length === 0) return [];
  const result = poses.map((pose) => ({ ...pose }));
  if (result[0].time > 1e-5) result.unshift({ ...result[0], time: 0 });
  if ((result.at(-1)?.time ?? 0) < duration - 1e-5) result.push({ ...result.at(-1)!, time: duration });
  return result;
}

function addPoseKeyframes(clipId: string, poses: SolvedCameraPoseKey[]): number {
  const timeline = useTimelineStore.getState();
  const properties: Array<[AnimatableProperty, (pose: SolvedCameraPoseKey) => number]> = [
    ['position.x', (pose) => pose.position.x],
    ['position.y', (pose) => pose.position.y],
    ['position.z', (pose) => pose.position.z],
    ['rotation.x', (pose) => pose.rotation.x],
    ['rotation.y', (pose) => pose.rotation.y],
    ['rotation.z', (pose) => pose.rotation.z],
  ];
  poses.forEach((pose) => properties.forEach(([property, value]) => {
    timeline.addKeyframe(clipId, property, value(pose), pose.time, 'linear');
  }));
  return poses.length * properties.length;
}

export function createCameraTrackFromSolve(dataset: CameraSolveDataset): CameraTrackCreationResult {
  const path = parseSolvedCameraPath(dataset);
  const sourceStart = dataset.source?.clipStartTime ?? useTimelineStore.getState().playheadPosition;
  const solvedPoses = snapSolvedCameraPosesToFrames(
    smoothSolvedCameraPoses(path.poses),
    outputFrameRate(dataset),
  );
  const poses = paddedPoses(solvedPoses, path.duration);
  const history = useHistoryStore.getState();
  const batch = history.startBatch('Create solved camera track');
  try {
    const timeline = useTimelineStore.getState();
    const trackId = timeline.addTrack('video');
    useTimelineStore.getState().renameTrack(trackId, 'Solved Camera');
    const clipId = useTimelineStore.getState().addCameraClip(trackId, sourceStart, path.duration, true);
    if (!clipId) throw new Error('The solved camera clip could not be created.');
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
    if (!clip?.source) throw new Error('The solved camera clip is unavailable.');
    const first = poses[0];
    useTimelineStore.getState().updateClip(clipId, {
      name: `Solved Camera · ${dataset.source?.sourceClipName ?? dataset.model.datasetName}`,
      source: {
        ...clip.source,
        cameraSettings: {
          ...DEFAULT_SCENE_CAMERA_SETTINGS,
          ...clip.source.cameraSettings,
          fov: path.fovDegrees,
          resolutionWidth: path.width,
          resolutionHeight: path.height,
        },
      },
    });
    useTimelineStore.getState().updateClipTransform(clipId, {
      position: first.position,
      rotation: first.rotation,
    });
    const keyframeCount = addPoseKeyframes(clipId, poses);
    useTimelineStore.getState().selectClip(clipId);
    return { clipId, poseCount: solvedPoses.length, keyframeCount };
  } finally {
    if (batch.opened) history.endBatch();
  }
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let total = 0;
    for (let cursor = start; cursor <= end; cursor += 1) total += values[cursor];
    return total / (end - start + 1);
  });
}

function activeCompositionSize(): { width: number; height: number } {
  const media = useMediaStore.getState();
  const composition = media.compositions.find((candidate) => candidate.id === media.activeCompositionId);
  return { width: composition?.width ?? 1920, height: composition?.height ?? 1080 };
}

function outputFrameRate(dataset: CameraSolveDataset): number {
  if (dataset.source?.frameRate && dataset.source.frameRate > 0) return dataset.source.frameRate;
  const media = useMediaStore.getState();
  return media.compositions.find((candidate) => candidate.id === media.activeCompositionId)?.frameRate ?? 30;
}

function findSourceClip(dataset: CameraSolveDataset): TimelineClip {
  const clipId = dataset.source?.sourceClipId;
  const clip = clipId ? useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId) : null;
  if (!clip || clip.source?.type !== 'video') {
    throw new Error('Select and solve a timeline video before applying stabilization.');
  }
  return clip;
}

export function stabilizeSourceClipFromSolve(
  dataset: CameraSolveDataset,
  strengthPercent = 100,
): StabilizationCreationResult {
  const clip = findSourceClip(dataset);
  const path = parseSolvedCameraPath(dataset);
  const strength = Math.max(0, Math.min(1, strengthPercent / 100));
  const snappedPoses = snapSolvedCameraPosesToFrames(path.poses, outputFrameRate(dataset));
  const poses = paddedPoses(snappedPoses, clip.duration);
  const pitch = poses.map((pose) => pose.rotation.x);
  const yaw = poses.map((pose) => pose.rotation.y);
  const roll = poses.map((pose) => pose.rotation.z);
  const smoothPitch = smooth(pitch, 2);
  const smoothYaw = smooth(yaw, 2);
  const smoothRoll = smooth(roll, 2);
  const composition = activeCompositionSize();
  const xScale = composition.width / path.width;
  const yScale = composition.height / path.height;
  const corrections = poses.map((pose, index) => ({
    time: pose.time,
    x: path.focalLength * (yaw[index] - smoothYaw[index]) * Math.PI / 180 * xScale * strength,
    y: path.focalLength * (pitch[index] - smoothPitch[index]) * Math.PI / 180 * yScale * strength,
    rotation: (roll[index] - smoothRoll[index]) * strength,
  }));
  const requiredCrop = corrections.reduce((maximum, correction) => {
    const translation = Math.max(
      Math.abs(correction.x) / Math.max(1, composition.width * 0.5),
      Math.abs(correction.y) / Math.max(1, composition.height * 0.5),
    );
    const rotation = Math.abs(Math.sin(correction.rotation * Math.PI / 180)) * 0.5;
    return Math.max(maximum, 1 + translation + rotation);
  }, 1);
  const cropScale = Math.min(1.35, Math.max(1.02, requiredCrop));
  const base = clip.transform;
  const basePosition = {
    x: base.position.x * composition.width * 0.5,
    y: base.position.y * composition.height * 0.5,
  };
  const history = useHistoryStore.getState();
  const batch = history.startBatch('Apply camera-solve stabilization');
  try {
    const timeline = useTimelineStore.getState();
    corrections.forEach((correction) => {
      timeline.addKeyframe(
        clip.id,
        'position.x',
        (basePosition.x + correction.x) / Math.max(1, composition.width * 0.5),
        correction.time,
        'linear',
      );
      timeline.addKeyframe(
        clip.id,
        'position.y',
        (basePosition.y + correction.y) / Math.max(1, composition.height * 0.5),
        correction.time,
        'linear',
      );
      timeline.addKeyframe(clip.id, 'rotation.z', base.rotation.z + correction.rotation, correction.time, 'linear');
      timeline.addKeyframe(clip.id, 'scale.all', (base.scale.all ?? 1) * cropScale, correction.time, 'linear');
    });
    timeline.selectClip(clip.id);
    return {
      clipId: clip.id,
      poseCount: snappedPoses.length,
      keyframeCount: corrections.length * 4,
      cropScale,
    };
  } finally {
    if (batch.opened) history.endBatch();
  }
}
