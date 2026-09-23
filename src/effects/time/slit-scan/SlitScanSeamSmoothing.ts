import type { TemporalSampleMetadata } from '../TemporalSampleMetadata';
import { geometrySampleTimes } from './geometrySampleTimes';
import { SEAM_SMOOTHING_WGSL } from './seamSmoothingShader';

/** Resolved source time, not an FPS guess or a color-edge detector. */
export function seamSampleData(samples: TemporalSampleMetadata, now: number) {
  const values = geometrySampleTimes(samples, now);
  let step = Infinity;
  for (let i = 4; i < values.length; i += 4) {
    const delta = Math.abs(values[i + 1] - values[i - 3]);
    if (delta > 1e-6) step = Math.min(step, delta);
  }
  return { values, step: Number.isFinite(step) ? step : 1 };
}

/** Optional bounded post-filter. Zero radius adds no GPU work. Large image
 * contrasts/alpha edges remain protected; this cannot infer hidden contours. */
export class SlitScanSeamSmoothing {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private texture?: GPUTexture;
  private samples?: GPUBuffer;
  private uniform: GPUBuffer;
  constructor(device: GPUDevice) {
    this.device = device;
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ] });
    const module = device.createShaderModule({ label: 'slit-scan-seam-smoothing', code: SEAM_SMOOTHING_WGSL });
    this.pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] } });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  encode(encoder: GPUCommandEncoder, image: GPUTextureView, query: GPUTextureView, width: number, height: number,
    sampling: TemporalSampleMetadata, now: number, radius: number, protection: number, mix: number): GPUTextureView {
    const { values, step } = seamSampleData(sampling, now);
    if (!this.samples || this.samples.size < values.byteLength) {
      if (this.samples) this.retire(this.samples);
      this.samples = this.device.createBuffer({ size: Math.max(16, values.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    }
    if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
      if (this.texture) this.retire(this.texture);
      this.texture = this.device.createTexture({ label: 'slit-scan-smoothed-color', size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    }
    this.device.queue.writeBuffer(this.samples, 0, values);
    this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([width, height, radius, protection,
      sampling.samples.length, Number(sampling.interpolation === 'nearest'), step, mix]));
    const view = this.texture.createView();
    const pass = encoder.beginRenderPass({ label: 'slit-scan-seam-smoothing', colorAttachments: [
      { view, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] },
    ] });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: image }, { binding: 1, resource: query }, { binding: 2, resource: this.sampler },
      { binding: 3, resource: { buffer: this.uniform } }, { binding: 5, resource: { buffer: this.samples } },
    ] }));
    pass.draw(3); pass.end(); return view;
  }
  destroy(): void {
    this.retire(this.uniform); if (this.samples) this.retire(this.samples); if (this.texture) this.retire(this.texture);
    this.samples = undefined; this.texture = undefined;
  }
  private retire(resource: GPUBuffer | GPUTexture): void {
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).then(() => resource.destroy(), () => resource.destroy());
  }
}
