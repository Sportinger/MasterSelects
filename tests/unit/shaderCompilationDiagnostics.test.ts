import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportShaderCompilation } from '../../src/engine/core/shaderCompilationDiagnostics';
import { ptShaderModule } from '../../src/engine/native3d/pathtrace/ptCompute';
import { createCheckedModule } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { DenseTerrainPipeline } from '../../src/effects/tracking/DenseTerrainPipeline';
import { createCableSceneResources } from '../../src/engine/native3d/passes/faceCablePass/resources';

const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => logs } }));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('shader compilation diagnostics during GPU loss', () => {
  it.each(['reject', 'throw'] as const)('handles a diagnostic query that will %s while retaining its reason', async mode => {
    const reason = new DOMException('Instance dropped error in getCompilationInfo', 'OperationError');
    const module = { getCompilationInfo() {
      if (mode === 'throw') throw reason;
      return Promise.reject(reason);
    } } as GPUShaderModule;
    await expect(reportShaderCompilation(module, 'PathTrace', 'test shader')).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith('Shader compilation diagnostics unavailable for test shader', reason);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('preserves real shader errors with locations and source lines', async () => {
    const module = { getCompilationInfo: async () => ({ messages: [
      { type: 'warning', lineNum: 1, linePos: 1, message: 'unused' },
      { type: 'error', lineNum: 2, linePos: 3, message: 'unknown identifier' },
    ] }) } as GPUShaderModule;
    await reportShaderCompilation(module, 'PathTrace', 'material', 'first\n  invalid();');
    expect(logs.error).toHaveBeenCalledWith('Shader compilation failed for material', ['2:3 unknown identifier | invalid();']);
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('does not turn valid shaders into errors and reports unavailable diagnostics', async () => {
    await reportShaderCompilation({ getCompilationInfo: async () => ({ messages: [] }) } as unknown as GPUShaderModule, 'Test', 'valid');
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
    await reportShaderCompilation({} as GPUShaderModule, 'Test', 'missing');
    expect(logs.warn).toHaveBeenCalledWith('Shader compilation diagnostics unavailable for missing');
  });

  it.each([
    ['path tracer', (device: GPUDevice) => ptShaderModule(device, 'path shader', 'code'), 1],
    ['flock', (device: GPUDevice) => createCheckedModule(device, 'code', 'flock shader'), 1],
    ['terrain', (device: GPUDevice) => new DenseTerrainPipeline(device), 2],
    ['face cables', (device: GPUDevice) => createCableSceneResources(device), 1],
  ] as const)('keeps %s initialization synchronous when diagnostics reject later', async (_name, initialize, count) => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
    let reject!: (reason: unknown) => void;
    const pending = new Promise<GPUCompilationInfo>((_resolve, fail) => { reject = fail; });
    const module = { getCompilationInfo: vi.fn(() => pending) } as unknown as GPUShaderModule;
    const device = {
      createShaderModule: vi.fn(() => module), createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({})), createSampler: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    expect(initialize(device)).toBeTruthy();
    const reason = new DOMException('Instance dropped error in getCompilationInfo', 'OperationError');
    reject(reason);
    await vi.waitFor(() => expect(logs.warn).toHaveBeenCalledTimes(count));
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('keeps the path-tracer cache scoped to the device', async () => {
    const module = { getCompilationInfo: vi.fn(async () => ({ messages: [] })) } as unknown as GPUShaderModule;
    const first = { createShaderModule: vi.fn(() => module) } as unknown as GPUDevice;
    const second = { createShaderModule: vi.fn(() => module) } as unknown as GPUDevice;
    expect(ptShaderModule(first, 'first', 'code')).toBe(module);
    expect(ptShaderModule(first, 'cached', 'code')).toBe(module);
    ptShaderModule(second, 'replacement device', 'code');
    expect(first.createShaderModule).toHaveBeenCalledOnce();
    expect(second.createShaderModule).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
});
