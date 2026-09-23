import shader from '../shaders/SlitScanSurface.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';

export interface SlitScanSurfaceDraw {
  mvp: Float32Array;
  reference: Float32Array;
  inverseReference: Float32Array;
  color: GPUTextureView;
  geometry: GPUTextureView;
  columns: number;
  rows: number;
  timeDepth: number;
  opacity: number;
  band?: GPUTextureView;
}

/** Native scene mesh with no CPU per-frame geometry readback or extra decoder. */
export class SlitScanSurfacePass {
  private device?: GPUDevice;
  private pipeline?: GPURenderPipeline;
  private sampler?: GPUSampler;

  render(device: GPUDevice, encoder: GPUCommandEncoder, color: GPUTextureView,
    depth: GPUTextureView, draws: readonly SlitScanSurfaceDraw[], temporaryBuffers: GPUBuffer[]): void {
    if (!draws.length) return;
    this.initialize(device);
    const pass = encoder.beginRenderPass({ label: 'slit-scan-reference-surface',
      colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    pass.setPipeline(this.pipeline!);
    for (const draw of draws) {
      const columns = Math.max(1, Math.min(512, Math.round(draw.columns)));
      const rows = Math.max(1, Math.min(288, Math.round(draw.rows)));
      const data = new Float32Array(56);
      data.set(draw.mvp, 0); data.set(draw.reference, 16); data.set(draw.inverseReference, 32);
      data.set([columns, rows, draw.timeDepth, draw.opacity], 48);
      data[52] = Number(!!draw.band);
      const buffer = device.createBuffer({ label: 'slit-scan-surface-uniform', size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      temporaryBuffers.push(buffer);
      device.queue.writeBuffer(buffer, 0, data);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.pipeline!.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer } }, { binding: 1, resource: draw.color },
        { binding: 2, resource: draw.geometry }, { binding: 3, resource: this.sampler! },
        { binding: 4, resource: draw.band ?? draw.geometry },
      ] }));
      pass.draw(columns * rows * 6);
    }
    pass.end();
  }

  dispose(): void { this.device = undefined; this.pipeline = undefined; this.sampler = undefined; }

  private initialize(device: GPUDevice): void {
    if (this.device === device && this.pipeline) return;
    this.dispose(); this.device = device;
    const module = device.createShaderModule({ label: 'slit-scan-reference-surface', code: shader });
    const bindings = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
    ] });
    this.pipeline = device.createRenderPipeline({ label: 'slit-scan-reference-surface',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: SCENE_COLOR_FORMAT,
        blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  }
}
