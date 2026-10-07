import packed from './knitPassageFrames.json';
import type { CurveSet } from './geometryEvaluation';
import { KNIT_PASSAGE_POINTS, KNIT_PASSAGE_ROWS, type KnitPassageSpec } from './knitPassageSpec';

let decoded: Float32Array | undefined;
const stride = KNIT_PASSAGE_POINTS * KNIT_PASSAGE_ROWS * 3;

/** Decode once per renderer; the durable graph contains only the study's playback settings. */
function frames(): Float32Array {
  if (decoded) return decoded;
  if (packed.version !== 1 || packed.points !== KNIT_PASSAGE_POINTS || packed.rows !== KNIT_PASSAGE_ROWS
    || !Number.isInteger(packed.frames) || packed.frames < 2 || packed.bounds.length !== 6) {
    throw new Error('Invalid Knit Passage study data.');
  }
  const raw = atob(packed.data);
  if (raw.length !== packed.frames * stride * 2) throw new Error('Incomplete Knit Passage study data.');
  const result = new Float32Array(packed.frames * stride);
  for (let index = 0; index < result.length; index++) {
    const axis = index % 3, quantized = raw.charCodeAt(index * 2) | raw.charCodeAt(index * 2 + 1) << 8;
    result[index] = packed.bounds[axis] + quantized / 65535 * (packed.bounds[axis + 3] - packed.bounds[axis]);
  }
  decoded = result;
  return result;
}

export function knitPassageCurves(spec: KnitPassageSpec): CurveSet {
  const source = frames(), sample = spec.phase * (packed.frames - 1), a = Math.floor(sample), b = Math.min(a + 1, packed.frames - 1);
  const alpha = sample - a, positions = new Float32Array(stride);
  // A common frame follows the travelling patch while preserving the user's orbital camera.
  const angle = spec.follow ? 0 : spec.phase * spec.travel * Math.PI * 2;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let point = 0; point < stride; point += 3) {
    const at = a * stride + point, next = b * stride + point;
    const x = source[at] + (source[next] - source[at]) * alpha;
    const y = source[at + 1] + (source[next + 1] - source[at + 1]) * alpha;
    positions[point] = cosine * x - sine * y;
    positions[point + 1] = sine * x + cosine * y;
    positions[point + 2] = source[at + 2] + (source[next + 2] - source[at + 2]) * alpha;
  }
  return { positions, starts: Uint32Array.from({ length: KNIT_PASSAGE_ROWS }, (_, row) => row * KNIT_PASSAGE_POINTS),
    counts: new Uint32Array(KNIT_PASSAGE_ROWS).fill(KNIT_PASSAGE_POINTS) };
}
