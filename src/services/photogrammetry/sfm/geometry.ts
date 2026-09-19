import { Matrix, SVD, determinant } from 'ml-matrix';
import type { CameraPose, FeatureMatch, Matrix3, Point2, Point3 } from './types';

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function matrix3ToMl(value: Matrix3): Matrix {
  return new Matrix([
    [value[0], value[1], value[2]],
    [value[3], value[4], value[5]],
    [value[6], value[7], value[8]],
  ]);
}

function mlToMatrix3(value: Matrix): Matrix3 {
  return [
    value.get(0, 0), value.get(0, 1), value.get(0, 2),
    value.get(1, 0), value.get(1, 1), value.get(1, 2),
    value.get(2, 0), value.get(2, 1), value.get(2, 2),
  ];
}

export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] = (
        a[row * 3] * b[column]
        + a[row * 3 + 1] * b[3 + column]
        + a[row * 3 + 2] * b[6 + column]
      );
    }
  }
  return out as Matrix3;
}

export function transformPoint(rotation: Matrix3, point: Point3): Point3 {
  return {
    x: rotation[0] * point.x + rotation[1] * point.y + rotation[2] * point.z,
    y: rotation[3] * point.x + rotation[4] * point.y + rotation[5] * point.z,
    z: rotation[6] * point.x + rotation[7] * point.y + rotation[8] * point.z,
  };
}

export function cameraPoint(pose: CameraPose, point: Point3): Point3 {
  const rotated = transformPoint(pose.rotation, point);
  return {
    x: rotated.x + pose.translation.x,
    y: rotated.y + pose.translation.y,
    z: rotated.z + pose.translation.z,
  };
}

export function cameraCenter(pose: CameraPose): Point3 {
  const r = pose.rotation;
  const t = pose.translation;
  return {
    x: -(r[0] * t.x + r[3] * t.y + r[6] * t.z),
    y: -(r[1] * t.x + r[4] * t.y + r[7] * t.z),
    z: -(r[2] * t.x + r[5] * t.y + r[8] * t.z),
  };
}

export function normalizePixel(point: Point2, focal: number, principal: Point2): Point2 {
  return { x: (point.x - principal.x) / focal, y: (point.y - principal.y) / focal };
}

function essentialRows(
  matches: FeatureMatch[],
  first: Float32Array,
  second: Float32Array,
  indices: number[],
  focal: number,
  principal: Point2,
): number[][] {
  return indices.map((index) => {
    const match = matches[index];
    const a = normalizePixel({ x: first[match.first * 2], y: first[match.first * 2 + 1] }, focal, principal);
    const b = normalizePixel({ x: second[match.second * 2], y: second[match.second * 2 + 1] }, focal, principal);
    return [b.x * a.x, b.x * a.y, b.x, b.y * a.x, b.y * a.y, b.y, a.x, a.y, 1];
  });
}

function enforceEssential(value: Matrix3): Matrix3 {
  const svd = new SVD(matrix3ToMl(value), { autoTranspose: true });
  const mean = (svd.diagonal[0] + svd.diagonal[1]) * 0.5;
  const constrained = svd.leftSingularVectors
    .mmul(Matrix.diag([mean, mean, 0]))
    .mmul(svd.rightSingularVectors.transpose());
  return mlToMatrix3(constrained);
}

function fitEssential(
  matches: FeatureMatch[],
  first: Float32Array,
  second: Float32Array,
  indices: number[],
  focal: number,
  principal: Point2,
): Matrix3 | null {
  if (indices.length < 8) return null;
  const design = new Matrix(essentialRows(matches, first, second, indices, focal, principal));
  const normal = design.transpose().mmul(design);
  const svd = new SVD(normal, { autoTranspose: true });
  const vector = Array.from({ length: 9 }, (_, row) => svd.rightSingularVectors.get(row, 8));
  if (!vector.every(Number.isFinite)) return null;
  return enforceEssential(vector as Matrix3);
}

