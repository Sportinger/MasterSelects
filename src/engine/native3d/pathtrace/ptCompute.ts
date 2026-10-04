import { Logger } from '../../../services/logger';

const log = Logger.create('PathTrace');

/** Threads per workgroup of the 1D path tracing kernels. */
export const PT_WORKGROUP = 256;

const modules = new WeakMap<GPUDevice, Map<string, GPUShaderModule>>();

/** One shader module per source and device; compilation errors are logged with their line numbers. */
export function ptShaderModule(device: GPUDevice, label: string, code: string): GPUShaderModule {
  let cache = modules.get(device);
  if (!cache) { cache = new Map(); modules.set(device, cache); }
  let module = cache.get(code);
  if (!module) {
    module = device.createShaderModule({ label, code });
    void module.getCompilationInfo?.().then(info => {
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) {
        const lines = code.split(/\r?\n/);
        log.error(`${label}: shader compilation failed: ${errors.map(message =>
          `${message.lineNum}:${message.linePos} ${message.message} | ${lines[message.lineNum - 1]?.trim() ?? ''}`).join(' || ')}`);
      }
    });
    cache.set(code, module);
  }
  return module;
}

export function ptComputePipeline(device: GPUDevice, label: string, module: GPUShaderModule, entryPoint: string,
  layout: GPUPipelineLayout | 'auto' = 'auto'): GPUComputePipeline {
  return device.createComputePipeline({ label: `${label}-${entryPoint}`, layout, compute: { module, entryPoint } });
}

/** Rows of a 2D dispatch that covers `threads` with `PT_WORKGROUP`-wide groups within the device limit. */
export function ptDispatchShape(device: GPUDevice, threads: number): { x: number; y: number; width: number } {
  const groups = Math.max(1, Math.ceil(threads / PT_WORKGROUP));
  const x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
  return { x, y: Math.ceil(groups / x), width: x * PT_WORKGROUP };
}

export function ptDispatch(pass: GPUComputePassEncoder, device: GPUDevice, threads: number): void {
  const shape = ptDispatchShape(device, threads);
  pass.dispatchWorkgroups(shape.x, shape.y);
}

export function ptStorageBuffer(device: GPUDevice, label: string, bytes: number, extraUsage = 0): GPUBuffer {
  return device.createBuffer({ label, size: Math.max(16, Math.ceil(bytes / 16) * 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extraUsage });
}

export function ptUniformBuffer(device: GPUDevice, label: string, data: ArrayBufferView, temporaries?: GPUBuffer[]): GPUBuffer {
  const buffer = device.createBuffer({ label, size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  temporaries?.push(buffer);
  return buffer;
}

export { log as ptLog };
