import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

vi.mock('../../src/services/operators/effectGraphOwner', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/operators/effectGraphOwner')>();
  const graph = {
    version: 1 as const, schemaVersion: 1 as const, domain: 'image' as const,
    nodes: [
      { id: 'history', operator: 'image.frame-history', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ],
    edges: [{ id: 'history-output', from: 'history', output: 'image', to: 'output', input: 'image' }],
    layout: {},
  };
  return {
    ...original,
    isImageGraphEffectType: (type: string) => type === 'acuarela' || original.isImageGraphEffectType(type),
    effectOperatorGraph: (effect: { type: string; operatorGraph?: EffectOperatorGraph }) => effect.type === 'acuarela' ? effect.operatorGraph ?? graph : original.effectOperatorGraph(effect as never),
    effectOperatorParams: (effect: { type: string; params: Record<string, unknown> }) => effect.type === 'acuarela' ? effect.params : original.effectOperatorParams(effect as never),
    effectOperatorCompileContext: (effect: { type: string }) => effect.type === 'acuarela' ? { allowFrameHistory: true } : original.effectOperatorCompileContext(effect),
  };
});

import { EffectsPipeline } from '../../src/effects/EffectsPipeline';

describe('image frame-history EffectsPipeline adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('binds committed history, holds it, promotes on advance, and writes only final output to current', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
    const operations: string[] = [], bindGroups: GPUBindGroupDescriptor[] = [];
    const createTexture = vi.fn(({ label }: GPUTextureDescriptor) => {
      const texture = { label: String(label), destroy: vi.fn(), createView: () => ({ label: `${String(label)}-view` }) };
      return texture;
    });
    const device = {
      limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => undefined), queue: { writeBuffer: vi.fn() },
      createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createComputePipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => { bindGroups.push(descriptor); return {}; }),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture,
    } as unknown as GPUDevice;
    const encoder = {
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const attachment = descriptor.colorAttachments[0] as GPURenderPassColorAttachment;
        operations.push(attachment.clearValue ? 'clear-history' : 'render-graph');
        return { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
      }),
      copyTextureToTexture: vi.fn((source: GPUImageCopyTexture, destination: GPUImageCopyTexture) => {
        operations.push(`copy:${String((source.texture as unknown as { label: string }).label)}->${String((destination.texture as unknown as { label: string }).label)}`);
      }),
    } as unknown as GPUCommandEncoder;
    const pipeline = new EffectsPipeline(device), ping = { label: 'ping' } as unknown as GPUTexture;
    const pong = { label: 'pong' } as unknown as GPUTexture, pingView = {} as GPUTextureView, pongView = {} as GPUTextureView;
    const effect = { id: 'history-fx', type: 'acuarela', name: 'History', enabled: true, params: {} };
    const render = (time: number) => pipeline.applyEffects(encoder, [effect], {} as GPUSampler, {} as GPUTextureView,
      pingView, pingView, pongView, 8, 8, ping, pong, undefined, time,
      { scopeId: 'scope-a', eventRevision: 0, ownerRevision: 1 });

    render(0);
    expect(operations).toEqual(['clear-history', 'render-graph', 'copy:ping->effect-feedback-current-acuarela-history-fx']);
    expect((bindGroups.at(-1)?.entries.find(entry => entry.binding === 3)?.resource as { label: string }).label)
      .toBe('effect-feedback-committed-acuarela-history-fx-view');
    operations.length = 0;
    render(0);
    expect(operations).toEqual(['render-graph', 'copy:ping->effect-feedback-current-acuarela-history-fx']);
    operations.length = 0;
    render(1);
    expect(operations.slice(0, 2)).toEqual([
      'copy:effect-feedback-current-acuarela-history-fx->effect-feedback-committed-acuarela-history-fx', 'render-graph',
    ]);

    const directGraph = {
      version: 1 as const, schemaVersion: 1 as const, domain: 'image' as const,
      nodes: [
        { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
        { id: 'unused-history', operator: 'image.frame-history', operatorVersion: 1, bindings: {} },
        { id: 'unused-atlas', operator: 'glyph.atlas', operatorVersion: 1, bindings: {
          rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight',
        } },
        { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
      ], edges: [{ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' }], layout: {},
    };
    const allocationsBefore = createTexture.mock.calls.length;
    pipeline.applyEffects(encoder, [{ ...effect, id: 'direct-fx', operatorGraph: directGraph }], {} as GPUSampler,
      {} as GPUTextureView, pingView, pingView, pongView, 8, 8, ping, pong, undefined, 0,
      { scopeId: 'scope-a', eventRevision: 0, ownerRevision: 1 });
    const newLabels = createTexture.mock.calls.slice(allocationsBefore)
      .map(call => String(call[0]?.label));
    expect(newLabels.some(label => label.includes('effect-feedback'))).toBe(false);
    expect(newLabels.some(label => label.includes('glyph-atlas'))).toBe(false);
  });
});