function sampsonError(essential: Matrix3, first: Point2, second: Point2): number {
  const ex1x = essential[0] * first.x + essential[1] * first.y + essential[2];
  const ex1y = essential[3] * first.x + essential[4] * first.y + essential[5];
  const ex1z = essential[6] * first.x + essential[7] * first.y + essential[8];
  const etx2x = essential[0] * second.x + essential[3] * second.y + essential[6];
  const etx2y = essential[1] * second.x + essential[4] * second.y + essential[7];
  const residual = second.x * ex1x + second.y * ex1y + ex1z;
  const denominator = ex1x ** 2 + ex1y ** 2 + etx2x ** 2 + etx2y ** 2;
  return denominator > 1e-12 ? (residual * residual) / denominator : Number.POSITIVE_INFINITY;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function sampleIndices(count: number, size: number, random: () => number): number[] {
  const selected = new Set<number>();
  while (selected.size < Math.min(size, count)) selected.add(Math.floor(random() * count));
  return Array.from(selected);
}

export function estimateEssentialRansac(
  matches: FeatureMatch[],
  first: Float32Array,
  second: Float32Array,
  focal: number,
  principal: Point2,
  iterations = 700,
): { essential: Matrix3; inliers: number[] } | null {
  if (matches.length < 12) return null;
  const random = seededRandom(matches.length * 2_654_435_761);
  const normalized = matches.map((match) => ({
    first: normalizePixel({ x: first[match.first * 2], y: first[match.first * 2 + 1] }, focal, principal),
    second: normalizePixel({ x: second[match.second * 2], y: second[match.second * 2 + 1] }, focal, principal),
  }));
  const threshold = (1.75 / focal) ** 2;
  let best: { essential: Matrix3; inliers: number[] } | null = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const essential = fitEssential(matches, first, second, sampleIndices(matches.length, 8, random), focal, principal);
    if (!essential) continue;
    const inliers: number[] = [];
    normalized.forEach((pair, index) => {
      if (sampsonError(essential, pair.first, pair.second) <= threshold) inliers.push(index);
    });
    if (!best || inliers.length > best.inliers.length) best = { essential, inliers };
  }
  if (!best || best.inliers.length < 12) return null;
  const refined = fitEssential(matches, first, second, best.inliers, focal, principal);
  return refined ? { essential: refined, inliers: best.inliers } : best;
}

function ensureRotation(value: Matrix): Matrix {
  if (determinant(value) >= 0) return value;
  return value.mul(-1);
}

function triangulateNormalized(firstPose: CameraPose, secondPose: CameraPose, first: Point2, second: Point2): Point3 | null {
  const p1 = [...firstPose.rotation.slice(0, 3), firstPose.translation.x,
    ...firstPose.rotation.slice(3, 6), firstPose.translation.y,
    ...firstPose.rotation.slice(6, 9), firstPose.translation.z];
  const p2 = [...secondPose.rotation.slice(0, 3), secondPose.translation.x,
    ...secondPose.rotation.slice(3, 6), secondPose.translation.y,
    ...secondPose.rotation.slice(6, 9), secondPose.translation.z];
  const rows = [
    [first.x * p1[8] - p1[0], first.x * p1[9] - p1[1], first.x * p1[10] - p1[2], first.x * p1[11] - p1[3]],
    [first.y * p1[8] - p1[4], first.y * p1[9] - p1[5], first.y * p1[10] - p1[6], first.y * p1[11] - p1[7]],
    [second.x * p2[8] - p2[0], second.x * p2[9] - p2[1], second.x * p2[10] - p2[2], second.x * p2[11] - p2[3]],
    [second.y * p2[8] - p2[4], second.y * p2[9] - p2[5], second.y * p2[10] - p2[6], second.y * p2[11] - p2[7]],
  ];
  const svd = new SVD(new Matrix(rows), { autoTranspose: true });
  const homogeneous = Array.from({ length: 4 }, (_, row) => svd.rightSingularVectors.get(row, 3));
  if (Math.abs(homogeneous[3]) < 1e-10) return null;
  const point = { x: homogeneous[0] / homogeneous[3], y: homogeneous[1] / homogeneous[3], z: homogeneous[2] / homogeneous[3] };
  return Object.values(point).every(Number.isFinite) ? point : null;
}

