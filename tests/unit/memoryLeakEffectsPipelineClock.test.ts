import { afterEach, describe, expect, it, vi } from 'vitest';
import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { memoryLeak } from '../../src/effects/generate/memoryLeak';
import type { ByteTextureContext, ByteTextureProvider } from '../../src/effects/_shared/byteTexture';

describe('Memory Leak EffectsPipeline clock adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes the provider clock and isolates byte textures by scope', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const contexts: ByteTextureContext[] = [], textureLabels: string[] = [];
    const provider: ByteTextureProvider = (_params, context) => {
      contexts.push(context);
      return { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]), version: `frame:${context.timelineTimeSeconds}` };
    };
    const originalProvider = memoryLeak.byteTexture;
    (memoryLeak as { byteTexture?: ByteTextureProvider }).byteTexture = provider;
    const draw = vi.fn();
    const device = {
      limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => undefined),
      createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createComputePipeline: vi.fn(() => ({})), createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture: vi.fn(({ label }: GPUTextureDescriptor) => {
        textureLabels.push(String(label));
        return { createView: vi.fn(() => ({})), destroy: vi.fn() };
      }),
      queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
    } as unknown as GPUDevice;
    const encoder = { beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end: vi.fn() })) } as unknown as GPUCommandEncoder;
    const pipeline = new EffectsPipeline(device);
    pipeline.prewarmEffect('memory-leak');
    const effect = { id: 'memory-a', type: 'memory-leak', name: 'Memory Leak', enabled: true, params: {} };
    const render = (time: number, frameRate: number, scopeId: string) => pipeline.applyEffects(
      encoder, [effect], {} as GPUSampler, {} as GPUTextureView, {} as GPUTextureView, {} as GPUTextureView, {} as GPUTextureView,
      16, 9, undefined, undefined, undefined, time, undefined, { frameRate, scopeId },
    );
    try {
      render(.5, 60, 'nested:a');
      render(.5, Number.NaN, '');
      render(.5, 60, 'nested:b');
      expect(contexts).toEqual([
        { effectInstanceId: 'memory-a', width: 16, height: 9, timelineTimeSeconds: .5, frameRate: 60, scopeId: 'nested:a' },
        { effectInstanceId: 'memory-a', width: 16, height: 9, timelineTimeSeconds: .5, frameRate: 30, scopeId: 'legacy' },
        { effectInstanceId: 'memory-a', width: 16, height: 9, timelineTimeSeconds: .5, frameRate: 60, scopeId: 'nested:b' },
      ]);
      const byteTextureLabels = textureLabels.filter(label => label.startsWith('effect-bytes-'));
      expect(byteTextureLabels).toHaveLength(3);
      expect(byteTextureLabels).toEqual(expect.arrayContaining([
        expect.stringContaining('["nested:a","memory-a","memory-window:memory"]-frame:0.5'),
        expect.stringContaining('["legacy","memory-a","memory-window:memory"]-frame:0.5'),
        expect.stringContaining('["nested:b","memory-a","memory-window:memory"]-frame:0.5'),
      ]));
      expect(draw).toHaveBeenCalledTimes(3);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      pipeline.destroy();
      (memoryLeak as { byteTexture?: ByteTextureProvider }).byteTexture = originalProvider;
      errorSpy.mockRestore();
    }
  });
});
