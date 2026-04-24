import { FLOATS_PER_SPLAT } from '../loaders/types.ts';

export interface SplatOrderSortResult {
  order: Uint32Array;
  count: number;
}

const MIN_BUCKET_BITS = 10;
const MAX_BUCKET_BITS = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function transformDepth(viewWorldMatrix: Float32Array, x: number, y: number, z: number): number {
  const viewZ =
    viewWorldMatrix[2] * x +
    viewWorldMatrix[6] * y +
    viewWorldMatrix[10] * z +
    viewWorldMatrix[14];
  return -viewZ;
}

function buildIdentityOrder(order: Uint32Array, count: number): Uint32Array {
  for (let i = 0; i < count; i += 1) {
    order[i] = i;
  }
  return order;
}

export function buildSplatCenters(data: Float32Array, splatCount: number): Float32Array {
  const centers = new Float32Array(splatCount * 3);
  for (let i = 0; i < splatCount; i += 1) {
    const srcBase = i * FLOATS_PER_SPLAT;
    const dstBase = i * 3;
    centers[dstBase + 0] = data[srcBase + 0];
    centers[dstBase + 1] = data[srcBase + 1];
    centers[dstBase + 2] = data[srcBase + 2];
  }
  return centers;
}

export function sortSplatOrderByDepth(
  centers: Float32Array,
  viewWorldMatrix: Float32Array,
  requestedCount: number,
  reusableOrder?: Uint32Array,
): SplatOrderSortResult {
  const maxCount = Math.floor(centers.length / 3);
  const count = clamp(Math.floor(requestedCount), 0, maxCount);
  const order = reusableOrder && reusableOrder.length >= count
    ? reusableOrder
    : new Uint32Array(count);

  if (count <= 1) {
    return { order: buildIdentityOrder(order, count).subarray(0, count), count };
  }

  const depths = new Float32Array(count);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const base = i * 3;
    const depth = transformDepth(
      viewWorldMatrix,
      centers[base + 0],
      centers[base + 1],
      centers[base + 2],
    );
    const safeDepth = Number.isFinite(depth) ? depth : -Infinity;
    depths[i] = safeDepth;
    if (safeDepth < minDepth) minDepth = safeDepth;
    if (safeDepth > maxDepth) maxDepth = safeDepth;
  }

  const range = maxDepth - minDepth;
  if (!Number.isFinite(range) || range < 1e-6) {
    return { order: buildIdentityOrder(order, count).subarray(0, count), count };
  }

  const bucketBits = clamp(Math.round(Math.log2(count / 4)), MIN_BUCKET_BITS, MAX_BUCKET_BITS);
  const bucketCount = (2 ** bucketBits) + 1;
  const lastBucket = bucketCount - 1;
  const bucketCounts = new Uint32Array(bucketCount);
  const keys = new Uint32Array(count);

  for (let i = 0; i < count; i += 1) {
    const normalized = (depths[i] - minDepth) / range;
    const ascendingBucket = clamp(Math.floor(normalized * lastBucket), 0, lastBucket);
    const key = lastBucket - ascendingBucket;
    keys[i] = key;
    bucketCounts[key] += 1;
  }

  for (let i = 1; i < bucketCount; i += 1) {
    bucketCounts[i] += bucketCounts[i - 1];
  }

  for (let i = count - 1; i >= 0; i -= 1) {
    const key = keys[i];
    const destination = --bucketCounts[key];
    order[destination] = i;
  }

  return { order: order.subarray(0, count), count };
}

export function multiplyMat4ColumnMajor(
  left: Float32Array,
  right: Float32Array,
  out = new Float32Array(16),
): Float32Array {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[0 * 4 + row] * right[column * 4 + 0] +
        left[1 * 4 + row] * right[column * 4 + 1] +
        left[2 * 4 + row] * right[column * 4 + 2] +
        left[3 * 4 + row] * right[column * 4 + 3];
    }
  }
  return out;
}
