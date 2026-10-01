import shader from '../shaders/StrandCoverage.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';

/**
 * A private four-sample color/depth target for strands, seeded from the shared
 * scene depth and resolved back without changing the rest of Native3D to MSAA.
 * GPU handles belong to this render-thread owner, never to the geometry graph.
 */
export class StrandCoverageTargets {
  private device: GPUDevice | null = null;
  private color: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private seedLayout: GPUBindGroupLayout | null = null;
  private resolveLayout: GPUBindGroupLayout | null = null;
  private seedPipeline: GPURenderPipeline | null = null;
  private resolvePipeline: GPURenderPipeline | null = null;

  private initialize(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose();
    this.device = device;
    const module = device.createShaderModule({ label: 'strand-coverage-resolve', code: shader });
    this.seedLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ] });
    this.resolveLayout = device.createBindGroupLayout({ entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', multisampled: true } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
    ] });
    const vertex = { module, entryPoint: 'fullscreenVertex' };
    this.seedPipeline = device.createRenderPipeline({ label: 'strand-coverage-seed-depth',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.seedLayout] }), vertex,
      fragment: { module, entryPoint: 'seedDepth', targets: [] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
      multisample: { count: 4 },
    });
    this.resolvePipeline = device.createRenderPipeline({ label: 'strand-coverage-resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.resolveLayout] }), vertex,
      fragment: { module, entryPoint: 'resolveStrands', targets: [{ format: SCENE_COLOR_FORMAT,
        blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });
  }

  render(device: GPUDevice, encoder: GPUCommandEncoder, sceneColor: GPUTextureView, sceneDepth: GPUTextureView,
    width: number, height: number, draw: (pass: GPURenderPassEncoder) => void): void {
    this.initialize(device);
    if (this.color?.width !== width || this.color.height !== height) {
      this.color?.destroy();
      this.depth?.destroy();
      const descriptor = { size: { width, height }, sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING };
      this.color = device.createTexture({ ...descriptor, format: SCENE_COLOR_FORMAT, label: 'strand-coverage-color' });
      this.depth = device.createTexture({ ...descriptor, format: SCENE_DEPTH_FORMAT, label: 'strand-coverage-depth' });
    }
    const color = this.color!.createView(), depth = this.depth!.createView();
    const seed = encoder.beginRenderPass({ label: 'strand-coverage-seed-depth', colorAttachments: [],
      depthStencilAttachment: { view: depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    seed.setPipeline(this.seedPipeline!);
    seed.setBindGroup(0, device.createBindGroup({ layout: this.seedLayout!, entries: [
      { binding: 0, resource: sceneDepth },
    ] }));
    seed.draw(3);
    seed.end();

    const strands = encoder.beginRenderPass({ label: 'strand-coverage-draw',
      colorAttachments: [{ view: color, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' } });
    draw(strands);
    strands.end();

    const resolve = encoder.beginRenderPass({ label: 'strand-coverage-resolve',
      colorAttachments: [{ view: sceneColor, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepth, depthLoadOp: 'load', depthStoreOp: 'store' } });
    resolve.setPipeline(this.resolvePipeline!);
    resolve.setBindGroup(0, device.createBindGroup({ layout: this.resolveLayout!, entries: [
      { binding: 1, resource: color }, { binding: 2, resource: depth },
    ] }));
    resolve.draw(3);
    resolve.end();
  }

  dispose(): void {
    this.color?.destroy();
    this.depth?.destroy();
    this.color = this.depth = null;
    this.seedPipeline = this.resolvePipeline = null;
    this.seedLayout = this.resolveLayout = null;
    this.device = null;
  }
}
