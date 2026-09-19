import compareShader from './splitCompare.wgsl?raw';
import type { SplitCompareSettings } from '../stores/splitCompareStore';

export interface SplitCompareInput {
  commandEncoder: GPUCommandEncoder;
  sampler: GPUSampler;
  untreatedView: GPUTextureView;
  effectedView: GPUTextureView;
  outputView: GPUTextureView;
  settings: SplitCompareSettings;
}

export class SplitComparePipeline {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly uniforms: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ label: 'effect-split-compare', code: compareShader });
    this.layout = device.createBindGroupLayout({
      label: 'effect-split-compare-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipeline = device.createRenderPipeline({
      label: 'effect-split-compare-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'compareVertex' },
      fragment: { module, entryPoint: 'compareFragment', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniforms = device.createBuffer({
      label: 'effect-split-compare-uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  encode(input: SplitCompareInput): void {
    this.device.queue.writeBuffer(
      this.uniforms,
      0,
      new Float32Array([input.settings.position, input.settings.feather, 0, 0]),
    );
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: input.sampler },
        { binding: 1, resource: input.untreatedView },
        { binding: 2, resource: input.effectedView },
        { binding: 3, resource: { buffer: this.uniforms } },
      ],
    });
    const pass = input.commandEncoder.beginRenderPass({
      colorAttachments: [{ view: input.outputView, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  destroy(): void {
    this.uniforms.destroy();
  }
}
