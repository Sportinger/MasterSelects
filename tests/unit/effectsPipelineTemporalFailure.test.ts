import { afterEach, expect, it, vi } from 'vitest';
import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { TemporalEffectResources } from '../../src/effects/time/TemporalEffectResources';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { collectTemporalPreparations, getTemporalStatus } from '../../src/effects/time/temporalResourcePreparation';

function setup() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
  const device = {
    limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => undefined),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
    createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createComputePipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})), createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
  } as unknown as GPUDevice;
  const draw = vi.fn();
  const encoder = { beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end: vi.fn() })) } as unknown as GPUCommandEncoder;
  const pipeline = new EffectsPipeline(device);
  vi.spyOn(TemporalEffectResources.prototype, 'resolveNamed').mockReturnValue(true);
  const failure = new Error('Source frame cache exceeds the 640 MiB budget.');
  const resolve = vi.spyOn(TemporalEffectResources.prototype, 'resolveNative').mockImplementation(() => { throw failure; });
  const input = {} as GPUTextureView, output = {} as GPUTextureView;
  const slitScan = { id: 'failed-slit', type: 'slit-scan', name: 'Slit Scan', enabled: true, params: {} };
  const render = (effects = [slitScan]) => pipeline.applyEffects(encoder, effects, {} as GPUSampler, input, output,
    output, {} as GPUTextureView, 8, 8);
  return { pipeline, device, resolve, failure, render, input, output, draw, slitScan };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('resolves time-mask resources read by intermediate Slit Scan passes', () => {
  const { render, resolve, slitScan } = setup();
  resolve.mockReturnValue({ atlas: { view: {} as GPUTextureView, identity: 'atlas' },
    ages: { view: {} as GPUTextureView, identity: 'ages' } });
  vi.spyOn(ImageGraphPassRuntime.prototype, 'encode').mockReturnValue(true);
  render([{ ...slitScan, params: { mapSource: 'mask', mapAmount: 1, mapMaskId: 'test-mask' } }]);
  expect(vi.mocked(TemporalEffectResources.prototype.resolveNamed).mock.calls[0][1]).toContain('slit-scan:time-mask');
});

it('preserves the image when a temporal resource fails and continues rendering later effects', () => {
  const { render, input, output, slitScan, draw, resolve } = setup();
  expect(render()).toEqual({ finalView: input, swapped: false });
  expect(getTemporalStatus(slitScan.id)).toContain('Effect unavailable: Source frame cache');
  expect(resolve).toHaveBeenCalledOnce();
  expect(draw).not.toHaveBeenCalled();
  expect(render([slitScan, { id: 'invert', type: 'invert', name: 'Invert', enabled: true, params: {} }]).finalView).toBe(output);
  expect(draw).toHaveBeenCalled();
});

it('propagates the same failure during export so an effect cannot be silently omitted', () => {
  const { render, failure } = setup();
  const finish = collectTemporalPreparations();
  try { expect(() => render()).toThrow(failure); } finally { finish(); }
});

it('feeds the stabilized current frame to the graph and waits instead of mixing coordinate spaces', () => {
  const { render, resolve, slitScan, input } = setup();
  const stabilized = { ...slitScan, params: { stabilizationAssetId: 'track' } };
  resolve.mockReturnValue(undefined);
  expect(render([stabilized])).toEqual({ finalView: input, swapped: false });
  const current = {} as GPUTextureView;
  resolve.mockReturnValue({ current: { view: current, identity: 'current' }, atlas: { view: {} as GPUTextureView, identity: 'atlas' }, ages: { view: {} as GPUTextureView, identity: 'ages' } });
  const encode = vi.spyOn(ImageGraphPassRuntime.prototype, 'encode').mockImplementation(() => {});
  render([stabilized]);
  expect(encode).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'texture', view: current } }));
});

it('keeps stabilization when an edited graph outputs only the current frame', () => {
  const { render, device, resolve, slitScan, output } = setup();
  const current = {} as GPUTextureView;
  resolve.mockReturnValue({ current: { view: current, identity: 'current' },
    atlas: { view: {} as GPUTextureView, identity: 'atlas' }, ages: { view: {} as GPUTextureView, identity: 'ages' } });
  const effect = { ...slitScan, params: { stabilizationAssetId: 'track' }, operatorGraph: {
    version: 1 as const, schemaVersion: 1 as const, domain: 'image' as const,
    nodes: [
      { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ], edges: [{ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' }], layout: {},
  } };
  expect(render([effect]).finalView).toBe(output);
  expect(resolve).toHaveBeenCalledOnce();
  expect(device.createBindGroup).toHaveBeenCalledWith(expect.objectContaining({
    entries: expect.arrayContaining([{ binding: 1, resource: current }]),
  }));
});
