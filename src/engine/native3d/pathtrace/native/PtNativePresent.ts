import shader from './PtNativePresent.wgsl?raw';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../sceneRenderer/constants';

/** Presents linear native pixels through the same HDR scene target and tone map as WebGPU. */
export class PtNativePresent {
  private pipeline: GPURenderPipeline;
  private uniform: GPUBuffer;
  private color: GPUBuffer | null = null;
  private depth: GPUBuffer | null = null;
  private width = 0;
  private height = 0;
  private readonly device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ code: shader, label: 'pt-native-present' });
    this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: SCENE_COLOR_FORMAT }] },
      primitive: { topology: 'triangle-list' }, depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' } });
    this.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }
  upload(color: Float32Array, depth: Float32Array, width: number, height: number) {
    if (this.width !== width || this.height !== height) {
      this.color?.destroy(); this.depth?.destroy(); this.width = width; this.height = height;
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      this.color = this.device.createBuffer({ size: color.byteLength, usage });
      this.depth = this.device.createBuffer({ size: depth.byteLength, usage });
    }
    this.device.queue.writeBuffer(this.color!, 0, color as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(this.depth!, 0, depth as Float32Array<ArrayBuffer>);
  }
  draw(encoder: GPUCommandEncoder, view: GPUTextureView, depthView: GPUTextureView, width: number, height: number) {
    if (!this.color || !this.depth) return false;
    this.device.queue.writeBuffer(this.uniform, 0, Float32Array.of(this.width, this.height, width, height));
    const pass = encoder.beginRenderPass({ label: 'pt-native-preview',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries:
      [this.uniform, this.color, this.depth].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
    pass.draw(3); pass.end(); return true;
  }
  dispose() { this.uniform.destroy(); this.color?.destroy(); this.depth?.destroy(); }
}
