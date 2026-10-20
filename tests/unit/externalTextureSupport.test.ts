import { describe, expect, it, vi } from 'vitest';

// Firefox 157 exposes WebGPU without importExternalTexture; every texture_external
// shader and externalTexture layout entry raised uncaptured validation errors
// ("FeaturesWGPU(EXTERNAL_TEXTURE) are required but not enabled on the device").
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });

const { createCompositorPipelineResources } = await import('../../src/engine/pipeline/compositor/pipelineResources');
const { supportsExternalTextures } = await import('../../src/engine/texture/externalTextureSupport');

function fakeDevice(external: boolean) {
  const shaders: string[] = [];
  const layouts: GPUBindGroupLayoutDescriptor[] = [];
  const device = {
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => { layouts.push(descriptor); return {}; },
    createShaderModule: (descriptor: GPUShaderModuleDescriptor) => { shaders.push(descriptor.code); return {}; },
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    ...(external ? { importExternalTexture: () => ({}) } : {}),
  } as unknown as GPUDevice;
  return { device, shaders, layouts };
}

describe('external texture support', () => {
  it('detects devices without zero-copy video import', () => {
    expect(supportsExternalTextures(fakeDevice(true).device)).toBe(true);
    expect(supportsExternalTextures(fakeDevice(false).device)).toBe(false);
  });

  it('creates no external-texture shaders or layouts on such devices', () => {
    const { device, shaders, layouts } = fakeDevice(false);
    const resources = createCompositorPipelineResources(device);
    expect(resources.external).toBeNull();
    expect(resources.compositePipeline).toBeTruthy();
    expect(resources.copyPipeline).toBeTruthy();
    expect(shaders.some(code => code.includes('texture_external'))).toBe(false);
    expect(layouts.some(layout => [...layout.entries].some(entry => 'externalTexture' in entry))).toBe(false);
  });

  it('keeps the zero-copy pipelines where external textures exist', () => {
    const { device, shaders } = fakeDevice(true);
    const resources = createCompositorPipelineResources(device);
    expect(resources.external?.externalCopyPipelines.size).toBe(4);
    expect(shaders.some(code => code.includes('texture_external'))).toBe(true);
  });
});
