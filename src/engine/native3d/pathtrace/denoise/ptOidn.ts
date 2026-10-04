import { ptComputePipeline, ptLog, ptShaderModule } from '../ptCompute';

/** OIDN models: `standard` for export, `small` for the paused preview polish (plan 4.6/4.7). */
export type PtDenoiseModel = 'standard' | 'small';

/** Weights served from our own asset path (public/oidn, Apache-2.0, see LICENSING.md). */
const WEIGHTS: Record<PtDenoiseModel, string> = {
  standard: '/oidn/rt_hdr_alb_nrm.tza',
  small: '/oidn/rt_hdr_alb_nrm_small.tza',
};

const PREPARE = /* wgsl */`
struct Params { pixels: u32, inverseSamples: f32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> accumulation: array<vec4f>;
@group(0) @binding(2) var<storage, read> auxiliary: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> color: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> albedo: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> normal: array<vec4f>;
@group(0) @binding(6) var<storage, read> pixelState: array<vec4f>;
@compute @workgroup_size(256)
fn prepare(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.y * groups.x * 256u + id.x;
  if (i >= params.pixels) { return; }
  // Each pixel's own sample count (adaptive sampling); the frame's count before the first sample.
  let inverse = select(params.inverseSamples, 1.0 / pixelState[i].w, pixelState[i].w > 0.0);
  let c = accumulation[i] * inverse;
  // The network spreads a NaN or infinite input over its whole receptive field: pass only finite values.
  color[i] = vec4f(select(vec3f(0.0), max(c.rgb, vec3f(0.0)), all(abs(c.rgb) < vec3f(1.0e20))), 1.0);
  albedo[i] = vec4f(clamp(auxiliary[i * 2u].rgb * inverse, vec3f(0.0), vec3f(1.0)), 1.0);
  let n = auxiliary[i * 2u + 1u].xyz * inverse;
  normal[i] = vec4f(clamp(n, vec3f(-1.0), vec3f(1.0)), 1.0);
}`;

/**
 * oidn-web schedules one tile per animation frame, and a hidden tab runs no animation frames. While
 * a denoise runs in a hidden document, frames are driven by timers instead; the original
 * requestAnimationFrame is restored when the last running denoise finishes.
 */
let hiddenDenoises = 0;
let originalFrame: typeof requestAnimationFrame | null = null;
function keepTilesRunningWhenHidden(): () => void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined' || !document.hidden) return () => undefined;
  if (hiddenDenoises++ === 0) {
    originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => Number(setTimeout(() => callback(performance.now()), 0));
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (--hiddenDenoises === 0 && originalFrame) { globalThis.requestAnimationFrame = originalFrame; originalFrame = null; }
  };
}

interface UNetLike {
  dispose(): void;
  tileExecute(options: {
    color: { data: GPUBuffer; width: number; height: number };
    albedo: { data: GPUBuffer; width: number; height: number };
    normal: { data: GPUBuffer; width: number; height: number };
    done: (output: { data: GPUBuffer; width: number; height: number }) => void;
  }): () => void;
}

export interface PtDenoiseJob {
  /** Resolves with a buffer of `width × height` vec4f (denoised linear radiance) owned by the caller, or null when aborted or unavailable. */
  promise: Promise<GPUBuffer | null>;
  abort(): void;
  /** Samples the image had when it was handed to the network (known once the job started). */
  samples: number;
}

/**
 * AI denoising with Intel Open Image Denoise through oidn-web on the editor's own GPUDevice: GPU
 * buffers in and out, tiled, FP16 when the device has shader-f16. The HDR + albedo + normal model
 * matches the path tracer's AOVs (averaged over all samples).
 */
/** One network per device and model, shared by every runtime (its weights and tile buffers are large). */
const sharedNetworks = new WeakMap<GPUDevice, Map<PtDenoiseModel, Promise<UNetLike | null>>>();

/** Frees the device's OIDN networks (the device is going away). */
export function ptDisposeDenoisers(device: GPUDevice): void {
  const networks = sharedNetworks.get(device);
  if (!networks) return;
  sharedNetworks.delete(device);
  for (const network of networks.values()) void network.then(unet => unet?.dispose());
}

