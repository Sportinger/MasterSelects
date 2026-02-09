// SAM 2 Web Worker — runs ONNX encoder + decoder inference off the main thread
//
// Message protocol:
//   Main → Worker: SAM2WorkerRequest (load-model, encode-frame, decode-prompt, propagate-frame, reset-memory)
//   Worker → Main: SAM2WorkerResponse (model-ready, embedding-ready, mask-result, propagation-mask, error, progress)

import * as ort from 'onnxruntime-web';
import type { SAM2WorkerRequest, SAM2WorkerResponse, SAM2Point, SAM2Box } from './types';

// ONNX sessions
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;

// Cached image embedding from last encode
let currentEmbedding: ort.Tensor | null = null;
let currentHighResFeatures0: ort.Tensor | null = null;
let currentHighResFeatures1: ort.Tensor | null = null;

// SAM2 memory state for video propagation
let memoryBank: ort.Tensor | null = null;
let memoryPositions: ort.Tensor | null = null;

// Input image size the encoder was run on
const ENCODER_INPUT_SIZE = 1024; // SAM2 expects 1024x1024 input

function post(msg: SAM2WorkerResponse, transfer?: Transferable[]) {
  self.postMessage(msg, { transfer: transfer ?? [] });
}

// --- Model Loading ---

async function loadModel(encoderBuffer: ArrayBuffer, decoderBuffer: ArrayBuffer) {
  try {
    post({ type: 'progress', stage: 'Loading encoder...', progress: 0 });

    // Configure ONNX Runtime for WebGPU with WASM fallback
    const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = [];

    // Try WebGPU first
    try {
      if (typeof (self as any).navigator?.gpu !== 'undefined') {
        executionProviders.push('webgpu');
      }
    } catch {
      // WebGPU not available in worker
    }
    executionProviders.push('wasm'); // Always add WASM fallback

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders,
    };

    encoderSession = await ort.InferenceSession.create(encoderBuffer, sessionOptions);
    post({ type: 'progress', stage: 'Loading decoder...', progress: 50 });

    decoderSession = await ort.InferenceSession.create(decoderBuffer, {
      executionProviders: ['wasm'], // Decoder is small, WASM is fine
    });

    post({ type: 'progress', stage: 'Ready', progress: 100 });
    post({ type: 'model-ready' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    post({ type: 'error', error: `Failed to load SAM2 model: ${msg}` });
  }
}

// --- Image Encoding ---

/** Preprocess ImageData to a normalized float32 tensor [1, 3, 1024, 1024] */
function preprocessImage(imageData: ImageData): ort.Tensor {
  const { width, height, data } = imageData;

  // SAM2 mean/std normalization (ImageNet values)
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  const tensorData = new Float32Array(3 * ENCODER_INPUT_SIZE * ENCODER_INPUT_SIZE);

  // Scale factors for resize
  const scaleX = width / ENCODER_INPUT_SIZE;
  const scaleY = height / ENCODER_INPUT_SIZE;

  for (let y = 0; y < ENCODER_INPUT_SIZE; y++) {
    for (let x = 0; x < ENCODER_INPUT_SIZE; x++) {
      // Bilinear-ish: use nearest neighbor for simplicity in worker
      const srcX = Math.min(Math.floor(x * scaleX), width - 1);
      const srcY = Math.min(Math.floor(y * scaleY), height - 1);
      const srcIdx = (srcY * width + srcX) * 4;

      const pixelOffset = y * ENCODER_INPUT_SIZE + x;
      // CHW format: [R plane, G plane, B plane]
      tensorData[pixelOffset] = (data[srcIdx] / 255.0 - mean[0]) / std[0];
      tensorData[ENCODER_INPUT_SIZE * ENCODER_INPUT_SIZE + pixelOffset] = (data[srcIdx + 1] / 255.0 - mean[1]) / std[1];
      tensorData[2 * ENCODER_INPUT_SIZE * ENCODER_INPUT_SIZE + pixelOffset] = (data[srcIdx + 2] / 255.0 - mean[2]) / std[2];
    }
  }

  return new ort.Tensor('float32', tensorData, [1, 3, ENCODER_INPUT_SIZE, ENCODER_INPUT_SIZE]);
}

async function encodeFrame(imageData: ImageData, frameIndex: number) {
  if (!encoderSession) {
    post({ type: 'error', error: 'Encoder not loaded' });
    return;
  }

  try {
    const inputTensor = preprocessImage(imageData);
    const feeds: Record<string, ort.Tensor> = { image: inputTensor };

    const results = await encoderSession.run(feeds);

    // Store embeddings — exact output names depend on the ONNX model export
    // Common SAM2 encoder outputs: image_embeddings, high_res_feats_0, high_res_feats_1
    currentEmbedding = results['image_embeddings'] ?? results[Object.keys(results)[0]];
    currentHighResFeatures0 = results['high_res_feats_0'] ?? null;
    currentHighResFeatures1 = results['high_res_feats_1'] ?? null;

    post({ type: 'embedding-ready', frameIndex });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    post({ type: 'error', error: `Encode failed: ${msg}` });
  }
}

// --- Prompt Decoding ---

function buildPointTensors(points: SAM2Point[]) {
  // Convert normalized coords to 1024x1024 space
  const numPoints = Math.max(points.length, 1);
  const coordData = new Float32Array(numPoints * 2);
  const labelData = new Float32Array(numPoints);

  if (points.length === 0) {
    // No points — use a dummy background point at center
    coordData[0] = ENCODER_INPUT_SIZE / 2;
    coordData[1] = ENCODER_INPUT_SIZE / 2;
    labelData[0] = -1; // padding label
  } else {
    for (let i = 0; i < points.length; i++) {
      coordData[i * 2] = points[i].x * ENCODER_INPUT_SIZE;
      coordData[i * 2 + 1] = points[i].y * ENCODER_INPUT_SIZE;
      labelData[i] = points[i].label;
    }
  }

  return {
    point_coords: new ort.Tensor('float32', coordData, [1, numPoints, 2]),
    point_labels: new ort.Tensor('float32', labelData, [1, numPoints]),
  };
}

async function decodePrompt(
  points: SAM2Point[],
  _boxes: SAM2Box[],
  imageWidth: number,
  imageHeight: number
) {
  if (!decoderSession || !currentEmbedding) {
    post({ type: 'error', error: 'Decoder not loaded or no embedding available' });
    return;
  }

  try {
    const { point_coords, point_labels } = buildPointTensors(points);

    // Build decoder feeds
    const feeds: Record<string, ort.Tensor> = {
      image_embeddings: currentEmbedding,
      point_coords,
      point_labels,
    };

    // Add high-res features if available
    if (currentHighResFeatures0) feeds['high_res_feats_0'] = currentHighResFeatures0;
    if (currentHighResFeatures1) feeds['high_res_feats_1'] = currentHighResFeatures1;

    // Add mask input (empty for first prediction)
    const maskInputSize = 256; // SAM2 decoder expects 256x256 mask input
    feeds['mask_input'] = new ort.Tensor(
      'float32',
      new Float32Array(maskInputSize * maskInputSize),
      [1, 1, maskInputSize, maskInputSize]
    );
    feeds['has_mask_input'] = new ort.Tensor('float32', new Float32Array([0]), [1]);

    // Original image size for proper mask scaling
    feeds['orig_im_size'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(imageHeight), BigInt(imageWidth)]), [2]);

    const results = await decoderSession.run(feeds);

    // Extract mask — output is typically 'masks' [1, N, H, W] and 'scores' [1, N]
    const masksOutput = results['masks'] ?? results[Object.keys(results)[0]];
    const scoresOutput = results['iou_predictions'] ?? results['scores'] ?? null;

    if (!masksOutput) {
      post({ type: 'error', error: 'No mask output from decoder' });
      return;
    }

    // Get best mask (highest score)
    const maskDims = masksOutput.dims;
    const numMasks = maskDims[1] as number;
    const maskH = maskDims[2] as number;
    const maskW = maskDims[3] as number;

    let bestIdx = 0;
    const scores: number[] = [];
    if (scoresOutput) {
      const scoreData = scoresOutput.data as Float32Array;
      let bestScore = -Infinity;
      for (let i = 0; i < numMasks; i++) {
        scores.push(scoreData[i]);
        if (scoreData[i] > bestScore) {
          bestScore = scoreData[i];
          bestIdx = i;
        }
      }
    }

    // Extract the best mask and threshold to binary
    const rawMaskData = masksOutput.data as Float32Array;
    const maskOffset = bestIdx * maskH * maskW;

    // Resize mask to original image size
    const maskData = resizeMask(rawMaskData, maskOffset, maskW, maskH, imageWidth, imageHeight);

    post(
      {
        type: 'mask-result',
        maskData,
        width: imageWidth,
        height: imageHeight,
        scores,
      },
      [maskData.buffer]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    post({ type: 'error', error: `Decode failed: ${msg}` });
  }
}

