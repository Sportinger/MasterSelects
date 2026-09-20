import { afterEach, describe, expect, it, vi } from 'vitest';
import { EffectPipelineCache } from '../../src/effects/EffectPipelineCache';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { invert } from '../../src/effects/color/invert';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';

describe('compiled image graph pipeline ownership', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders two graph variants in their first frame without replacing each other while validation is pending', async () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    let resolve!: (value: null) => void;
    const pending = new Promise<null>(done => { resolve = done; });
    const createRenderPipeline = vi.fn(() => ({}));
    const device = { createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})), createRenderPipeline,
      pushErrorScope: vi.fn(), popErrorScope: vi.fn(() => pending) } as unknown as GPUDevice;
    const cache = new EffectPipelineCache(device, vi.fn());
    const graph = createDefaultInvertImageGraph();
    graph.nodes.find(node => node.id === 'one')!.constants = { value: 0.5 };
    const defaults = imageGraphDefinition({ type: 'invert', params: {} }, invert as FullscreenEffectDefinition);
    const edited = imageGraphDefinition({ type: 'invert', params: {}, operatorGraph: graph }, invert as FullscreenEffectDefinition);
    cache.ensure(defaults.id, defaults, true);
    const first = cache.getPipeline(defaults.id);
    cache.ensure(edited.id, edited, true);
    expect(first).toBeDefined();
    expect(cache.getPipeline(edited.id)).toBeDefined();
    expect(cache.getPipeline(edited.id)).not.toBe(first);
    cache.ensure(defaults.id, defaults, true);
    expect(cache.getPipeline(defaults.id)).toBe(first);
    expect(createRenderPipeline).toHaveBeenCalledTimes(2);
    resolve(null); await pending;
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
