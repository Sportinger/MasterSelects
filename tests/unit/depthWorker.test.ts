import { expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ load: vi.fn(), tensors: [] as any[] }));
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  AutoModelForDepthEstimation: { from_pretrained: mocked.load },
  Tensor: class { dispose = vi.fn(); constructor(public type: string, public data: Float32Array, public dims: number[]) { mocked.tensors.push(this); } },
}));
it('releases a failed GPU session, retries on CPU, and labels the actual backend', async () => {
  const output = { dims: [1, 2, 2], data: new Float32Array([0, 1, 2, 3]), dispose: vi.fn() };
  const gpu = Object.assign(vi.fn().mockRejectedValue(new Error('GPU device lost')), { dispose: vi.fn().mockResolvedValue(undefined) });
  const cpu = Object.assign(vi.fn().mockResolvedValue({ predicted_depth: output }), { dispose: vi.fn() });
  mocked.load.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
  const worker = { postMessage: vi.fn(), onmessage: null as any };
  vi.stubGlobal('self', worker); vi.stubGlobal('navigator', { gpu: {} });
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { putImageData() {}, drawImage() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }; } });
  await import('../../src/services/depthEstimation/depthWorker');
  await worker.onmessage({ data: { id: 1, type: 'load', model: new ArrayBuffer(8) } });
  await worker.onmessage({ data: { id: 2, type: 'infer', width: 2, height: 2, edge: 280, pixels: new Uint8ClampedArray(16).buffer } });
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(mocked.load.mock.calls.map(call => call[1].device)).toEqual(['webgpu', 'wasm']);
  expect(worker.postMessage.mock.calls.at(-1)![0]).toMatchObject({ id: 2, backend: 'CPU / WASM', width: 2, height: 2, values: output.data });
  expect(output.dispose).toHaveBeenCalledOnce(); expect(mocked.tensors[0].dispose).toHaveBeenCalledOnce();
});