/** Resize float mask to target size and threshold to binary Uint8Array */
function resizeMask(
  data: Float32Array,
  offset: number,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const result = new Uint8Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(Math.floor(y * scaleY), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), srcW - 1);
      const val = data[offset + srcY * srcW + srcX];
      result[y * dstW + x] = val > 0 ? 255 : 0; // threshold at 0 (logits)
    }
  }

  return result;
}

// --- Video Propagation ---

async function propagateFrame(imageData: ImageData, frameIndex: number) {
  if (!encoderSession || !decoderSession) {
    post({ type: 'error', error: 'Model not loaded for propagation' });
    return;
  }

  try {
    // Encode the new frame
    const inputTensor = preprocessImage(imageData);
    const encoderResults = await encoderSession.run({ image: inputTensor });

    const embedding = encoderResults['image_embeddings'] ?? encoderResults[Object.keys(encoderResults)[0]];
    const highRes0 = encoderResults['high_res_feats_0'] ?? null;
    const highRes1 = encoderResults['high_res_feats_1'] ?? null;

    // Use previous mask as prompt (memory-based propagation)
    const feeds: Record<string, ort.Tensor> = {
      image_embeddings: embedding,
      // Use empty point prompts for propagation (mask-guided)
      point_coords: new ort.Tensor('float32', new Float32Array([ENCODER_INPUT_SIZE / 2, ENCODER_INPUT_SIZE / 2]), [1, 1, 2]),
      point_labels: new ort.Tensor('float32', new Float32Array([-1]), [1, 1]), // -1 = padding
    };

    if (highRes0) feeds['high_res_feats_0'] = highRes0;
    if (highRes1) feeds['high_res_feats_1'] = highRes1;

    // Add memory if available
    if (memoryBank) feeds['memory_bank'] = memoryBank;
    if (memoryPositions) feeds['memory_pos'] = memoryPositions;

    // Empty mask input for propagation (memory carries the mask info)
    const maskInputSize = 256;
    feeds['mask_input'] = new ort.Tensor(
      'float32',
      new Float32Array(maskInputSize * maskInputSize),
      [1, 1, maskInputSize, maskInputSize]
    );
    feeds['has_mask_input'] = new ort.Tensor('float32', new Float32Array([0]), [1]);
    feeds['orig_im_size'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(imageData.height), BigInt(imageData.width)]), [2]);

    const results = await decoderSession.run(feeds);

    // Update memory bank from decoder output
    if (results['memory_bank']) memoryBank = results['memory_bank'];
    if (results['memory_pos']) memoryPositions = results['memory_pos'];

    // Extract mask
    const masksOutput = results['masks'] ?? results[Object.keys(results)[0]];
    if (!masksOutput) {
      post({ type: 'error', error: 'No mask output during propagation' });
      return;
    }

    const maskDims = masksOutput.dims;
    const maskH = maskDims[2] as number;
    const maskW = maskDims[3] as number;

    const rawMaskData = masksOutput.data as Float32Array;
    const maskData = resizeMask(rawMaskData, 0, maskW, maskH, imageData.width, imageData.height);

    // Update current embedding for next propagation step
    currentEmbedding = embedding;
    currentHighResFeatures0 = highRes0;
    currentHighResFeatures1 = highRes1;

    post(
      {
        type: 'propagation-mask',
        frameIndex,
        maskData,
        width: imageData.width,
        height: imageData.height,
      },
      [maskData.buffer]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    post({ type: 'error', error: `Propagation failed at frame ${frameIndex}: ${msg}` });
  }
}

function resetMemory() {
  memoryBank = null;
  memoryPositions = null;
  currentEmbedding = null;
  currentHighResFeatures0 = null;
  currentHighResFeatures1 = null;
}

// --- Message Handler ---

self.onmessage = async (event: MessageEvent<SAM2WorkerRequest>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'load-model':
      await loadModel(msg.encoderBuffer, msg.decoderBuffer);
      break;

    case 'encode-frame':
      await encodeFrame(msg.imageData, msg.frameIndex);
      break;

    case 'decode-prompt':
      await decodePrompt(msg.points, msg.boxes, msg.imageWidth, msg.imageHeight);
      break;

    case 'propagate-frame':
      await propagateFrame(msg.imageData, msg.frameIndex);
      break;

    case 'reset-memory':
      resetMemory();
      break;

    default:
      post({ type: 'error', error: `Unknown message type: ${(msg as any).type}` });
  }
};
