import { SCENE_COLOR_FORMAT, SCENE_DEPTH_FORMAT } from '../../native3d/sceneRenderer/constants';
import { FLOCK_POINT_RASTER_COMPUTE_WGSL, FLOCK_POINT_RASTER_RESOLVE_WGSL, FLOCK_RASTER_WORKGROUP } from '../shaders/flockPointRasterWgsl';
import { createCheckedModule, FLOCK_SHADOW_FORMAT, watchValidation, type FlockGpuPipelines } from './FlockGpuPipelines';
import { flockGpuTimings } from './FlockGpuTimings';

type RasterEntry = 'clearPixels' | 'pointDepth' | 'pointWinner' | 'shadowDepth';

export interface FlockRasterTarget {
  width: number;
  height: number;
  count: number;
  dispatchWidth: number;
  lastFrame: number;
  buffer: GPUBuffer;
  params: GPUBuffer;
  compute: GPUBindGroup;
  resolve: GPUBindGroup;
}

/** Rasterizes opaque small points, then resolves into the existing scene depth. */
export class FlockPointRasterizer {
  private readonly device: GPUDevice;
  private readonly computeLayout: GPUBindGroupLayout;
  private readonly resolveLayout: GPUBindGroupLayout;
  private readonly computePipelines: Record<RasterEntry, GPUComputePipeline>;
  private readonly pointResolve: GPURenderPipeline;
  private readonly shadowResolve: GPURenderPipeline;
  private readonly targets = new Map<string, FlockRasterTarget>();
  private frame = 0;

  constructor(device: GPUDevice, pipelines: FlockGpuPipelines) {
    this.device = device;
    const makeLayout = (compute: boolean) => device.createBindGroupLayout({
      label: `flock-raster-${compute ? 'compute' : 'resolve'}-layout`,
      entries: [
        { binding: 0, visibility: compute ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT, buffer: { type: compute ? 'storage' : 'read-only-storage' } },
        { binding: 1, visibility: compute ? GPUShaderStage.COMPUTE : GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.computeLayout = makeLayout(true);
    this.resolveLayout = makeLayout(false);
    const layout = (last: GPUBindGroupLayout) => device.createPipelineLayout({
      bindGroupLayouts: [pipelines.frameLayout, pipelines.getBranchLayout('points'), pipelines.pointCacheRenderLayout, last],
    });
    const done = watchValidation(device, 'flock point raster pipelines');
    const computeModule = createCheckedModule(device, FLOCK_POINT_RASTER_COMPUTE_WGSL, 'flock-point-raster');
    const computeLayout = layout(this.computeLayout);
    this.computePipelines = Object.fromEntries((['clearPixels', 'pointDepth', 'pointWinner', 'shadowDepth'] as RasterEntry[]).map(entryPoint => [entryPoint, device.createComputePipeline({
      layout: computeLayout, compute: { module: computeModule, entryPoint }, label: `flock-${entryPoint}`,
    })])) as Record<RasterEntry, GPUComputePipeline>;
    const resolveModule = createCheckedModule(device, FLOCK_POINT_RASTER_RESOLVE_WGSL, 'flock-point-resolve');
    const resolveLayout = layout(this.resolveLayout);
    const resolve = (shadow: boolean) => device.createRenderPipeline({
      layout: resolveLayout, label: `flock-${shadow ? 'shadow' : 'point'}-resolve`,
      vertex: { module: resolveModule, entryPoint: 'fullscreen' },
      fragment: { module: resolveModule, entryPoint: shadow ? 'resolveShadow' : 'resolvePoint', targets: shadow ? [] : [{ format: SCENE_COLOR_FORMAT }] },
      depthStencil: { format: shadow ? FLOCK_SHADOW_FORMAT : SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: shadow ? 'less' : 'less-equal' },
      primitive: { topology: 'triangle-list' },
    });
    this.pointResolve = resolve(false);
    this.shadowResolve = resolve(true);
    done();
  }

  ensure(key: string, width: number, height: number, count: number): FlockRasterTarget | null {
    const bytes = width * height * 8;
    if (width < 1 || height < 1 || bytes > Math.min(this.device.limits.maxBufferSize, this.device.limits.maxStorageBufferBindingSize)) return null;
    const existing = this.targets.get(key);
    if (existing?.width === width && existing.height === height && existing.count === count) {
      existing.lastFrame = this.frame;
      return existing;
    }
    if (existing) this.destroy(key, existing);
    // Bound aggregate raster scratch memory, independently of particle caches.
    const allocated = [...this.targets.values()].reduce((sum, item) => sum + item.width * item.height * 8, 0);
    if (allocated + bytes > 256 * 1024 * 1024) return null;
    const buffer = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE, label: 'flock-raster-pixels' });
    const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const dispatchWidth = Math.min(65535, this.device.limits.maxComputeWorkgroupsPerDimension) * FLOCK_RASTER_WORKGROUP;
    this.device.queue.writeBuffer(params, 0, new Uint32Array([width, height, count, dispatchWidth]));
    const entries = [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: params } }];
    const target = { width, height, count, dispatchWidth, lastFrame: this.frame, buffer, params,
      compute: this.device.createBindGroup({ layout: this.computeLayout, entries }),
      resolve: this.device.createBindGroup({ layout: this.resolveLayout, entries }),
    };
    this.targets.set(key, target);
    return target;
  }

  encode(encoder: GPUCommandEncoder, entry: RasterEntry, target: FlockRasterTarget, groups: [GPUBindGroup, GPUBindGroup, GPUBindGroup]): void {
    const pass = encoder.beginComputePass({ label: `flock-raster-${entry}`, timestampWrites: flockGpuTimings(this.device).writes(encoder, entry) });
    pass.setPipeline(this.computePipelines[entry]);
    groups.forEach((group, index) => pass.setBindGroup(index, group));
    pass.setBindGroup(3, target.compute);
    const count = entry === 'clearPixels' ? target.width * target.height : target.count;
    pass.dispatchWorkgroups(Math.ceil(Math.min(count, target.dispatchWidth) / FLOCK_RASTER_WORKGROUP), Math.ceil(count / target.dispatchWidth));
    pass.end();
  }

  draw(pass: GPURenderPassEncoder, target: FlockRasterTarget, groups: [GPUBindGroup, GPUBindGroup, GPUBindGroup], shadow = false): void {
    pass.setPipeline(shadow ? this.shadowResolve : this.pointResolve);
    groups.forEach((group, index) => pass.setBindGroup(index, group));
    pass.setBindGroup(3, target.resolve);
    pass.draw(3);
  }

  beginFrame(): void {
    this.frame += 1;
    for (const [key, target] of this.targets) {
      if (this.frame - target.lastFrame > 120) this.destroy(key, target);
    }
  }

  dispose(): void { for (const [key, target] of this.targets) this.destroy(key, target); }

  private destroy(key: string, target: FlockRasterTarget): void {
    target.buffer.destroy();
    target.params.destroy();
    this.targets.delete(key);
  }
}
