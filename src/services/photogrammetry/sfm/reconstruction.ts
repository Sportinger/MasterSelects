import {
  cameraCenter,
  cameraPoint,
  estimateEssentialRansac,
  multiplyMatrix3,
  parallaxDegrees,
  recoverRelativePose,
  reprojectionError,
  transformPoint,
  triangulateMatch,
} from './geometry';
import { OpenCvFeatureClient } from './opencvFeatureClient';
import type {
  CameraPose,
  FeatureMatch,
  FrameFeatures,
  Point2,
  SparsePoint,
  SparseReconstruction,
} from './types';

interface InitialPair {
  first: FrameFeatures;
  second: FrameFeatures;
  matches: FeatureMatch[];
  inliers: number[];
  secondPose: CameraPose;
  score: number;
}

interface RegistrationAnchor {
  frame: FrameFeatures;
  matches: FeatureMatch[];
}

interface RegistrationAttempt {
  pose: CameraPose | null;
  correspondenceCount: number;
  inlierCount: number;
}

/**
 * Adjacent source-rate video frames often have too little baseline for a
 * stable essential-matrix initialization. Probe a bounded span near the
 * beginning instead of only the first four neighbours.
 */
export function planInitialPairCandidateOffsets(frameCount: number): number[] {
  const availableOffsets = Math.max(0, Math.floor(frameCount) - 1);
  if (availableOffsets === 0) return [];
  const maxOffset = Math.min(
    availableOffsets,
    24,
    Math.max(4, Math.round(frameCount * 0.08)),
  );
  const candidateCount = Math.min(8, maxOffset);
  if (candidateCount === 1) return [1];
  return Array.from(new Set(Array.from({ length: candidateCount }, (_, index) => Math.round(
    1 + ((maxOffset - 1) * index) / (candidateCount - 1),
  ))));
}

export interface ReconstructionProgress {
  current: number;
  total: number;
  registeredImages: number;
  pointCount: number;
  message: string;
}

const ORIGIN_POSE: CameraPose = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: { x: 0, y: 0, z: 0 },
};

function featurePoint(frame: FrameFeatures, featureIndex: number): Point2 {
  return { x: frame.points[featureIndex * 2], y: frame.points[featureIndex * 2 + 1] };
}

function featureColor(frame: FrameFeatures, featureIndex: number): [number, number, number] {
  return [
    frame.colors[featureIndex * 3],
    frame.colors[featureIndex * 3 + 1],
    frame.colors[featureIndex * 3 + 2],
  ];
}

