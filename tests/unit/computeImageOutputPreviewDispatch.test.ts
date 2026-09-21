import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  encode: vi.fn((options: { computeImagePlan?: { passthrough: boolean } }) => !options.computeImagePlan?.passthrough),
  outputCapture: vi.fn(), operatorCapture: vi.fn(),
}));

vi.mock('../../src/effects/ComputeEffectRuntime', () => ({
  ComputeEffectRuntime: class {
    encode = mocks.encode;
    clear() {}
  },
}));
vi.mock('../../src/services/nodePreview/computeImageOperatorPreviews', () => ({
  captureComputeImageOperatorPreviews: mocks.operatorCapture,
  captureComputeImageOutputPreviews: mocks.outputCapture,
}));

import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { connectEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';

describe('compute image final-output preview dispatch', () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('captures rendered output and direct passthrough input without an extra compute or swap', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2, COMPUTE: 4 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}),
      queue: { writeBuffer: vi.fn() }, createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({})), createComputePipeline: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })) } as unknown as GPUDevice;
    const pipeline = new EffectsPipeline(device), encoder = {} as GPUCommandEncoder, sampler = {} as GPUSampler;
    const input = { id: 'input' } as unknown as GPUTextureView, output = { id: 'output' } as unknown as GPUTextureView;
    const ping = { id: 'ping' } as unknown as GPUTextureView, pong = { id: 'pong' } as unknown as GPUTextureView;
    const effect = { id: 'pixel-sort-fx', type: 'pixel-sort', name: 'Pixel Sort', enabled: true,
      params: {}, operatorGraph: createDefaultPixelSortGraph() };

    const rendered = pipeline.applyEffects(encoder, [effect], sampler, input, output, ping, pong, 16, 9);
    expect(rendered).toEqual({ finalView: output, swapped: true });
    expect(mocks.encode).toHaveBeenCalledTimes(1);
    expect(mocks.outputCapture).toHaveBeenLastCalledWith(expect.objectContaining({ effect, view: output }));

    const directGraph = connectEffectGraph(createDefaultPixelSortGraph(), {
      id: 'direct-output', from: 'frame', output: 'image', to: 'output', input: 'image',
    });
    const directEffect = { ...effect, id: 'direct-pixel-sort', operatorGraph: directGraph };
    const passthrough = pipeline.applyEffects(encoder, [directEffect], sampler, input, output, ping, pong, 16, 9);
    expect(passthrough).toEqual({ finalView: input, swapped: false });
    expect(mocks.encode).toHaveBeenCalledTimes(2);
    expect(mocks.outputCapture).toHaveBeenLastCalledWith(expect.objectContaining({ effect: directEffect, view: input }));
    expect(mocks.operatorCapture).not.toHaveBeenCalled();
  });
});
