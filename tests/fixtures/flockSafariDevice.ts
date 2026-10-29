import { vi } from 'vitest';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import type { FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';

// Production (macOS Safari, build 132dbf0): WebKit's Metal compiler rejected
// flock-fluidP2GBlock (most likely its compare-exchange codegen; the compiler line was
// truncated). The first frame had already encoded it, the pass ended invalid, WebKit
// kept the encoder locked and the next beginComputePass failed with "encoder state is
// invalid". By the WebGPU spec the command buffer is lost in every browser; the lock
// only changes the message. The compiler line below is illustrative.
export const METAL_FAILURE = `Failed to compile the shader source, generated metal:\n${'#include <metal_stdlib>\n'.repeat(400)}program_source:812:21: error: no matching function for call to '__wgslAtomicCompareExchangeWeak'`;

/** WebGPU semantics as shipped in Safari: a pass that ended invalid leaves its encoder locked. */
export function safariDevice(failing: RegExp) {
  const scopes: Array<{ filter: GPUErrorFilter; error: GPUError | null }> = [];
  const errors: string[] = [];
  const pipelinesSet: string[] = [];
  const finishedEncoders: string[] = [];
  const rejected = new WeakSet<object>();
  const createPipeline = (descriptor: { label?: string }) => {
    const pipeline = { label: descriptor.label ?? '', getBindGroupLayout: () => ({}) };
    if (failing.test(pipeline.label)) {
      rejected.add(pipeline);
      const scope = scopes.findLast(entry => entry.filter === 'validation');
      if (scope) scope.error ??= { message: METAL_FAILURE } as GPUError; else errors.push(METAL_FAILURE);
    }
    return pipeline;
  };
  const createCommandEncoder = (descriptor?: { label?: string }) => {
    let state: 'open' | 'locked' | 'ended' = 'open';
    let lastError: string | null = null;
    const pass = () => {
      if (state !== 'open') {
        lastError = 'encoder state is invalid';
        return { setPipeline: () => undefined, setBindGroup: () => undefined, setVertexBuffer: () => undefined, dispatchWorkgroups: () => undefined, dispatchWorkgroupsIndirect: () => undefined, draw: () => undefined, end: () => undefined };
      }
      state = 'locked';
      let valid = true;
      return {
        setPipeline: (pipeline: { label: string }) => { pipelinesSet.push(pipeline.label); if (rejected.has(pipeline)) valid = false; },
        setBindGroup: () => undefined,
        setVertexBuffer: () => undefined,
        dispatchWorkgroups: () => undefined,
        dispatchWorkgroupsIndirect: () => undefined,
        draw: () => undefined,
        end: () => {
          if (valid) { state = 'open'; return; }
          lastError ??= 'ComputePassEncoder.endPass failure';
        },
      };
    };
    return {
      beginComputePass: pass,
      beginRenderPass: pass,
      copyBufferToBuffer: () => undefined,
      clearBuffer: () => undefined,
      finish: () => {
        if (state !== 'open' || lastError) errors.push(lastError ?? `encoder state is ${state}`);
        state = 'ended';
        finishedEncoders.push(descriptor?.label ?? '');
        return {};
      },
    };
  };
  const buffer = (descriptor: { size: number; label?: string }) => ({ size: descriptor.size, label: descriptor.label, destroy: vi.fn(), mapAsync: vi.fn(() => Promise.resolve()), getMappedRange: () => new ArrayBuffer(descriptor.size), unmap: vi.fn() });
  const device = {
    limits: { maxComputeWorkgroupsPerDimension: 65535, maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30, minUniformBufferOffsetAlignment: 256 },
    features: new Set<string>(),
    createShaderModule: vi.fn((descriptor: { label?: string }) => ({ label: descriptor.label })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(buffer),
    createComputePipeline: vi.fn(createPipeline),
    createRenderPipeline: vi.fn(createPipeline),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
    createCommandEncoder: vi.fn(createCommandEncoder),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => Promise.resolve()) },
    pushErrorScope: vi.fn((filter: GPUErrorFilter) => { scopes.push({ filter, error: null }); }),
    popErrorScope: vi.fn(() => Promise.resolve(scopes.pop()?.error ?? null)),
    lost: new Promise(() => undefined),
  } as unknown as GPUDevice;
  return { device, errors, pipelinesSet, finishedEncoders };
}

export function fluidProgram(): FlockProgram {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 257, shape: 'grid', size: [12, 10, 4] });
  const simulation = b.add('flock.simulation', { minSpeed: 0, maxSpeed: 20, stepRate: '60' });
  const fluid = b.add('flock.fluid', { size: [16, 16, 8], cellSize: 2, iterations: 4 });
  const compose = b.add('flock.compose');
  const points = b.add('flock.render-points');
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', simulation, 'spawn').connect(fluid, 'behavior', compose, 'behavior')
    .connect(compose, 'behavior', simulation, 'behavior').connect(simulation, 'particles', points, 'particles')
    .connect(points, 'scene', output, 'scene');
  const compiled = compileFlockDefinition(b.build('pipeline gate test'));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.program;
}


/** WebGPU enum globals the flock GPU classes read (absent in Node). */
export function stubFlockGpuGlobals(): void {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 });
  vi.stubGlobal('GPUMapMode', { READ: 1, WRITE: 2 });
  vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
}
