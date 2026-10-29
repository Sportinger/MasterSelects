import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGpuPipelineFailures, getGpuPipelineFailures, guardGpuDevice } from '../../src/engine/core/gpuPipelineGuard';
import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';
import { awaitFlockPipelines } from '../../src/engine/flock/gpu/flockPipelineGate';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import type { FlockProgram } from '../../src/services/flock/compiler/flockProgramTypes';

// Production (macOS Safari, build 132dbf0): WebKit could not compile flock-fluidP2GBlock.
// The first frame had already encoded it, the pass ended invalid, WebKit kept the
// encoder locked and the next beginComputePass failed with "encoder state is invalid".
const METAL_FAILURE = `Failed to compile the shader source, generated metal:\n${'#include <metal_stdlib>\n'.repeat(400)}program_source:812:21: error: no matching function for call to '__wgslAtomicCompareExchangeWeak'`;

/** WebGPU semantics as shipped in Safari: a pass that ended invalid leaves its encoder locked. */
function safariDevice(failing: RegExp) {
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
        return { setPipeline: () => undefined, setBindGroup: () => undefined, dispatchWorkgroups: () => undefined, dispatchWorkgroupsIndirect: () => undefined, draw: () => undefined, end: () => undefined };
      }
      state = 'locked';
      let valid = true;
      return {
        setPipeline: (pipeline: { label: string }) => { pipelinesSet.push(pipeline.label); if (rejected.has(pipeline)) valid = false; },
        setBindGroup: () => undefined,
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

function fluidProgram(): FlockProgram {
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

const context = { keyframesByProperty: indexFlockKeyframes([]) };

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 });
  vi.stubGlobal('GPUMapMode', { READ: 1, WRITE: 2 });
  vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
  clearGpuPipelineFailures('editor');
});
afterEach(() => { vi.unstubAllGlobals(); clearGpuPipelineFailures('editor'); });

describe('flock pipeline verdict gate', () => {
  it('reproduces the production failure when a frame encodes a pipeline before its verdict', () => {
    const { device, errors } = safariDevice(/fluidP2GBlock/);
    guardGpuDevice(device, 'editor');
    const states = [device.createBuffer({ size: 257 * 64, usage: 0 })];
    const grid = new FlockFluidGrid(device, fluidProgram().fluid!, states, 1, { dispatchWidth: 2 });
    const encoder = device.createCommandEncoder();
    grid.encode(encoder, 0, 0, 257);
    encoder.finish();
    expect(errors).toContain('encoder state is invalid');
  });

  it('waits for verdicts, then runs the reference transfer when the block transfer is rejected', async () => {
    const { device, errors, pipelinesSet, finishedEncoders } = safariDevice(/fluidP2GBlock/);
    guardGpuDevice(device, 'editor');
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    expect(session.pipelineState).toBe('pending');
    expect(session.advanceTo(3, 3)).toBe(false);
    expect(finishedEncoders).not.toContain('flock-steps');

    await expect(session.whenPipelinesSettled()).resolves.toBe('ready');
    expect(session.pipelineFallbacks.map(failure => failure.label)).toEqual(['flock-fluidP2GBlock']);
    expect(session.advanceTo(3, 3)).toBe(true);
    expect(finishedEncoders).toContain('flock-steps');
    expect(pipelinesSet).toContain('flock-fluidP2G');
    expect(pipelinesSet).not.toContain('flock-fluidP2GBlock');
    expect(errors).toEqual([]);
    // A fallback is a warning, not a "feature skipped" notice.
    expect(getGpuPipelineFailures()).toEqual([]);
    session.dispose();
  });

  it('never encodes a session whose required pipeline was rejected and reports it once', async () => {
    const { device, errors, finishedEncoders } = safariDevice(/^flock-simulate$/);
    guardGpuDevice(device, 'editor');
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    await expect(session.whenPipelinesSettled()).resolves.toBe('failed');
    expect(session.pipelineFailure).toMatchObject({ label: 'flock-simulate', kind: 'validation' });
    expect(session.advanceTo(3, 3)).toBe(false);
    expect(() => session.encodeLinks(device.createCommandEncoder() as unknown as GPUCommandEncoder, { branchIndex: 0, radius: 4, perParticle: 2, fraction: 1, salt: 1 }))
      .toThrow(/pipelines are failed/);
    expect(finishedEncoders).not.toContain('flock-steps');
    expect(errors).toEqual([]);
    await expect(awaitFlockPipelines(session)).rejects.toThrow(/flock-simulate .*does not run on this device.*program_source:812:21: error/);
    expect(getGpuPipelineFailures().map(record => record.label)).toEqual(['flock-simulate']);
    session.dispose();
  });

  it('works on an unguarded device through its own error scopes', async () => {
    const { device, errors } = safariDevice(/fluidP2GBlock/);
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    await expect(session.whenPipelinesSettled()).resolves.toBe('ready');
    expect(session.pipelineFallbacks).toHaveLength(1);
    expect(session.advanceTo(2, 2)).toBe(true);
    expect(errors).toEqual([]);
    session.dispose();
  });
});
