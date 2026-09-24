import * as ort from 'onnxruntime-web';
import constants from './sam21Constants.json';
import { loadRotoModels, type RotoModelPart } from './rotoModel';
import { assembleRotoMemory, channelsToTokens, rotoPointerDiffs, type RotoMemoryFrame } from './rotoMemory';
import type { RotoPoint, RotoReply, RotoRequest } from './rotoTypes';

let sessions: Record<RotoModelPart, ort.InferenceSession> | undefined;
let seed: RotoMemoryFrame | undefined, recent: RotoMemoryFrame[] = [], index = 0, totalFrames = 1;
const send = (reply: RotoReply) => self.postMessage(reply, reply.mask ? [reply.mask.buffer] : []);
const float = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);
const values = (tensor: ort.Tensor) => tensor.data as Float32Array;
function release(tensors: Record<string, ort.Tensor>) { for (const tensor of new Set(Object.values(tensors))) tensor.dispose(); }

async function load(id: number) {
  if (sessions) return;
  if (!navigator.gpu || !await navigator.gpu.requestAdapter()) throw new Error('SAM 2.1 video tracking requires WebGPU. Enable hardware acceleration in a supported browser.');
  ort.env.wasm.numThreads = 1;
  const wasmUrl = '__SAM2_ORT_WASM_GZIP_URL__';
  if (!wasmUrl.startsWith('__')) {
    const response = await fetch(wasmUrl);
    if (!response.ok || !response.body) throw new Error('Could not load the segmentation runtime.');
    ort.env.wasm.wasmBinary = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const buffers = await loadRotoModels((progress, message) => send({ id, progress, message }));
  const created = {} as Record<RotoModelPart, ort.InferenceSession>;
  try {
    for (const name of Object.keys(buffers) as RotoModelPart[]) {
      send({ id, progress: 1, message: `Preparing SAM 2.1 ${name}` });
      created[name] = await ort.InferenceSession.create(buffers[name], { executionProviders: name === 'pointer_tpos' ? ['wasm'] : ['webgpu'], graphOptimizationLevel: 'all' });
      delete (buffers as Partial<typeof buffers>)[name];
    }
    sessions = created;
  } catch (error) { await Promise.all(Object.values(created).map(session => session.release())); throw error; }
}

function preprocess(image: ImageData) {
  const canvas = new OffscreenCanvas(1024, 1024), original = new OffscreenCanvas(image.width, image.height);
  original.getContext('2d')!.putImageData(image, 0, 0);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(original, 0, 0, 1024, 1024);
  const pixels = ctx.getImageData(0, 0, 1024, 1024).data, size = 1024 * 1024;
  const output = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) for (let c = 0; c < 3; c++) output[c * size + i] = (pixels[4 * i + c] / 255 - constants.image_mean[c]) / constants.image_std[c];
  return float(output, [1, 3, 1024, 1024]);
}

/** Interpolate the segmentation boundary before thresholding; logits are not physical alpha. */
function maskPixels(mask: ort.Tensor, width: number, height: number) {
  const data = values(mask), sw = Number(mask.dims.at(-1)), sh = Number(mask.dims.at(-2));
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = Math.max(0, Math.min(sw - 1, (x + .5) * sw / width - .5));
    const v = Math.max(0, Math.min(sh - 1, (y + .5) * sh / height - .5));
    const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const a = data[y0 * sw + x0] * (1 - u + x0) + data[y0 * sw + x1] * (u - x0);
    const b = data[y1 * sw + x0] * (1 - u + x0) + data[y1 * sw + x1] * (u - x0);
    output[y * width + x] = a * (1 - v + y0) + b * (v - y0) > 0 ? 255 : 0;
  }
  return output;
}

async function infer(pixels: ImageData, points?: RotoPoint[]) {
  if (!sessions) throw new Error('Load SAM 2.1 first.');
  if (!points && !seed) throw new Error('Select the object on a reference frame first.');
  const owned: Record<string, ort.Tensor> = {};
  const keep = (prefix: string, result: Record<string, ort.Tensor>) => {
    for (const [key, value] of Object.entries(result)) owned[prefix + key] = value;
    return result;
  };
  try {
    owned.input = preprocess(pixels);
    const image = keep('image/', await sessions.vision_encoder.run({ pixel_values: owned.input }));
    let conditioned = image.feats2_no_mem;
    if (!points) {
      owned.diffs = float(rotoPointerDiffs(seed!, recent, index, totalFrames), [16]);
      const pointer = keep('pointer/', await sessions.pointer_tpos.run({ normalized_diffs: owned.diffs }));
      const bank = assembleRotoMemory(seed!, recent, index, constants.memory_temporal_positional_encoding, values(pointer.pointer_pos));
      owned.memory = float(bank.memory, [28736, 1, 64]); owned.positions = float(bank.positions, [28736, 1, 64]);
      owned.current = float(channelsToTokens(values(image.feats2), 256, 4096), [4096, 1, 256]);
      owned.currentPos = float(channelsToTokens(values(image.vision_pos_embed), 256, 4096), [4096, 1, 256]);
      const attended = keep('attention/', await sessions.memory_attention.run({ current_vision_features: owned.current,
        current_vision_position_embeddings: owned.currentPos, memory: owned.memory, memory_pos: owned.positions }));
      conditioned = attended.conditioned_feats;
    }
    const prompts = points?.length ? points : [{ x: 0, y: 0, label: -1 }];
    owned.coords = float(Float32Array.from(prompts.flatMap(p => [p.x * 1024, p.y * 1024])), [1, 1, prompts.length, 2]);
    owned.labels = new ort.Tensor('int32', Int32Array.from(prompts, p => p.label), [1, 1, prompts.length]);
    const decoded = keep('mask/', await sessions.mask_decoder.run({ feats0: image.feats0, feats1: image.feats1,
      feats2_cond: conditioned, input_points: owned.coords, input_labels: owned.labels }));
    owned.score = float(values(decoded.object_score_logits), [1, 1]);
    owned.binarize = float(Float32Array.of(points ? 1 : 0), []);
    const memory = keep('memory/', await sessions.memory_encoder.run({ feats2: image.feats2,
      high_res_mask: decoded.high_res_mask, object_score_logits: owned.score, binarize: owned.binarize }));
    const frame: RotoMemoryFrame = { index, tokens: values(memory.memory_tokens).slice(),
      positions: values(memory.memory_pos).slice(), pointer: values(decoded.object_pointer).slice() };
    if (points) { seed = frame; recent = []; } else { recent.push(frame); recent = recent.slice(-15); }
    index++;
    return maskPixels(decoded.high_res_mask, pixels.width, pixels.height);
  } finally { release(owned); }
}

let busy = false;
self.onmessage = async ({ data }: MessageEvent<RotoRequest & { id: number }>) => {
  const { id } = data;
  if (busy) { send({ id, error: 'SAM 2.1 is busy.' }); return; }
  busy = true;
  try {
    if (data.type === 'load') { await load(id); send({ id }); }
    else {
      if (data.type === 'seed') {
        if (!data.points.some(p => p.label === 1) || data.points.some(p => !Number.isFinite(p.x + p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Add a foreground point inside the object.');
        index = 0; totalFrames = data.totalFrames; seed = undefined; recent = [];
      }
      const mask = await infer(data.pixels, data.type === 'seed' ? data.points : undefined);
      send({ id, mask, width: data.pixels.width, height: data.pixels.height });
    }
  } catch (error) { send({ id, error: error instanceof Error ? error.message : String(error) }); }
  finally { busy = false; }
};
