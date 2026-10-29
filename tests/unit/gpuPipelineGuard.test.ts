import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGpuPipelineFailures,
  condenseGpuPipelineMessage,
  createCheckedPipeline,
  getGpuPipelineFailures,
  GPU_PIPELINE_FALLBACK_MESSAGE,
  gpuFeatureName,
  guardGpuDevice,
  gpuPipelineSettled,
  isGpuPipelineFailed,
  markGpuPipelineFallback,
} from '../../src/engine/core/gpuPipelineGuard';
import { HapGpuBlockEncoder } from '../../src/engine/hap/HapGpuBlockEncoder';
import { setLoggerDiagnosticErrorSink, type LogEntry } from '../../src/services/logger';
import { classifyRuntimeFailure } from '../../src/services/diagnostics/diagnosticFingerprint';

// Production (Android 15, Brave 155): a flock or 3D pipeline the Vulkan driver could not
// compile made every frame's command buffer invalid, so all layers vanished.
const DRIVER_FAILURE = 'CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN';

/** WebGPU error-scope semantics: an error goes to the innermost scope with its filter, else it is uncaptured. */
function fakeDevice(failing: RegExp) {
  const scopes: Array<{ filter: GPUErrorFilter; error: GPUError | null }> = [];
  const uncaptured: string[] = [];
  const calls: string[] = [];
  const create = (descriptor: { label?: string }) => {
    if (failing.test(descriptor.label ?? '')) {
      const scope = scopes.findLast(entry => entry.filter === 'internal');
      if (scope) scope.error ??= { message: DRIVER_FAILURE } as GPUError; else uncaptured.push(DRIVER_FAILURE);
    }
    const layout = { owner: descriptor.label };
    return { label: descriptor.label, getBindGroupLayout: () => layout };
  };
  const pass = () => ({
    setPipeline: (pipeline: { label: string }) => calls.push(`setPipeline ${pipeline.label}`),
    setBindGroup: (_index: number, group: { label: string }) => calls.push(`setBindGroup ${group.label}`),
    draw: () => calls.push('draw'),
    dispatchWorkgroups: () => calls.push('dispatch'),
    end: () => calls.push('end'),
  });
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn((descriptor: { label?: string }) => ({ label: descriptor.label })),
    createRenderPipeline: vi.fn(create),
    createComputePipeline: vi.fn(create),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass: pass, beginComputePass: pass })),
    pushErrorScope: vi.fn((filter: GPUErrorFilter) => { scopes.push({ filter, error: null }); }),
    popErrorScope: vi.fn(() => Promise.resolve(scopes.pop()?.error ?? null)),
    lost: new Promise(() => undefined),
  } as unknown as GPUDevice;
  return { device, uncaptured, calls };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function encodeFrame(device: GPUDevice, pipelines: GPURenderPipeline[]) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({} as GPURenderPassDescriptor);
  for (const pipeline of pipelines) {
    const group = device.createBindGroup({ label: `${pipeline.label}-group`, layout: pipeline.getBindGroupLayout(0), entries: [] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
  }
  pass.end();
}

beforeEach(() => clearGpuPipelineFailures('editor'));
afterEach(() => clearGpuPipelineFailures('editor'));

describe('device-wide GPU pipeline guard', () => {
  it('skips a pipeline the driver could not build and keeps the rest of the frame', async () => {
    const { device, uncaptured, calls } = fakeDevice(/flock-integrate/);
    guardGpuDevice(device, 'editor');
    const broken = device.createRenderPipeline({ label: 'flock-integrate' } as GPURenderPipelineDescriptor);
    const healthy = device.createRenderPipeline({ label: 'compositor' } as GPURenderPipelineDescriptor);
    await flush();
    expect(uncaptured).toEqual([]);
    expect(isGpuPipelineFailed(broken)).toBe(true);
    encodeFrame(device, [broken, healthy]);
    expect(calls).toEqual(['setPipeline compositor', 'setBindGroup compositor-group', 'draw', 'end']);
    expect(getGpuPipelineFailures()).toEqual([expect.objectContaining({
      feature: 'Flocking simulation', label: 'flock-integrate', kind: 'internal', message: DRIVER_FAILURE, source: 'editor',
    })]);
  });

  it('keeps healthy pipelines drawing on a guarded device', () => {
    const { device, calls } = fakeDevice(/never/);
    guardGpuDevice(device, 'editor');
    const pipeline = device.createRenderPipeline({ label: 'compositor' } as GPURenderPipelineDescriptor);
    encodeFrame(device, [pipeline]);
    expect(calls).toEqual(['setPipeline compositor', 'setBindGroup compositor-group', 'draw', 'end']);
  });

  it('reuses the guard verdict instead of opening competing error scopes', async () => {
    const { device } = fakeDevice(/effect-voxel/);
    guardGpuDevice(device, 'editor');
    const { settled } = createCheckedPipeline(device, () => device.createRenderPipeline({ label: 'effect-voxel-relief-pipeline' } as GPURenderPipelineDescriptor));
    expect(device.pushErrorScope).toHaveBeenCalledTimes(3);
    await expect(settled).resolves.toEqual({ kind: 'internal', message: DRIVER_FAILURE });
  });

  it('scopes a single pipeline itself on an unguarded device', async () => {
    const { device, uncaptured } = fakeDevice(/hap/);
    const { settled } = createCheckedPipeline(device, () => device.createComputePipeline({ label: 'hap-encode-bc1' } as GPUComputePipelineDescriptor));
    await expect(settled).resolves.toEqual({ kind: 'internal', message: DRIVER_FAILURE });
    expect(uncaptured).toEqual([]);
  });

  it('records the verdict of an unguarded checked pipeline for later waiters', async () => {
    const { device } = fakeDevice(/hap/);
    const { pipeline } = createCheckedPipeline(device, () => device.createComputePipeline({ label: 'hap-encode-bc1' } as GPUComputePipelineDescriptor));
    await expect(gpuPipelineSettled(pipeline)).resolves.toEqual({ kind: 'internal', message: DRIVER_FAILURE });
  });

  it('reports a pipeline with a declared fallback once as a non-fatal production error without a skipped-feature notice', async () => {
    const reported: LogEntry[] = [];
    setLoggerDiagnosticErrorSink(entry => { reported.push(entry); });
    try {
      const { device, calls } = fakeDevice(/flock-fluidP2GBlock/);
      guardGpuDevice(device, 'editor');
      const block = device.createComputePipeline({ label: 'flock-fluidP2GBlock' } as GPUComputePipelineDescriptor);
      markGpuPipelineFallback(block, 'the reference transfer runs instead');
      const again = device.createComputePipeline({ label: 'flock-fluidP2GBlock' } as GPUComputePipelineDescriptor);
      markGpuPipelineFallback(again, 'the reference transfer runs instead');
      await flush();
      expect(isGpuPipelineFailed(block)).toBe(true);
      expect(getGpuPipelineFailures()).toEqual([]);
      const pass = device.createCommandEncoder().beginComputePass();
      pass.setPipeline(block);
      pass.dispatchWorkgroups(1);
      pass.end();
      expect(calls).toEqual(['end']);
      // Only ERROR entries reach the production diagnostics feed.
      expect(reported).toHaveLength(1);
      expect(reported[0].message).toMatch(new RegExp(`^${GPU_PIPELINE_FALLBACK_MESSAGE}: .*flock-fluidP2GBlock.*the reference transfer runs instead.*Non-fatal`));
      expect(reported[0].data).toMatchObject({ label: 'flock-fluidP2GBlock', message: DRIVER_FAILURE });
      expect(classifyRuntimeFailure({ message: reported[0].message, stage: 'logger_error' })).toBe('gpu_pipeline_fallback');
    } finally {
      setLoggerDiagnosticErrorSink(null);
    }
  });

  it('reports a declared fallback from an unguarded checked pipeline too', async () => {
    const reported: LogEntry[] = [];
    setLoggerDiagnosticErrorSink(entry => { reported.push(entry); });
    try {
      const { device } = fakeDevice(/flock-unguarded-block/);
      const { pipeline, settled } = createCheckedPipeline(device, () => device.createComputePipeline({ label: 'flock-unguarded-block' } as GPUComputePipelineDescriptor));
      markGpuPipelineFallback(pipeline, 'the reference transfer runs instead');
      await settled;
      expect(reported.map(entry => entry.message)).toEqual([expect.stringMatching(/^GPU pipeline fallback used: .*flock-unguarded-block/)]);
      expect(getGpuPipelineFailures()).toEqual([]);
    } finally {
      setLoggerDiagnosticErrorSink(null);
    }
  });

  // Production (Safari): WebKit's message starts with the whole generated Metal source,
  // so the capped diagnostic never reached the compiler error.
  it('keeps the compiler error lines of a huge WebKit shader message', () => {
    const message = `Failed to compile the shader source, generated metal:\n${'struct PackedVec3 { float x; };\n'.repeat(500)}program_source:812:21: error: no matching function for call to 'foo'\nprogram_source:900:3: note: candidate`;
    const condensed = condenseGpuPipelineMessage(message);
    expect(condensed.length).toBeLessThan(1300);
    expect(condensed).toContain('Failed to compile the shader source');
    expect(condensed).toContain("program_source:812:21: error: no matching function for call to 'foo'");
    expect(condensed).not.toContain('PackedVec3');
    expect(condenseGpuPipelineMessage(DRIVER_FAILURE)).toBe(DRIVER_FAILURE);
  });

  it('names features in the preview notice by their pipeline labels', () => {
    expect(gpuFeatureName('effect-voxel-relief-pipeline')).toBe('Voxel Relief');
    expect(gpuFeatureName('flock-render')).toBe('Flocking simulation');
    expect(gpuFeatureName('gaussian-splat-sort')).toBe('Gaussian splats');
    expect(gpuFeatureName('effect-glow-pipeline')).toBe('Effect');
    expect(gpuFeatureName('mystery')).toBe('GPU rendering');
  });

  it('falls back to the CPU HAP encoder instead of exporting empty blocks', async () => {
    const { device } = fakeDevice(/hap-encode/);
    Object.assign(device, {
      createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }),
      createBuffer: () => ({ destroy: vi.fn() }),
      queue: { writeBuffer: vi.fn() },
      destroy: vi.fn(),
    });
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }) } });
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 1, TEXTURE_BINDING: 2, RENDER_ATTACHMENT: 4 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8, UNIFORM: 16 });
    try {
      await expect(HapGpuBlockEncoder.create('bc1', 8, 8)).resolves.toBeNull();
      expect(device.destroy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
