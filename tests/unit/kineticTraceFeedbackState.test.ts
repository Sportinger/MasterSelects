import { afterEach, describe, expect, it, vi } from 'vitest';

import { EffectsPipeline } from '../../src/effects/EffectsPipeline';

// Motion Trails feeds back its trace at Amount 1 (feedbackStateParams): the engine draws that state,
// keeps it, and only then draws the visible output with the real Amount.
describe('EffectsPipeline feedback state pass (Motion Trails)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
    const operations: string[] = [];
    const amounts: number[] = [];
    const device = {
      limits: { maxSampledTexturesPerShaderStage: 16 },
      createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createComputePipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})), createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createSampler: vi.fn(() => ({})),
      createTexture: vi.fn(({ label }: { label: string }) => ({ label, view: { label: `${label}-view` }, destroy: vi.fn(), createView() { return this.view; } })),
      queue: { writeBuffer: vi.fn((_buffer: unknown, _offset: number, data: ArrayBuffer) => {
        const floats = new Float32Array(data);
        if (floats.length === 20) amounts.push(+floats[2].toFixed(3));
      }) },
      lost: new Promise(() => undefined),
    } as unknown as GPUDevice;
    const encoder = {
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const attachment = descriptor.colorAttachments[0] as GPURenderPassColorAttachment;
        operations.push(attachment.clearValue ? 'clear' : 'render');
        return { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
      }),
      copyTextureToTexture: vi.fn((source: GPUImageCopyTexture) => {
        operations.push(`copy:${(source.texture as unknown as { label: string }).label}`);
      }),
    } as unknown as GPUCommandEncoder;
    const pipeline = new EffectsPipeline(device);
    pipeline.prewarmEffect('kinetic-trace');
    const ping = { label: 'ping' } as unknown as GPUTexture, pong = { label: 'pong' } as unknown as GPUTexture;
    const pingView = { label: 'ping-view' } as unknown as GPUTextureView, pongView = { label: 'pong-view' } as unknown as GPUTextureView;
    const render = (params: Record<string, unknown>) => pipeline.applyEffects(encoder,
      [{ id: 'trail', type: 'kinetic-trace', name: 'Motion Trails', enabled: true, params }],
      {} as GPUSampler, {} as GPUTextureView, pingView, pingView, pongView, 16, 9, ping, pong, undefined, 0,
      { scopeId: 'a', eventRevision: 0, ownerRevision: 1 });
    return { operations, amounts, render };
  };

  it('keeps the unmixed trace and draws the output with Amount after it', () => {
    const { operations, amounts, render } = setup();
    render({ trail: 0.9, amount: 0.4, tint: 0, softness: 1 });
    expect(operations).toEqual(['clear', 'render', 'copy:ping', 'render']);
    expect(amounts).toEqual([0.4, 1]);
  });

  it('feeds back the mixed output of a Motion Trails saved before Length, as it always did', () => {
    const { operations, amounts, render } = setup();
    render({ amount: 0.8, color: '#36f59a' });
    expect(operations).toEqual(['clear', 'render', 'copy:ping']);
    expect(amounts).toEqual([0.8]);
  });
});
