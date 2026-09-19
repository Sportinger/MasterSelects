import type { PlanarTrackingProjectionDescriptor } from '../../types/terrainAttachment';
import { inverseMatrix, quadMatrix } from '../../services/planarTracking/surfaceGeometry';
import shader from './planarTrackingProjection.wgsl?raw';

/** Composites native layer content through an exact projective tracked quad. */
export class PlanarTrackingProjectionPipeline {
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniforms = new Map<string, GPUBuffer>();

  constructor(device: GPUDevice) {
    this.device = device;
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ] });
    const module = device.createShaderModule({ label: 'Planar tracking projection', code: shader });
    this.pipeline = device.createRenderPipeline({
      label: 'Planar tracking projection',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'planarProjectionVertex' },
      fragment: {
        module,
        entryPoint: 'planarProjectionFragment',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    descriptor: PlanarTrackingProjectionDescriptor,
    sampler: GPUSampler,
    content: GPUTextureView,
    background: GPUTextureView,
    output: GPUTextureView,
    width: number,
    height: number,
    opacity: number,
    resourceKey: string,
  ): boolean {
    if (!descriptor.quad || !(opacity > 0)) return false;
    const inverse = inverseMatrix(quadMatrix(descriptor.quad));
    if (!inverse) return false;
    let uniform = this.uniforms.get(resourceKey);
    if (!uniform) {
      uniform = this.device.createBuffer({
        label: `Planar tracking projection ${resourceKey}`,
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniforms.set(resourceKey, uniform);
    }
    const data = new Float32Array(16);
    data.set(inverse.slice(0, 3), 0);
    data.set(inverse.slice(3, 6), 4);
    data.set(inverse.slice(6, 9), 8);
    data.set([width, height, Math.min(1, opacity), 0], 12);
    this.device.queue.writeBuffer(uniform, 0, data);
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: background },
        { binding: 3, resource: content },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return true;
  }

  destroy(): void {
    for (const uniform of this.uniforms.values()) uniform.destroy();
    this.uniforms.clear();
  }
}