export class PtDenoiser {
  private network(device: GPUDevice, model: PtDenoiseModel): Promise<UNetLike | null> {
    let networks = sharedNetworks.get(device);
    if (!networks) { networks = new Map(); sharedNetworks.set(device, networks); }
    let network = networks.get(model);
    if (!network) {
      network = (async () => {
        try {
          const { initUNetFromURL } = await import('oidn-web');
          const adapterInfo = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo ?? ({} as GPUAdapterInfo);
          return await initUNetFromURL(WEIGHTS[model], { device, adapterInfo }, { aux: true, hdr: true }) as unknown as UNetLike;
        } catch (error) {
          ptLog.warn('OIDN could not be initialized; images stay undenoised', { model, error: String(error) });
          return null;
        }
      })();
      networks.set(model, network);
    }
    return network;
  }

  /**
   * Denoises the accumulated image. `samples` is read when the image is copied for the network:
   * accumulation may continue meanwhile (an early preview denoise), the copy takes what was submitted.
   */
  denoise(device: GPUDevice, model: PtDenoiseModel, source: { accumulation: GPUBuffer; auxiliary: GPUBuffer; pixelState: GPUBuffer; samples: () => number; width: number; height: number }): PtDenoiseJob {
    let aborted = false, cancel: (() => void) | null = null, settle: ((value: GPUBuffer | null) => void) | null = null;
    const job: PtDenoiseJob = { promise: Promise.resolve(null), abort: () => { aborted = true; cancel?.(); settle?.(null); }, samples: 0 };
    job.promise = (async () => {
      const network = await this.network(device, model);
      if (!network || aborted) return null;
      job.samples = source.samples();
      const { width, height } = source, pixels = width * height;
      const buffer = (label: string) => device.createBuffer({ label, size: pixels * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      const color = buffer('pt-oidn-color'), albedo = buffer('pt-oidn-albedo'), normal = buffer('pt-oidn-normal');
      const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(params, 0, new Uint32Array([pixels, new Uint32Array(Float32Array.of(1 / Math.max(1, job.samples)).buffer)[0], 0, 0]));
      const pipeline = ptComputePipeline(device, 'pt-oidn-prepare', ptShaderModule(device, 'pt-oidn-prepare', PREPARE), 'prepare');
      const encoder = device.createCommandEncoder({ label: 'pt-oidn-prepare' });
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: source.accumulation } },
        { binding: 2, resource: { buffer: source.auxiliary } }, { binding: 3, resource: { buffer: color } },
        { binding: 4, resource: { buffer: albedo } }, { binding: 5, resource: { buffer: normal } },
        { binding: 6, resource: { buffer: source.pixelState } }] }));
      const groups = Math.ceil(pixels / 256), x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
      pass.dispatchWorkgroups(x, Math.ceil(groups / x));
      pass.end();
      device.queue.submit([encoder.finish()]);
      const restoreFrames = keepTilesRunningWhenHidden();
      const output = await new Promise<GPUBuffer | null>(resolve => {
        settle = value => { restoreFrames(); resolve(value); };
        cancel = network.tileExecute({
          color: { data: color, width, height }, albedo: { data: albedo, width, height }, normal: { data: normal, width, height },
          done: result => {
            restoreFrames();
            // The network reuses its output buffer; keep our own copy.
            const copy = buffer('pt-oidn-result');
            const copyEncoder = device.createCommandEncoder();
            copyEncoder.copyBufferToBuffer(result.data, 0, copy, 0, pixels * 16);
            device.queue.submit([copyEncoder.finish()]);
            resolve(copy);
          },
        });
        if (aborted) { cancel(); resolve(null); }
      });
      void device.queue.onSubmittedWorkDone().then(() => { color.destroy(); albedo.destroy(); normal.destroy(); params.destroy(); });
      return aborted ? (output?.destroy(), null) : output;
    })();
    return job;
  }
}
