import * as ort from 'onnxruntime-web/webgpu';
import type {
  FaceAnalysisBackend,
  FaceAnalysisBox,
  FaceAnalysisPoint,
} from '../../types/clipMetadata';
import type {
  FaceRuntimeDetection,
  FaceWorkerRequest,
  FaceWorkerResponse,
} from './types';

const YUNET_SCORE_THRESHOLD = 0.72;
const YUNET_NMS_THRESHOLD = 0.3;
const YUNET_STRIDES = [8, 16, 32] as const;
const SFACE_SIZE = 112;
const SFACE_TARGET: readonly [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 1;

interface PixelPoint {
  x: number;
  y: number;
}

interface DecodedFace {
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  landmarks: PixelPoint[];
}

let yunetSession: ort.InferenceSession | null = null;
let sfaceSession: ort.InferenceSession | null = null;
let loadedBackend: FaceAnalysisBackend = 'wasm';
let yunetModelBuffer: ArrayBuffer | null = null;
let sfaceModelBuffer: ArrayBuffer | null = null;

function post(message: FaceWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function createSession(
  buffer: ArrayBuffer,
  providers: ort.InferenceSession.SessionOptions['executionProviders'],
): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(buffer, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
}

async function createSessions(preferWebGpu: boolean): Promise<void> {
  if (!yunetModelBuffer || !sfaceModelBuffer) {
    throw new Error('YuNet and SFace model buffers are unavailable.');
  }

  const canUseWebGpu = preferWebGpu && Boolean(
    (self.navigator as Navigator & { gpu?: GPU }).gpu,
  );
  if (canUseWebGpu) {
    try {
      [yunetSession, sfaceSession] = await Promise.all([
        createSession(yunetModelBuffer, ['webgpu', 'wasm']),
        createSession(sfaceModelBuffer, ['webgpu', 'wasm']),
      ]);
      loadedBackend = 'webgpu';
      return;
    } catch {
      yunetSession = null;
      sfaceSession = null;
    }
  }

  [yunetSession, sfaceSession] = await Promise.all([
    createSession(yunetModelBuffer, ['wasm']),
    createSession(sfaceModelBuffer, ['wasm']),
  ]);
  loadedBackend = 'wasm';
}

function prepareYuNetInput(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): { tensor: ort.Tensor; paddedWidth: number; paddedHeight: number } {
  const paddedWidth = Math.ceil(width / 32) * 32;
  const paddedHeight = Math.ceil(height / 32) * 32;
  const planeSize = paddedWidth * paddedHeight;
  const data = new Float32Array(planeSize * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = y * paddedWidth + x;
      data[target] = rgba[source + 2] ?? 0;
      data[planeSize + target] = rgba[source + 1] ?? 0;
      data[planeSize * 2 + target] = rgba[source] ?? 0;
    }
  }

  return {
    tensor: new ort.Tensor('float32', data, [1, 3, paddedHeight, paddedWidth]),
    paddedWidth,
    paddedHeight,
  };
}

function tensorData(
  outputs: ort.InferenceSession.OnnxValueMapType,
  name: string,
): Float32Array {
  const data = outputs[name]?.data;
  if (!(data instanceof Float32Array)) {
    throw new Error(`YuNet output "${name}" is missing or has an unexpected type.`);
  }
  return data;
}

function decodeYuNet(
  outputs: ort.InferenceSession.OnnxValueMapType,
  inputWidth: number,
  inputHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): DecodedFace[] {
  const candidates: DecodedFace[] = [];
  let hasNonZeroOutput = false;

  for (const stride of YUNET_STRIDES) {
    const cols = inputWidth / stride;
    const rows = inputHeight / stride;
    const cls = tensorData(outputs, `cls_${stride}`);
    const obj = tensorData(outputs, `obj_${stride}`);
    const bbox = tensorData(outputs, `bbox_${stride}`);
    const kps = tensorData(outputs, `kps_${stride}`);
    const locations = rows * cols;
    if (
      cls.length !== locations
      || obj.length !== locations
      || bbox.length !== locations * 4
      || kps.length !== locations * 10
    ) {
      throw new Error(`YuNet returned invalid output shapes for stride ${stride}.`);
    }
    hasNonZeroOutput ||= [cls, obj, bbox, kps]
      .some(values => values.some(value => finite(value) && Math.abs(value) > 1e-12));

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const score = Math.sqrt(
          clamp(cls[index] ?? 0, 0, 1) * clamp(obj[index] ?? 0, 0, 1),
        );
        if (score < YUNET_SCORE_THRESHOLD) continue;

        const centerX = (col + (bbox[index * 4] ?? 0)) * stride;
        const centerY = (row + (bbox[index * 4 + 1] ?? 0)) * stride;
        const boxWidth = Math.exp(bbox[index * 4 + 2] ?? 0) * stride;
        const boxHeight = Math.exp(bbox[index * 4 + 3] ?? 0) * stride;
        if (![centerX, centerY, boxWidth, boxHeight].every(finite)) continue;
        if (centerX >= sourceWidth || centerY >= sourceHeight || boxWidth < 4 || boxHeight < 4) continue;

        const x = clamp(centerX - boxWidth / 2, 0, sourceWidth);
        const y = clamp(centerY - boxHeight / 2, 0, sourceHeight);
        const right = clamp(centerX + boxWidth / 2, 0, sourceWidth);
        const bottom = clamp(centerY + boxHeight / 2, 0, sourceHeight);
        if (right - x < 4 || bottom - y < 4) continue;

        const landmarks: PixelPoint[] = [];
        let landmarksValid = true;
        for (let point = 0; point < 5; point += 1) {
          const px = (col + (kps[index * 10 + point * 2] ?? 0)) * stride;
          const py = (row + (kps[index * 10 + point * 2 + 1] ?? 0)) * stride;
          if (!finite(px) || !finite(py)) landmarksValid = false;
          landmarks.push({ x: px, y: py });
        }
        if (!landmarksValid) continue;

        candidates.push({
          confidence: score,
          box: { x, y, width: right - x, height: bottom - y },
          landmarks,
        });
      }
    }
  }

  if (!hasNonZeroOutput) throw new Error('YuNet returned degenerate all-zero output.');
  return nonMaximumSuppression(candidates);
}

