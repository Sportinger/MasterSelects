import shader from './curveWake.wgsl?raw';
import type { SceneCamera } from '../../scene/types';
import type { PreparedStrandLayer } from '../passes/StrandPass';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import { Logger } from '../../../services/logger';

const log = Logger.create('CurveParticleWake');

/** Small shared-depth sprites using the already evaluated curve buffers. No readback/re-simulation. */
export class CurveWakePass {
  private device?: GPUDevice;
  private layout?: GPUBindGroupLayout;
  private pipeline?: GPURenderPipeline;
  private readonly warned = new Set<string>();

  render(device: GPUDevice, encoder: GPUCommandEncoder, color: GPUTextureView, depth: GPUTextureView,
    plans: PreparedStrandLayer[], camera: SceneCamera, temporary: GPUBuffer[]): void {
    const active = plans.filter(({ layer }) => (layer.strands.program.render?.wake?.opacity ?? 0) * layer.opacity > 0
      && (layer.strands.program.render?.wake?.pulseRate ?? 0) > 0);
    if (!active.length) return;
    this.ensure(device);
    const buffer = (data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags) => {
      const result = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(result, 0, data as Float32Array<ArrayBuffer>);
      temporary.push(result); return result;
    };
    for (const { layer, buffers } of active) {
      const spec = layer.strands.program.render!.wake!, curves = buffers.curves;
      if (!curves?.starts.length) {
        if (!this.warned.has(layer.layerId)) {
          this.warned.add(layer.layerId); log.warn('Curve Particle Wake needs nonempty source curves.', { layerId: layer.layerId });
        }
        continue;
      }
      const ranges = new Uint32Array(curves.starts.length * 2);
      curves.starts.forEach((start, i) => ranges.set([start, curves.counts[i]], i * 2));
      const values = new Float32Array(64);
      values.set(multiplyMat4(camera.projectionMatrix, camera.viewMatrix), 0);
      values.set(layer.worldMatrix, 16);
      const view = camera.viewMatrix;
      values.set([view[0], view[4], view[8], spec.size], 32);
      values.set([view[1], view[5], view[9], spec.opacity * layer.opacity], 36);
      const rgb = parseInt(spec.color.slice(1), 16);
      values.set([(rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255, spec.seed], 40);
      values.set([spec.pulsePhase, spec.pulseRate, spec.lifetime, curves.starts.length], 44);
      values.set([spec.speed, spec.drag, spec.curl, spec.curlRate], 48);
      values.set([spec.waveFront, spec.waveLag, spec.waveScale, spec.surfaceRadius], 52);
      const group = device.createBindGroup({ layout: this.layout!, entries: [
        { binding: 0, resource: { buffer: buffer(values, GPUBufferUsage.UNIFORM) } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffer(ranges, GPUBufferUsage.STORAGE) } },
      ] });
      const pass = encoder.beginRenderPass({ label: 'curve-particle-wake',
        colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' } });
      pass.setPipeline(this.pipeline!); pass.setBindGroup(0, group); pass.draw(6, spec.count); pass.end();
    }
  }

  private ensure(device: GPUDevice): void {
    if (this.device === device) return;
    const module = device.createShaderModule({ label: 'curve-particle-wake', code: shader });
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ] });
    this.pipeline = device.createRenderPipeline({ label: 'curve-particle-wake',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{
        format: SCENE_COLOR_FORMAT, blend: {
          color: { srcFactor: 'one', dstFactor: 'one' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }] }, primitive: { topology: 'triangle-list' },
      depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
    this.device = device;
  }

  dispose(): void { this.device = undefined; this.layout = undefined; this.pipeline = undefined; this.warned.clear(); }
}
