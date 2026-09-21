import { afterEach, describe, expect, it, vi } from 'vitest';

import { EffectsPipeline, type EffectFrameHistoryContext } from '../../src/effects/EffectsPipeline';

describe('EffectsPipeline frame history', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('orders reset, hold, advance and isolated-scope feedback copies on the frame encoder', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
    const textures: Array<{ label: string; view: object; destroy: ReturnType<typeof vi.fn> }> = [];
    const createBindGroup = vi.fn((_descriptor: GPUBindGroupDescriptor) => ({}));
    const device = {
      limits: { maxSampledTexturesPerShaderStage: 16 },
      createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createComputePipeline: vi.fn(() => ({})), createBindGroup,
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture: vi.fn(({ label }: { label: string }) => {
        const texture = { label, view: { label: `${label}-view` }, destroy: vi.fn(), createView() { return this.view; } };
        textures.push(texture); return texture;
      }),
      queue: { writeBuffer: vi.fn() }, lost: new Promise(() => undefined),
    } as unknown as GPUDevice;
    const pipeline = new EffectsPipeline(device);
    pipeline.prewarmEffect('acuarela');
    const effect = { id: 'water', type: 'acuarela', name: 'Water', enabled: true, params: {} as Record<string, unknown> };
    const pingTexture = { label: 'ping' } as unknown as GPUTexture;
    const pongTexture = { label: 'pong' } as unknown as GPUTexture;
    const pingView = { label: 'ping-view' } as unknown as GPUTextureView;
    const pongView = { label: 'pong-view' } as unknown as GPUTextureView;
    const operations: string[] = [];
    const encoder = {
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const attachment = descriptor.colorAttachments[0] as GPURenderPassColorAttachment;
        operations.push(attachment.clearValue ? `clear:${String((attachment.view as { label?: string }).label)}` : 'render');
        return { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
      }),
      copyTextureToTexture: vi.fn((source: GPUImageCopyTexture, destination: GPUImageCopyTexture) => {
        operations.push(`copy:${(source.texture as unknown as { label: string }).label}->${(destination.texture as unknown as { label: string }).label}`);
      }),
    } as unknown as GPUCommandEncoder;
    const render = (time: number, history: EffectFrameHistoryContext) => pipeline.applyEffects(
      encoder, [effect], {} as GPUSampler, {} as GPUTextureView, pingView, pingView, pongView,
      16, 9, pingTexture, pongTexture, undefined, time, history,
    );

    render(0, { scopeId: 'a', eventRevision: 0, ownerRevision: 1 });
    expect(operations).toEqual([
      'clear:effect-feedback-committed-acuarela-water-view', 'render',
      'copy:ping->effect-feedback-current-acuarela-water',
    ]);
    operations.length = 0;
    render(0, { scopeId: 'a', eventRevision: 0, ownerRevision: 1 });
    expect(operations).toEqual(['render', 'copy:ping->effect-feedback-current-acuarela-water']);
    const latestEntries = createBindGroup.mock.calls.at(-1)?.[0].entries as GPUBindGroupEntry[];
    expect((latestEntries.find(entry => entry.binding === 3)?.resource as { label: string }).label)
      .toBe('effect-feedback-committed-acuarela-water-view');
    operations.length = 0;
    render(1, { scopeId: 'a', eventRevision: 0, ownerRevision: 1 });
    expect(operations).toEqual([
      'copy:effect-feedback-current-acuarela-water->effect-feedback-committed-acuarela-water',
      'render', 'copy:ping->effect-feedback-current-acuarela-water',
    ]);
    operations.length = 0;
    render(1, { scopeId: 'a', eventRevision: 1, discontinuity: 'seek', ownerRevision: 1 });
    expect(operations[0]).toBe('clear:effect-feedback-committed-acuarela-water-view');
    operations.length = 0;
    render(1, { scopeId: 'b', eventRevision: 1, ownerRevision: 1 });
    expect(operations[0]).toBe('clear:effect-feedback-committed-acuarela-water-view');
    expect(textures.filter(texture => texture.label.includes('effect-feedback-')).length).toBe(4);

    operations.length = 0;
    effect.params.historyLoop = 'continuous';
    render(4, { scopeId: 'continuous', eventRevision: 1, ownerRevision: 1 });
    operations.length = 0;
    render(0, { scopeId: 'continuous', eventRevision: 2, discontinuity: 'loop', ownerRevision: 1 });
    expect(operations[0]).toBe('copy:effect-feedback-current-acuarela-water->effect-feedback-committed-acuarela-water');
    operations.length = 0;
    render(0, { scopeId: 'continuous', eventRevision: 2, discontinuity: 'loop', ownerRevision: 1 });
    expect(operations[0]).toBe('render');
  });
});
