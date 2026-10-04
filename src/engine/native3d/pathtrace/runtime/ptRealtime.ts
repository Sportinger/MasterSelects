import { ptUniformBuffer, PT_WORKGROUP } from '../ptCompute';
import { PT_BAND_STRIDE, PT_MAX_BANDS, type PtBand, type PtDispatchBudget } from './ptDispatchBudget';
import { ptRealtimePipelines } from './ptRealtimePipelines';
import { PtPassProfiler } from './ptPassProfiler';

/** Entries of the radiance cache (PtSharc.wgsl PT_SHARC_CAPACITY) and their size. */
export const PT_SHARC_CAPACITY = 524288;
const PT_SHARC_ENTRY_BYTES = 32;
const SURFACE_VEC4 = 4;
const LIGHTING_VEC4 = 3;
const HISTORY_VEC4 = 2;
const ATROUS_ITERATIONS = 4;
const NO_HISTORY = 0xffffffff;

/** Halton (2, 3) subpixel offsets in [-0.5, 0.5): the upscaler's jitter sequence. */
export function ptJitter(frame: number): [number, number] {
  const halton = (index: number, base: number) => {
    let f = 1, r = 0;
    for (let i = index; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); }
    return r;
  };
  const index = (frame % 16) + 1;
  return [halton(index, 2) - 0.5, halton(index, 3) - 0.5];
}

interface RealtimeTarget {
  renderWidth: number;
  renderHeight: number;
  outputWidth: number;
  outputHeight: number;
  surfaces: GPUBuffer;
  lighting: GPUBuffer;
  /** ReSTIR history, two halves; the read half is `parity`. */
  history: GPUBuffer;
  moments: [GPUBuffer, GPUBuffer];
  filter: [GPUBuffer, GPUBuffer];
  upscaled: [GPUBuffer, GPUBuffer];
  outputDepth: GPUBuffer;
  parity: 0 | 1;
  valid: boolean;
}

export interface PtRealtimeEncode {
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  targetKey: string;
  renderSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  /** Bind groups 0-2 (frame uniform already holds this frame's realtime values). */
  sceneGroups: readonly GPUBindGroup[];
  bands: readonly PtBand[];
  jitter: [number, number];
  /** Lighting changed: the cached radiance is wrong, start the cache over. */
  clearCache: boolean;
  budget: PtDispatchBudget;
  temporaries: GPUBuffer[];
}

export interface PtRealtimeResult {
  /** Output resolution, premultiplied linear (rgb, coverage). */
  color: GPUBuffer;
  /** Output resolution NDC depth. */
  depth: GPUBuffer;
}

/**
 * The realtime path of the path tracer (plan 4.6): integrator with ReSTIR candidates and the
 * radiance cache, ReSTIR reuse and shading, cache resolve, SVGF (temporal + à-trous) and the
 * temporal upscaler to the output size. Keeps per target the G-buffer, histories and outputs.
 */
export class PtRealtimeRenderer {
  private readonly targets = new Map<string, RealtimeTarget>();
  private sharc: GPUBuffer | null = null;
  private bandBuffer: GPUBuffer | null = null;
  private device: GPUDevice | null = null;
  readonly profiler = new PtPassProfiler();
  /** Realtime frames rendered on this device (the cache's clock). */
  tick = 0;

