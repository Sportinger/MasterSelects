import type { FlattenedMotionPath } from '../../services/motionDesign/path/flattenPath';
import { MOTION_PATH_MAX_FLATTENED_VERTICES } from '../../types/motionDesign';

export const MOTION_PATH_VERTEX_FLOAT_STRIDE = 4;
export const MOTION_PATH_VERTEX_BYTE_STRIDE =
  MOTION_PATH_VERTEX_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
// Must match MAX_PATH_VERTICES in shaders/motionShapes.wgsl (WGSL cannot import TS constants).
export const MOTION_PATH_MAX_BUFFER_CAPACITY = MOTION_PATH_MAX_FLATTENED_VERTICES;

export interface MotionPathBufferUpdate {
  data: Float32Array<ArrayBuffer>;
  pointCount: number;
  needsUpload: boolean;
}

function createPathData(path: FlattenedMotionPath): Float32Array<ArrayBuffer> {
  const data = new Float32Array(path.points.length * MOTION_PATH_VERTEX_FLOAT_STRIDE);
  for (let index = 0; index < path.points.length; index += 1) {
    const offset = index * MOTION_PATH_VERTEX_FLOAT_STRIDE;
    data[offset] = path.points[index].x;
    data[offset + 1] = path.points[index].y;
    data[offset + 2] = path.cumulativeLengths[index];
    data[offset + 3] = 0;
  }
  return data;
}

function arraysEqual(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

/** Retains the last flattened path so unchanged frames avoid a storage upload. */
export class MotionPathBufferState {
  #previous = new Float32Array(0);
  #forceUpload = false;

  prepare(path: FlattenedMotionPath): MotionPathBufferUpdate {
    if (path.points.length > MOTION_PATH_MAX_BUFFER_CAPACITY) {
      throw new RangeError('Motion path exceeds GPU buffer capacity');
    }
    const data = createPathData(path);
    const needsUpload = this.#forceUpload || !arraysEqual(this.#previous, data);
    this.#previous = data.slice();
    this.#forceUpload = false;
    return { data, pointCount: path.points.length, needsUpload };
  }

  invalidate(): void {
    this.#forceUpload = true;
  }
}