export function triangulateMatch(
  firstPose: CameraPose,
  secondPose: CameraPose,
  firstPixel: Point2,
  secondPixel: Point2,
  focal: number,
  principal: Point2,
): Point3 | null {
  return triangulateNormalized(
    firstPose,
    secondPose,
    normalizePixel(firstPixel, focal, principal),
    normalizePixel(secondPixel, focal, principal),
  );
}

function candidatePose(rotation: Matrix, translation: number[], sign: number): CameraPose {
  return {
    rotation: mlToMatrix3(ensureRotation(rotation)),
    translation: { x: translation[0] * sign, y: translation[1] * sign, z: translation[2] * sign },
  };
}

export function recoverRelativePose(
  essential: Matrix3,
  matches: FeatureMatch[],
  inliers: number[],
  first: Float32Array,
  second: Float32Array,
  focal: number,
  principal: Point2,
): CameraPose | null {
  const svd = new SVD(matrix3ToMl(essential), { autoTranspose: true });
  let u = svd.leftSingularVectors;
  let v = svd.rightSingularVectors;
  if (determinant(u) < 0) u = u.mul(-1);
  if (determinant(v) < 0) v = v.mul(-1);
  const w = new Matrix([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  const rotations = [u.mmul(w).mmul(v.transpose()), u.mmul(w.transpose()).mmul(v.transpose())];
  const translation = [u.get(0, 2), u.get(1, 2), u.get(2, 2)];
  const origin: CameraPose = { rotation: IDENTITY, translation: { x: 0, y: 0, z: 0 } };
  let best: { pose: CameraPose; positive: number } | null = null;
  for (const rotation of rotations) {
    for (const sign of [1, -1]) {
      const pose = candidatePose(rotation, translation, sign);
      let positive = 0;
      for (const index of inliers.slice(0, 80)) {
        const match = matches[index];
        const point = triangulateMatch(
          origin,
          pose,
          { x: first[match.first * 2], y: first[match.first * 2 + 1] },
          { x: second[match.second * 2], y: second[match.second * 2 + 1] },
          focal,
          principal,
        );
        if (point && point.z > 0 && cameraPoint(pose, point).z > 0) positive += 1;
      }
      if (!best || positive > best.positive) best = { pose, positive };
    }
  }
  return best && best.positive >= Math.min(8, Math.floor(inliers.length * 0.25)) ? best.pose : null;
}

export function reprojectionError(
  pose: CameraPose,
  point: Point3,
  pixel: Point2,
  focal: number,
  principal: Point2,
): number {
  const camera = cameraPoint(pose, point);
  if (camera.z <= 1e-8) return Number.POSITIVE_INFINITY;
  const x = focal * camera.x / camera.z + principal.x;
  const y = focal * camera.y / camera.z + principal.y;
  return Math.hypot(x - pixel.x, y - pixel.y);
}

export function parallaxDegrees(firstPose: CameraPose, secondPose: CameraPose, point: Point3): number {
  const a = cameraCenter(firstPose);
  const b = cameraCenter(secondPose);
  const va = [point.x - a.x, point.y - a.y, point.z - a.z];
  const vb = [point.x - b.x, point.y - b.y, point.z - b.z];
  const lengthA = Math.hypot(...va);
  const lengthB = Math.hypot(...vb);
  if (lengthA < 1e-8 || lengthB < 1e-8) return 0;
  const cosine = Math.max(-1, Math.min(1, (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / (lengthA * lengthB)));
  return Math.acos(cosine) * 180 / Math.PI;
}
