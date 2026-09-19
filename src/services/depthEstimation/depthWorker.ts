import { AutoModelForDepthEstimation, Tensor, env } from '@huggingface/transformers';
import { DEPTH_MODEL, DEPTH_MODEL_URL } from './depthModel';
import { depthInputSize } from './depthMath';

let session: Awaited<ReturnType<typeof AutoModelForDepthEstimation.from_pretrained>> | undefined;
let backend = '', modelBytes: ArrayBuffer | undefined;
// Use the existing Transformers.js runtime, isolated from other model workers.
// Only the hash-verified buffer supplied by the main thread may satisfy a model request.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = {
  match: async (url: string) => url === DEPTH_MODEL_URL && modelBytes ? new Response(modelBytes)
    : url === DEPTH_MODEL_URL.replace('onnx/model.onnx', 'config.json') ? new Response('{"model_type":"depth_anything"}') : undefined,
  put: async () => {},
};
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
async function load(device: 'webgpu' | 'wasm') {
  session = await AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL.id, {
    revision: DEPTH_MODEL.revision, device, dtype: 'fp32',
  });
  backend = device === 'webgpu' ? 'WebGPU' : 'CPU / WASM';
}
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      modelBytes = data.model;
      try { if (!navigator.gpu) throw new Error('WebGPU unavailable'); await load('webgpu'); }
      catch { await load('wasm'); }
      self.postMessage({ id, backend }); return;
    }
    if (!session) throw new Error('Load the depth model first.');
    const start = performance.now(), { width, height } = depthInputSize(data.width, data.height, data.edge);
    const source = new OffscreenCanvas(data.width, data.height), sourceContext = source.getContext('2d')!;
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
    const resized = new OffscreenCanvas(width, height), context = resized.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(source, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const tensorData = new Float32Array(width * height * 3), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let i = 0; i < width * height; i++) tensorData[c * width * height + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
    const input = new Tensor('float32', tensorData, [1, 3, height, width]);
    let outputs: Record<string, Tensor> | undefined;
    try {
      try { outputs = await session({ pixel_values: input }); }
      catch (error) {
        if (backend !== 'WebGPU') throw error;
        await session.dispose(); await load('wasm');
        outputs = await session!({ pixel_values: input });
      }
      const depth = outputs!.predicted_depth, dims = depth.dims;
      const values = new Float32Array(depth.data as Float32Array);
      self.postMessage({ id, backend, width: dims[dims.length - 1], height: dims[dims.length - 2], values,
        milliseconds: performance.now() - start }, { transfer: [values.buffer] });
    } finally { input.dispose(); if (outputs) for (const value of Object.values(outputs)) value.dispose(); }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