function medianDisplacement(matches: FeatureMatch[], first: FrameFeatures, second: FrameFeatures): number {
  if (matches.length === 0) return 0;
  const values = matches.map((match) => {
    const a = featurePoint(first, match.first);
    const b = featurePoint(second, match.second);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }).toSorted((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function recentCameraStep(
  registeredFrames: FrameFeatures[],
  poses: Map<number, CameraPose>,
): number {
  const distances: number[] = [];
  for (let index = Math.max(1, registeredFrames.length - 4); index < registeredFrames.length; index += 1) {
    const first = poses.get(registeredFrames[index - 1].sourceIndex);
    const second = poses.get(registeredFrames[index].sourceIndex);
    if (!first || !second) continue;
    const a = cameraCenter(first);
    const b = cameraCenter(second);
    const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (Number.isFinite(distance) && distance > 1e-4) distances.push(distance);
  }
  const sorted = distances.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0.25;
}

function composeRelativePose(base: CameraPose, relative: CameraPose, translationScale: number): CameraPose {
  const rotatedTranslation = transformPoint(relative.rotation, base.translation);
  return {
    rotation: multiplyMatrix3(relative.rotation, base.rotation),
    translation: {
      x: rotatedTranslation.x + relative.translation.x * translationScale,
      y: rotatedTranslation.y + relative.translation.y * translationScale,
      z: rotatedTranslation.z + relative.translation.z * translationScale,
    },
  };
}

function recoverSequentialPose(
  previous: FrameFeatures,
  frame: FrameFeatures,
  previousPose: CameraPose,
  matches: FeatureMatch[],
  focal: number,
  principal: Point2,
  translationScale: number,
): { pose: CameraPose; inlierCount: number } | null {
  const estimate = estimateEssentialRansac(matches, previous.points, frame.points, focal, principal);
  if (!estimate || estimate.inliers.length < 24) return null;
  const relative = recoverRelativePose(
    estimate.essential,
    matches,
    estimate.inliers,
    previous.points,
    frame.points,
    focal,
    principal,
  );
  return relative
    ? { pose: composeRelativePose(previousPose, relative, translationScale), inlierCount: estimate.inliers.length }
    : null;
}

async function selectInitialPair(
  client: OpenCvFeatureClient,
  frames: FrameFeatures[],
  focal: number,
  principal: Point2,
): Promise<InitialPair> {
  const first = frames[0];
  let best: InitialPair | null = null;
  for (const offset of planInitialPairCandidateOffsets(frames.length)) {
    const second = frames[offset];
    const matches = await client.match(first.sourceIndex, second.sourceIndex);
    const estimate = estimateEssentialRansac(matches, first.points, second.points, focal, principal);
    if (!estimate) continue;
    const secondPose = recoverRelativePose(
      estimate.essential,
      matches,
      estimate.inliers,
      first.points,
      second.points,
      focal,
      principal,
    );
    if (!secondPose) continue;
    const displacement = medianDisplacement(
      estimate.inliers.map((index) => matches[index]),
      first,
      second,
    );
    const score = estimate.inliers.length * Math.min(2, Math.sqrt(Math.max(1, displacement) / 12));
    const candidate = { first, second, matches, inliers: estimate.inliers, secondPose, score };
    if (!best || candidate.score > best.score) best = candidate;
  }
  if (!best || best.inliers.length < 30) {
    throw new Error('Camera solving could not find a stable initial image pair. Capture more textured overlap.');
  }
  return best;
}

function assignmentMap(assignments: Map<number, Map<number, number>>, frameIndex: number): Map<number, number> {
  let map = assignments.get(frameIndex);
  if (!map) {
    map = new Map();
    assignments.set(frameIndex, map);
  }
  return map;
}

function addObservation(point: SparsePoint, frameIndex: number, featureIndex: number): void {
  if (!point.observations.some((observation) => observation.frameIndex === frameIndex)) {
    point.observations.push({ frameIndex, featureIndex });
  }
}

function tryCreatePoint(
  points: SparsePoint[],
  assignments: Map<number, Map<number, number>>,
  firstFrame: FrameFeatures,
  secondFrame: FrameFeatures,
  firstPose: CameraPose,
  secondPose: CameraPose,
  match: FeatureMatch,
  focal: number,
  principal: Point2,
): void {
  const firstAssignments = assignmentMap(assignments, firstFrame.sourceIndex);
  const secondAssignments = assignmentMap(assignments, secondFrame.sourceIndex);
  const existing = firstAssignments.get(match.first) ?? secondAssignments.get(match.second);
  if (existing !== undefined) {
    firstAssignments.set(match.first, existing);
    secondAssignments.set(match.second, existing);
    const point = points[existing];
    if (point) {
      addObservation(point, firstFrame.sourceIndex, match.first);
      addObservation(point, secondFrame.sourceIndex, match.second);
    }
    return;
  }
  const firstPixel = featurePoint(firstFrame, match.first);
  const secondPixel = featurePoint(secondFrame, match.second);
  const position = triangulateMatch(firstPose, secondPose, firstPixel, secondPixel, focal, principal);
  if (!position || !Object.values(position).every(Number.isFinite)) return;
  if (Math.max(Math.abs(position.x), Math.abs(position.y), Math.abs(position.z)) > 10_000) return;
  if (cameraPoint(firstPose, position).z <= 0 || cameraPoint(secondPose, position).z <= 0) return;
  const errorA = reprojectionError(firstPose, position, firstPixel, focal, principal);
  const errorB = reprojectionError(secondPose, position, secondPixel, focal, principal);
  if (Math.max(errorA, errorB) > 3.25 || parallaxDegrees(firstPose, secondPose, position) < 0.35) return;
  const firstColor = featureColor(firstFrame, match.first);
  const secondColor = featureColor(secondFrame, match.second);
  const pointIndex = points.length;
  points.push({
    id: pointIndex + 1,
    position,
    color: [
      Math.round((firstColor[0] + secondColor[0]) * 0.5),
      Math.round((firstColor[1] + secondColor[1]) * 0.5),
      Math.round((firstColor[2] + secondColor[2]) * 0.5),
    ],
    error: (errorA + errorB) * 0.5,
    observations: [
      { frameIndex: firstFrame.sourceIndex, featureIndex: match.first },
      { frameIndex: secondFrame.sourceIndex, featureIndex: match.second },
    ],
  });
  firstAssignments.set(match.first, pointIndex);
  secondAssignments.set(match.second, pointIndex);
}

function attachKnownMatches(
  matches: FeatureMatch[],
  firstFrame: FrameFeatures,
  secondFrame: FrameFeatures,
  secondPose: CameraPose,
  points: SparsePoint[],
  assignments: Map<number, Map<number, number>>,
  focal: number,
  principal: Point2,
): void {
  const firstAssignments = assignmentMap(assignments, firstFrame.sourceIndex);
  const secondAssignments = assignmentMap(assignments, secondFrame.sourceIndex);
  for (const match of matches) {
    const pointIndex = firstAssignments.get(match.first);
    const point = pointIndex === undefined ? undefined : points[pointIndex];
    if (pointIndex === undefined || !point) continue;
    if (reprojectionError(secondPose, point.position, featurePoint(secondFrame, match.second), focal, principal) > 3.5) continue;
    secondAssignments.set(match.second, pointIndex);
    addObservation(point, secondFrame.sourceIndex, match.second);
  }
}

async function registerFrame(
  client: OpenCvFeatureClient,
  secondFrame: FrameFeatures,
  anchors: RegistrationAnchor[],
  points: SparsePoint[],
  assignments: Map<number, Map<number, number>>,
  focal: number,
  principal: Point2,
): Promise<RegistrationAttempt> {
  const candidates = new Map<number, { pointIndex: number; distance: number }>();
  for (const anchor of anchors) {
    const known = assignmentMap(assignments, anchor.frame.sourceIndex);
    for (const match of anchor.matches) {
      const pointIndex = known.get(match.first);
      if (pointIndex === undefined || !points[pointIndex]) continue;
      const existing = candidates.get(match.second);
      if (!existing || match.distance < existing.distance) {
        candidates.set(match.second, { pointIndex, distance: match.distance });
      }
    }
  }
  const correspondences = Array.from(candidates.entries())
    .toSorted(([, a], [, b]) => a.distance - b.distance);
  const correspondenceFeatures: number[] = [];
  const correspondencePointIndices: number[] = [];
  const objectPoints = [];
  const imagePoints = [];
  const usedPoints = new Set<number>();
  for (const [featureIndex, candidate] of correspondences) {
    if (usedPoints.has(candidate.pointIndex)) continue;
    const point = points[candidate.pointIndex];
    if (!point) continue;
    usedPoints.add(candidate.pointIndex);
    correspondenceFeatures.push(featureIndex);
    correspondencePointIndices.push(candidate.pointIndex);
    objectPoints.push(point.position);
    imagePoints.push(featurePoint(secondFrame, featureIndex));
  }
  if (objectPoints.length < 12) {
    return { pose: null, correspondenceCount: objectPoints.length, inlierCount: 0 };
  }
  const estimate = await client.solvePnp(objectPoints, imagePoints, focal, principal);
  if (!estimate || estimate.inlierIndices.length < 10) {
    return {
      pose: null,
      correspondenceCount: objectPoints.length,
      inlierCount: estimate?.inlierIndices.length ?? 0,
    };
  }
  const secondAssignments = assignmentMap(assignments, secondFrame.sourceIndex);
  for (const index of estimate.inlierIndices) {
    const featureIndex = correspondenceFeatures[index];
    const pointIndex = correspondencePointIndices[index];
    const point = points[pointIndex];
    if (featureIndex === undefined || pointIndex === undefined || !point) continue;
    secondAssignments.set(featureIndex, pointIndex);
    addObservation(point, secondFrame.sourceIndex, featureIndex);
  }
  for (const anchor of anchors) {
    attachKnownMatches(anchor.matches, anchor.frame, secondFrame, estimate.pose, points, assignments, focal, principal);
  }
  return {
    pose: estimate.pose,
    correspondenceCount: objectPoints.length,
    inlierCount: estimate.inlierIndices.length,
  };
}

export async function reconstructSparseModel(
  files: File[],
  maxImageSide: number,
  onProgress: (progress: ReconstructionProgress) => void,
  signal: AbortSignal,
): Promise<SparseReconstruction> {
  const client = new OpenCvFeatureClient((current, total) => {
    onProgress({ current, total, registeredImages: 0, pointCount: 0, message: 'Extracting ORB features' });
  });
  signal.addEventListener('abort', () => client.terminate(), { once: true });
  try {
    const metadata = await client.initialize(files, maxImageSide);
    if (signal.aborted) throw new DOMException('Camera solving cancelled.', 'AbortError');
    const frames = metadata.filter((frame): frame is FrameFeatures => frame !== null);
    if (frames.length < 8) throw new Error('Camera solving needs at least 8 decodable frames.');
    const width = frames[0].solveWidth;
    const height = frames[0].solveHeight;
    const focal = Math.max(width, height) * 0.75;
    const principal = { x: width * 0.5, y: height * 0.5 };
    onProgress({ current: 0, total: frames.length, registeredImages: 0, pointCount: 0, message: 'Finding an initial camera baseline' });
    const initial = await selectInitialPair(client, frames, focal, principal);
    const poses = new Map<number, CameraPose>([
      [initial.first.sourceIndex, ORIGIN_POSE],
      [initial.second.sourceIndex, initial.secondPose],
    ]);
    const points: SparsePoint[] = [];
    const assignments = new Map<number, Map<number, number>>();
    for (const inlierIndex of initial.inliers) {
      tryCreatePoint(
        points,
        assignments,
        initial.first,
        initial.second,
        ORIGIN_POSE,
        initial.secondPose,
        initial.matches[inlierIndex],
        focal,
        principal,
      );
    }
    let registeredFrames = [initial.first, initial.second];
    const initialListIndex = frames.findIndex((frame) => frame.sourceIndex === initial.second.sourceIndex);
    // If the stable baseline is several source-rate frames away, recover the
    // frames between it and the origin from the already-triangulated tracks.
    // This avoids a frozen camera prefix while retaining the wider baseline.
    for (let index = 1; index < initialListIndex; index += 1) {
      if (signal.aborted) throw new DOMException('Camera solving cancelled.', 'AbortError');
      const frame = frames[index];
      const anchors: RegistrationAnchor[] = [];
      for (const anchor of [initial.first, initial.second]) {
        anchors.push({ frame: anchor, matches: await client.match(anchor.sourceIndex, frame.sourceIndex) });
      }
      const registration = await registerFrame(
        client,
        frame,
        anchors,
        points,
        assignments,
        focal,
        principal,
      );
      if (!registration.pose) continue;
      poses.set(frame.sourceIndex, registration.pose);
      for (const anchor of anchors) {
        const anchorPose = poses.get(anchor.frame.sourceIndex);
        if (!anchorPose) continue;
        for (const match of anchor.matches) {
          tryCreatePoint(
            points,
            assignments,
            anchor.frame,
            frame,
            anchorPose,
            registration.pose,
            match,
            focal,
            principal,
          );
        }
      }
      registeredFrames.push(frame);
    }
    registeredFrames = registeredFrames.toSorted((a, b) => a.sourceIndex - b.sourceIndex);
    for (let index = initialListIndex + 1; index < frames.length; index += 1) {
      if (signal.aborted) throw new DOMException('Camera solving cancelled.', 'AbortError');
      const frame = frames[index];
      const anchors: RegistrationAnchor[] = [];
      for (const anchor of registeredFrames.slice(-4).toReversed()) {
        anchors.push({ frame: anchor, matches: await client.match(anchor.sourceIndex, frame.sourceIndex) });
      }
      const registration = await registerFrame(client, frame, anchors, points, assignments, focal, principal);
      const nearestAnchor = anchors[0];
      const nearestPose = nearestAnchor ? poses.get(nearestAnchor.frame.sourceIndex) : null;
      const sequential = !registration.pose && nearestAnchor && nearestPose
        ? recoverSequentialPose(
            nearestAnchor.frame,
            frame,
            nearestPose,
            nearestAnchor.matches,
            focal,
            principal,
            recentCameraStep(registeredFrames, poses),
          )
        : null;
      const pose = registration.pose ?? sequential?.pose ?? null;
      if (pose) {
        poses.set(frame.sourceIndex, pose);
        for (const anchor of anchors) {
          const anchorPose = poses.get(anchor.frame.sourceIndex);
          if (!anchorPose) continue;
          for (const match of anchor.matches) {
            tryCreatePoint(
              points,
              assignments,
              anchor.frame,
              frame,
              anchorPose,
              pose,
              match,
              focal,
              principal,
            );
          }
        }
        registeredFrames.push(frame);
      }
      onProgress({
        current: index + 1,
        total: frames.length,
        registeredImages: poses.size,
        pointCount: points.length,
        message: registration.pose
          ? `Registered ${frame.name} (${registration.inlierCount}/${registration.correspondenceCount} tracks)`
          : sequential
            ? `Registered ${frame.name} (${sequential.inlierCount} sequential tracks)`
          : `Skipped ${frame.name}: ${registration.inlierCount}/${registration.correspondenceCount} stable tracks`,
      });
    }
    if (poses.size < 8) throw new Error(`Camera solving registered only ${poses.size} views; at least 8 are required.`);
    if (points.length < 250) throw new Error(`Camera solving recovered only ${points.length} stable points; capture more texture and overlap.`);
    return { frames, poses, points, focalLength: focal, principalPoint: principal };
  } finally {
    await client.dispose().catch(() => undefined);
  }
}
