import { HybridTemporalRuntime } from '../../src/effects/time/HybridTemporalRuntime';
import { sourceFrameService } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameService';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { getDefaultParams } from '../../src/effects';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';

/** Real GPU runtime integration with deterministic borrowed VideoFrames, no media fixture. */
export async function probeHybridRuntime(device: GPUDevice) {
  const acquire = sourceFrameService.acquire;
  const canvas = new OffscreenCanvas(32, 32), ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#40c020'; ctx.fillRect(0, 0, 32, 32);
  let uploads = 0;
  sourceFrameService.acquire = (() => ({ ready: Promise.resolve({ frames: Array.from({ length: 121 }, (_, i) => ({ time: i / 30, duration: 1 / 30 })) }),
    cancel() {}, release() {}, async request(job: any) { for (const time of job.times) {
      const source = new VideoFrame(canvas, { timestamp: time * 1e6 });
      try { job.onFrame({ frame: source, time, duration: 1 / 30, width: 32, height: 32, rotation: 0 }); uploads++; } finally { source.close(); }
    } } })) as any;
  const wrapped = new Proxy(device, { get(target, key) {
    if (key === 'limits') return { maxTextureArrayLayers: 7, maxTextureDimension2D: target.limits.maxTextureDimension2D, maxSampledTexturesPerShaderStage: 16 };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const runtime = new HybridTemporalRuntime(wrapped);
  const input = device.createTexture({ size: [32, 32], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture: input }, [32, 32]);
  const output = device.createTexture({ size: [32, 32], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const graph = createDefaultSlitScanGraph(), effect = { type: 'slit-scan', params: { ...getDefaultParams('slit-scan'), delay: 4, temporalStorage: 'hybrid' } };
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const render = new ImageGraphPassRuntime(device);
  const resources = new Map();
  const empty = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  for (const id of ['slit-scan:time-map', 'slit-scan:protection']) resources.set(id, { view: empty.createView(), identity: 'empty' });
  try {
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      const done = collectTemporalPreparations(), encoder = device.createCommandEncoder();
      result = runtime.resolve({ key: 'probe', effectId: 'probe', media: { id: 'probe', url: 'probe', width: 32, height: 32 } as any,
        source: { mediaId: 'probe', localTime: 4, duration: 4, inPoint: 0, outPoint: 4, speed: 1, speedKeyframes: [] },
        horizon: 4, samples: 1080, nearest: false, encoder, currentInput: { view: input.createView(), width: 32, height: 32 } },
      { graph, effect, sampler, timelineTime: 4, externalResources: resources });
      const pending = done(); device.queue.submit([encoder.finish()]); await Promise.all(pending);
      if (!pending.length) break;
    }
    if (!result || uploads < 7) throw Error(`Incomplete streamed runtime: ${uploads} uploads`);
    resources.set('input-history:atlas', result.atlas); resources.set('input-history:ages', result.ages);
    const plan = prepareImageEffect({ ...effect, operatorGraph: graph }).plan!;
    const encoder = device.createCommandEncoder();
    render.encode({ encoder, sampler, source: { kind: 'texture', view: result.current.view }, width: 32, height: 32,
      timelineTimeSeconds: 4, plan, externalResources: resources, instanceId: 'probe-output', outputView: output.createView() });
    const buffer = device.createBuffer({ size: 256 * 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [32, 32]);
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange()), pixel = Array.from(bytes.slice(16 * 256 + 16 * 4, 16 * 256 + 16 * 4 + 4));
    buffer.unmap(); buffer.destroy();
    if (pixel[1] < 100 || pixel[3] !== 255) throw Error(`Black/invalid runtime output: ${pixel}`);
    return `PASS full runtime, direct VideoFrame upload, seven-slot streaming, ${uploads} source frames, pixel ${pixel}`;
  } finally { sourceFrameService.acquire = acquire; runtime.destroy(); render.dispose(); input.destroy(); output.destroy(); empty.destroy(); }
}