  private ensure(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose();
    this.device = device;
    this.sharc = device.createBuffer({ label: 'pt-sharc', size: PT_SHARC_CAPACITY * PT_SHARC_ENTRY_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bandBuffer = device.createBuffer({ label: 'pt-realtime-bands', size: PT_BAND_STRIDE * PT_MAX_BANDS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  private target(device: GPUDevice, key: string, render: { width: number; height: number }, output: { width: number; height: number },
    temporaries: GPUBuffer[]): RealtimeTarget {
    const current = this.targets.get(key);
    if (current && current.renderWidth === render.width && current.renderHeight === render.height
      && current.outputWidth === output.width && current.outputHeight === output.height) return current;
    if (current) temporaries.push(...targetBuffers(current));
    const buffer = (label: string, bytes: number) => device.createBuffer({ label: `${label}-${key}`, size: Math.max(16, bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const pixels = render.width * render.height, outputs = output.width * output.height;
    const target: RealtimeTarget = {
      renderWidth: render.width, renderHeight: render.height, outputWidth: output.width, outputHeight: output.height,
      surfaces: buffer('pt-rt-surfaces', pixels * SURFACE_VEC4 * 16),
      lighting: buffer('pt-rt-lighting', pixels * LIGHTING_VEC4 * 16),
      history: buffer('pt-rt-restir-history', pixels * HISTORY_VEC4 * 16 * 2),
      moments: [buffer('pt-rt-moments-a', pixels * 32), buffer('pt-rt-moments-b', pixels * 32)],
      filter: [buffer('pt-rt-filter-a', pixels * 16), buffer('pt-rt-filter-b', pixels * 16)],
      upscaled: [buffer('pt-rt-upscaled-a', outputs * 16), buffer('pt-rt-upscaled-b', outputs * 16)],
      outputDepth: buffer('pt-rt-depth', outputs * 4),
      parity: 0, valid: false,
    };
    this.targets.set(key, target);
    return target;
  }

  /** The last realtime output of a target (shown while a still image converges), or null. */
  lastOutput(key: string): PtRealtimeResult | null {
    const target = this.targets.get(key);
    return target?.valid ? { color: target.upscaled[target.parity], depth: target.outputDepth } : null;
  }

  outputSize(key: string): { width: number; height: number } | null {
    const target = this.targets.get(key);
    return target ? { width: target.outputWidth, height: target.outputHeight } : null;
  }

  encode(args: PtRealtimeEncode): PtRealtimeResult {
    const { device, encoder, bands, temporaries, budget } = args;
    this.ensure(device);
    const pipelines = ptRealtimePipelines(device);
    const target = this.target(device, args.targetKey, args.renderSize, args.outputSize, temporaries);
    const { renderWidth, renderHeight, outputWidth, outputHeight } = target;
    const pixels = renderWidth * renderHeight, half = pixels * HISTORY_VEC4;
    const read = target.parity, write = (1 - target.parity) as 0 | 1;
    const historyRead = target.valid ? read * half : NO_HISTORY;
    const bandData = new Uint32Array(bands.length * PT_BAND_STRIDE / 4);
    bands.forEach((band, index) => bandData.set([band.firstRow, band.rows, historyRead, write * half], index * PT_BAND_STRIDE / 4));
    device.queue.writeBuffer(this.bandBuffer!, 0, bandData);
    const band = { buffer: this.bandBuffer!, size: 16 };
    const group = (layout: GPUBindGroupLayout, resources: GPUBindingResource[]) => device.createBindGroup({ layout,
      entries: resources.map((resource, binding) => ({ binding, resource })) });

    if (args.clearCache) this.resolveCache(device, encoder, 1, temporaries);
    const integratorGroup = group(pipelines.integratorOutputs, [{ buffer: target.surfaces }, { buffer: target.lighting }, { buffer: this.sharc! }, band]);
    const restirGroup = group(pipelines.restirOutputs, [{ buffer: target.surfaces }, { buffer: target.lighting }, { buffer: target.history }, band]);
    const passes = bands.length * 2;
    let passIndex = 0;
    // A profiled frame writes per-stage timestamps instead of the budget's (one query set per pass).
    const profiling = this.profiler.begin(device);
    for (const [stage, pipeline, outputs] of [['integrate', pipelines.integrator, integratorGroup], ['restir', pipelines.restir, restirGroup]] as const) {
      bands.forEach((item, index) => {
        const timestampWrites = profiling ? this.profiler.writes(stage, index === 0, index === bands.length - 1)
          : budget.timestampWrites(device, passIndex, passes);
        passIndex++;
        const pass = encoder.beginComputePass({ label: 'pt-realtime', ...(timestampWrites ? { timestampWrites } : {}) });
        pass.setPipeline(pipeline);
        args.sceneGroups.forEach((sceneGroup, slot) => pass.setBindGroup(slot, sceneGroup));
        pass.setBindGroup(3, outputs, [index * PT_BAND_STRIDE]);
        pass.dispatchWorkgroups(Math.ceil(renderWidth / 8), Math.ceil(item.rows / 8));
        pass.end();
      });
    }
    if (!profiling) budget.encodeResolve(device, encoder, pixels);
    this.resolveCache(device, encoder, 0, temporaries);

    const denoiseWrites = this.profiler.writes('denoise', true, true);
    const pass = encoder.beginComputePass({ label: 'pt-realtime-denoise', ...(denoiseWrites ? { timestampWrites: denoiseWrites } : {}) });
    const size = Uint32Array.of(renderWidth, renderHeight, historyRead, target.valid ? 1 : 0);
    pass.setPipeline(pipelines.svgf);
    pass.setBindGroup(0, group(pipelines.svgfLayout, [{ buffer: target.surfaces }, { buffer: target.lighting }, { buffer: target.history },
      { buffer: target.moments[read] }, { buffer: target.moments[write] }, { buffer: target.filter[0] },
      { buffer: ptUniformBuffer(device, 'pt-svgf', size, temporaries) }]));
    pass.dispatchWorkgroups(Math.ceil(renderWidth / 8), Math.ceil(renderHeight / 8));
    pass.setPipeline(pipelines.atrous);
    for (let iteration = 0; iteration < ATROUS_ITERATIONS; iteration++) {
      const last = iteration === ATROUS_ITERATIONS - 1;
      pass.setBindGroup(0, group(pipelines.atrousLayout, [{ buffer: target.surfaces }, { buffer: target.filter[iteration % 2] },
        { buffer: target.filter[(iteration + 1) % 2] },
        { buffer: ptUniformBuffer(device, 'pt-atrous', Uint32Array.of(renderWidth, renderHeight, 1 << iteration, last ? 1 : 0), temporaries) }]));
      pass.dispatchWorkgroups(Math.ceil(renderWidth / 8), Math.ceil(renderHeight / 8));
    }
    const denoised = target.filter[ATROUS_ITERATIONS % 2];
    const upscaleParams = new ArrayBuffer(32), u = new Uint32Array(upscaleParams), f = new Float32Array(upscaleParams);
    u.set([renderWidth, renderHeight, outputWidth, outputHeight]);
    f.set(args.jitter, 4);
    u[6] = target.valid ? 1 : 0;
    pass.setPipeline(pipelines.upscale);
    pass.setBindGroup(0, group(pipelines.upscaleLayout, [{ buffer: target.surfaces }, { buffer: denoised }, { buffer: target.upscaled[read] },
      { buffer: target.upscaled[write] }, { buffer: target.outputDepth },
      { buffer: ptUniformBuffer(device, 'pt-upscale', new Uint32Array(upscaleParams), temporaries) }]));
    pass.dispatchWorkgroups(Math.ceil(outputWidth / 8), Math.ceil(outputHeight / 8));
    pass.end();
    this.profiler.resolve(encoder);

    target.parity = write;
    target.valid = true;
    this.tick++;
    return { color: target.upscaled[write], depth: target.outputDepth };
  }

  /** Folds this frame's training into the cache (clear = 1 empties it). */
  private resolveCache(device: GPUDevice, encoder: GPUCommandEncoder, clear: number, temporaries: GPUBuffer[]): void {
    const pipelines = ptRealtimePipelines(device);
    const groups = PT_SHARC_CAPACITY / PT_WORKGROUP;
    const x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension), y = Math.ceil(groups / x);
    const params = ptUniformBuffer(device, 'pt-sharc-params', Uint32Array.of(this.tick, x * PT_WORKGROUP, clear, 0), temporaries);
    const writes = clear ? undefined : this.profiler.writes('cache', true, true);
    const pass = encoder.beginComputePass({ label: 'pt-sharc-resolve', ...(writes ? { timestampWrites: writes } : {}) });
    pass.setPipeline(pipelines.sharcResolve);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipelines.sharcLayout, entries: [
      { binding: 0, resource: { buffer: this.sharc! } }, { binding: 1, resource: { buffer: params } }] }));
    pass.dispatchWorkgroups(x, y);
    pass.end();
  }

  /** After the frame's submission: read the profiled stage times. */
  afterSubmit(): void {
    this.profiler.afterSubmit();
  }

  /** Forget a target's history (the next frame starts fresh). */
  invalidate(key: string): void {
    const target = this.targets.get(key);
    if (target) target.valid = false;
  }

  releaseTarget(key: string): void {
    const target = this.targets.get(key);
    if (!target) return;
    for (const buffer of targetBuffers(target)) buffer.destroy();
    this.targets.delete(key);
  }

  get gpuBytes(): number {
    let bytes = this.sharc?.size ?? 0;
    for (const target of this.targets.values()) bytes += targetBuffers(target).reduce((n, buffer) => n + buffer.size, 0);
    return bytes;
  }

  dispose(): void {
    for (const key of [...this.targets.keys()]) this.releaseTarget(key);
    this.sharc?.destroy(); this.sharc = null;
    this.bandBuffer?.destroy(); this.bandBuffer = null;
    this.profiler.dispose();
    this.device = null;
  }
}

function targetBuffers(target: RealtimeTarget): GPUBuffer[] {
  return [target.surfaces, target.lighting, target.history, ...target.moments, ...target.filter, ...target.upscaled, target.outputDepth];
}
