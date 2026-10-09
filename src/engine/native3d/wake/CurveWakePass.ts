import shader from './curveWake.wgsl?raw';
import common from './curveWakeCommon.wgsl?raw';
import stepShader from './curveWakeStep.wgsl?raw';
import type { SceneCamera } from '../../scene/types';
import type { PreparedStrandLayer } from '../passes/StrandPass';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';
import { Logger } from '../../../services/logger';

const log = Logger.create('CurveParticleWake');

/** Shared-depth particles with GPU birth impulses and independent world-space advection. */
export class CurveWakePass {
  private device?: GPUDevice;
  private layout?: GPUBindGroupLayout;
  private pipeline?: GPURenderPipeline;
  private stepLayout?: GPUBindGroupLayout;
  private stepPipeline?: GPUComputePipeline;
  private serial = 0;
  private readonly states = new Map<string, { buffer: GPUBuffer; count: number; seed: number; topology: string; time: number; used: number }>();
  private readonly warned = new Set<string>();

  render(device: GPUDevice, encoder: GPUCommandEncoder, color: GPUTextureView, depth: GPUTextureView,
    plans: PreparedStrandLayer[], camera: SceneCamera, temporary: GPUBuffer[], targetKey: string, ready: boolean): void {
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
      const key = `${targetKey}:${layer.layerId}`;
      const topology = JSON.stringify([Array.from(curves.starts), Array.from(curves.counts)]);
      const time = spec.time ?? 0;
      let state = this.states.get(key);
      let reset = !state || state.count !== spec.count || state.seed !== spec.seed || state.topology !== topology;
      if (reset) {
        if (!ready) continue;
        if (state) temporary.push(state.buffer);
        if (!state && this.states.size >= 8) {
          const oldest = [...this.states].toSorted((a, b) => a[1].used - b[1].used)[0];
          temporary.push(oldest[1].buffer); this.states.delete(oldest[0]);
        }
        state = { buffer: device.createBuffer({ size: spec.count * 112, usage: GPUBufferUsage.STORAGE, label: 'curve-wake-state' }),
          count: spec.count, seed: spec.seed, topology, time, used: 0 };
        this.states.set(key, state);
      }
      if (!state) continue;
      state.used = ++this.serial;
      const elapsed = time - state.time;
      if (elapsed < -1e-6 || elapsed > .5) {
        reset = true;
        log.debug('Reseeding curve wake after a source-time jump; historical curve positions are unavailable.', { layerId: layer.layerId, elapsed });
      }
      const values = new Float32Array(68);
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
      values.set([camera.viewport.width, camera.viewport.height, spec.pixelSize ?? 0, spec.intensity ?? 1], 56);
      values.set([time, reset ? 0 : Math.max(0, elapsed), reset ? 1 : 0, spec.inherit ?? .65], 60);
      values.set([spec.vortex ?? 0, spec.vortexRadius ?? .16, spec.vortexDecay ?? 1.2, 0], 64);
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: buffer(values, GPUBufferUsage.UNIFORM) } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffer(ranges, GPUBufferUsage.STORAGE) } },
        { binding: 3, resource: { buffer: state.buffer } },
      ];
      if (ready && (reset || elapsed > 1e-6)) {
        const compute = encoder.beginComputePass({ label: 'curve-wake-advection' });
        compute.setPipeline(this.stepPipeline!);
        compute.setBindGroup(0, device.createBindGroup({ layout: this.stepLayout!, entries }));
        compute.dispatchWorkgroups(Math.ceil(spec.count / 128)); compute.end();
        state.time = time;
      }
      const group = device.createBindGroup({ layout: this.layout!, entries });
      const pass = encoder.beginRenderPass({ label: 'curve-particle-wake',
        colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' } });
      pass.setPipeline(this.pipeline!); pass.setBindGroup(0, group); pass.draw(6, spec.count); pass.end();
    }
  }

  private ensure(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose();
    const module = device.createShaderModule({ label: 'curve-particle-wake', code: common + shader });
    const stepModule = device.createShaderModule({ label: 'curve-wake-advection', code: common + stepShader });
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ] });
    this.stepLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    this.stepPipeline = device.createComputePipeline({ label: 'curve-wake-advection',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.stepLayout] }), compute: { module: stepModule, entryPoint: 'advance' } });
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

  releaseTarget(targetKey: string): void {
    for (const [key, state] of this.states) {
      if (!key.startsWith(`${targetKey}:`)) continue;
      state.buffer.destroy(); this.states.delete(key);
    }
  }

  dispose(): void {
    for (const state of this.states.values()) state.buffer.destroy();
    this.states.clear(); this.stepLayout = undefined; this.stepPipeline = undefined;
    this.device = undefined; this.layout = undefined; this.pipeline = undefined; this.warned.clear();
  }
}
