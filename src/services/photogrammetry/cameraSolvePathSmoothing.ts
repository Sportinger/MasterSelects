import type { SolvedCameraPoseKey } from './cameraSolvePoses';

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function medianFilter(values: number[], radius: number): number[] {
  return values.map((_, index) => median(values.slice(
    Math.max(0, index - radius),
    Math.min(values.length, index + radius + 1),
  )));
}

function gaussianFilter(values: number[], radius: number): number[] {
  const sigma = Math.max(0.75, radius * 0.55);
  return values.map((_, index) => {
    let weightedValue = 0;
    let weightTotal = 0;
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    for (let cursor = start; cursor <= end; cursor += 1) {
      const distance = cursor - index;
      const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
      weightedValue += values[cursor] * weight;
      weightTotal += weight;
    }
    return weightedValue / Math.max(Number.EPSILON, weightTotal);
  });
}

function typicalStep(poses: SolvedCameraPoseKey[]): number {
  const steps = poses.slice(1)
    .map((pose, index) => pose.time - poses[index].time)
    .filter((step) => Number.isFinite(step) && step > 1e-5)
    .toSorted((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? 1 / 24;
}

function smoothValues(values: number[], radius: number, anchorFirst: boolean): number[] {
  const filtered = gaussianFilter(medianFilter(values, Math.min(2, radius)), radius);
  if (!anchorFirst || filtered.length === 0) return filtered;
  const offset = values[0] - filtered[0];
  return filtered.map((value) => value + offset);
}

/** Removes single-frame SfM outliers while retaining the solved path and its original first pose. */
export function smoothSolvedCameraPoses(poses: SolvedCameraPoseKey[]): SolvedCameraPoseKey[] {
  if (poses.length < 3) return poses.map((pose) => ({
    ...pose,
    position: { ...pose.position },
    rotation: { ...pose.rotation },
  }));
  const radius = Math.max(1, Math.min(10, Math.round(0.2 / typicalStep(poses))));
  const positionX = smoothValues(poses.map((pose) => pose.position.x), radius, true);
  const positionY = smoothValues(poses.map((pose) => pose.position.y), radius, true);
  const positionZ = smoothValues(poses.map((pose) => pose.position.z), radius, true);
  const rotationX = smoothValues(poses.map((pose) => pose.rotation.x), radius, true);
  const rotationY = smoothValues(poses.map((pose) => pose.rotation.y), radius, true);
  const rotationZ = smoothValues(poses.map((pose) => pose.rotation.z), radius, true);

  return poses.map((pose, index) => ({
    ...pose,
    position: { x: positionX[index], y: positionY[index], z: positionZ[index] },
    rotation: { x: rotationX[index], y: rotationY[index], z: rotationZ[index] },
  }));
}

export function snapSolvedCameraPosesToFrames(
  poses: SolvedCameraPoseKey[],
  frameRate: number,
): SolvedCameraPoseKey[] {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return poses;
  const byFrame = new Map<number, SolvedCameraPoseKey>();
  for (const pose of poses) {
    const frame = Math.max(0, Math.round(pose.time * frameRate));
    byFrame.set(frame, { ...pose, time: frame / frameRate });
  }
  return Array.from(byFrame.values()).toSorted((a, b) => a.time - b.time);
}