function intersectionOverUnion(a: DecodedFace['box'], b: DecodedFace['box']): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function nonMaximumSuppression(candidates: DecodedFace[]): DecodedFace[] {
  const kept: DecodedFace[] = [];
  for (const candidate of candidates.toSorted((a, b) => b.confidence - a.confidence)) {
    if (kept.every(existing => intersectionOverUnion(existing.box, candidate.box) < YUNET_NMS_THRESHOLD)) {
      kept.push(candidate);
    }
  }
  return kept;
}

function similarityTransform(landmarks: readonly PixelPoint[]): [number, number, number, number] {
  const sourceMean = landmarks.reduce(
    (sum, point) => ({ x: sum.x + point.x / 5, y: sum.y + point.y / 5 }),
    { x: 0, y: 0 },
  );
  const targetMean = SFACE_TARGET.reduce(
    (sum, point) => ({ x: sum.x + point[0] / 5, y: sum.y + point[1] / 5 }),
    { x: 0, y: 0 },
  );
  let aNumerator = 0;
  let bNumerator = 0;
  let denominator = 0;

  for (let index = 0; index < 5; index += 1) {
    const source = landmarks[index]!;
    const target = SFACE_TARGET[index]!;
    const sx = source.x - sourceMean.x;
    const sy = source.y - sourceMean.y;
    const dx = target[0] - targetMean.x;
    const dy = target[1] - targetMean.y;
    aNumerator += sx * dx + sy * dy;
    bNumerator += sx * dy - sy * dx;
    denominator += sx * sx + sy * sy;
  }

  if (denominator <= 1e-8) throw new Error('SFace alignment landmarks are degenerate.');
  const a = aNumerator / denominator;
  const b = bNumerator / denominator;
  const tx = targetMean.x - a * sourceMean.x + b * sourceMean.y;
  const ty = targetMean.y - b * sourceMean.x - a * sourceMean.y;
  return [a, b, tx, ty];
}

function sampleChannel(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => rgba[(py * width + px) * 4 + channel] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function prepareSFaceInput(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  landmarks: readonly PixelPoint[],
): ort.Tensor {
  const [a, b, tx, ty] = similarityTransform(landmarks);
  const inverseDenominator = a * a + b * b;
  if (inverseDenominator <= 1e-10) throw new Error('SFace alignment transform is invalid.');
  const planeSize = SFACE_SIZE * SFACE_SIZE;
  const data = new Float32Array(planeSize * 3);

  for (let y = 0; y < SFACE_SIZE; y += 1) {
    for (let x = 0; x < SFACE_SIZE; x += 1) {
      const dx = x - tx;
      const dy = y - ty;
      const sourceX = (a * dx + b * dy) / inverseDenominator;
      const sourceY = (-b * dx + a * dy) / inverseDenominator;
      const target = y * SFACE_SIZE + x;
      data[target] = sampleChannel(rgba, width, height, sourceX, sourceY, 0);
      data[planeSize + target] = sampleChannel(rgba, width, height, sourceX, sourceY, 1);
      data[planeSize * 2 + target] = sampleChannel(rgba, width, height, sourceX, sourceY, 2);
    }
  }

  return new ort.Tensor('float32', data, [1, 3, SFACE_SIZE, SFACE_SIZE]);
}

function normalizeEmbedding(data: ort.TypedTensor<'float32'>['data']): Float32Array {
  if (!(data instanceof Float32Array)) throw new Error('SFace returned an unexpected embedding type.');
  const embedding = data.slice();
  let norm = 0;
  for (const value of embedding) norm += value * value;
  norm = Math.sqrt(norm);
  if (!finite(norm) || norm <= 0) throw new Error('SFace returned an invalid embedding.');
  for (let index = 0; index < embedding.length; index += 1) embedding[index] /= norm;
  return embedding;
}

function normalizeBox(box: DecodedFace['box'], width: number, height: number): FaceAnalysisBox {
  return {
    x: clamp(box.x / width, 0, 1),
    y: clamp(box.y / height, 0, 1),
    width: clamp(box.width / width, 0, 1),
    height: clamp(box.height / height, 0, 1),
  };
}

function normalizeLandmarks(
  landmarks: readonly PixelPoint[],
  width: number,
  height: number,
): FaceAnalysisPoint[] {
  return landmarks.map(point => ({
    x: clamp(point.x / width, 0, 1),
    y: clamp(point.y / height, 0, 1),
  }));
}

async function analyzeFrame(
  rgbaBuffer: ArrayBuffer,
  width: number,
  height: number,
): Promise<FaceRuntimeDetection[]> {
  if (!yunetSession || !sfaceSession) throw new Error('YuNet + SFace are not initialized.');
  if (width <= 0 || height <= 0) throw new Error('Face analysis received an empty frame.');
  const rgba = new Uint8ClampedArray(rgbaBuffer);
  if (rgba.length !== width * height * 4) throw new Error('Face analysis frame buffer has an invalid size.');

  const prepared = prepareYuNetInput(rgba, width, height);
  const yunetOutputs = await yunetSession.run({ input: prepared.tensor });
  const faces = decodeYuNet(
    yunetOutputs,
    prepared.paddedWidth,
    prepared.paddedHeight,
    width,
    height,
  );
  const detections: FaceRuntimeDetection[] = [];

  for (const face of faces) {
    const input = prepareSFaceInput(rgba, width, height, face.landmarks);
    const output = await sfaceSession.run({ data: input });
    const embeddingValue = output.fc1 ?? output[sfaceSession.outputNames[0] ?? 'fc1'];
    if (!embeddingValue) throw new Error('SFace embedding output is missing.');
    detections.push({
      confidence: face.confidence,
      box: normalizeBox(face.box, width, height),
      landmarks: normalizeLandmarks(face.landmarks, width, height),
      embedding: normalizeEmbedding(embeddingValue.data as ort.TypedTensor<'float32'>['data']),
    });
  }

  return detections;
}

async function analyzeWithFallback(
  rgba: ArrayBuffer,
  width: number,
  height: number,
): Promise<FaceRuntimeDetection[]> {
  try {
    return await analyzeFrame(rgba, width, height);
  } catch (error) {
    if (loadedBackend !== 'webgpu') throw error;
    await createSessions(false);
    return analyzeFrame(rgba, width, height);
  }
}

self.onmessage = async (event: MessageEvent<FaceWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      yunetModelBuffer = message.yunetBuffer;
      sfaceModelBuffer = message.sfaceBuffer;
      await createSessions(message.preferWebGpu);
      post({ type: 'ready', backend: loadedBackend });
      return;
    }
    if (message.type === 'analyze-frame') {
      const detections = await analyzeWithFallback(
        message.rgba,
        message.width,
        message.height,
      );
      post(
        { type: 'result', requestId: message.requestId, detections },
        detections.map(detection => detection.embedding.buffer),
      );
      return;
    }
    yunetSession = null;
    sfaceSession = null;
    yunetModelBuffer = null;
    sfaceModelBuffer = null;
  } catch (error) {
    post({
      type: 'error',
      requestId: message.type === 'analyze-frame' ? message.requestId : undefined,
      error: errorMessage(error),
    });
  }
};
