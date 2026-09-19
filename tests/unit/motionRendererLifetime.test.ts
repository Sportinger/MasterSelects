import { afterEach, describe, expect, it, vi } from 'vitest';

import { MotionRenderer } from '../../src/engine/motion/MotionRenderer';
import { createMotionFrameRuntimeAdmission } from '../../src/engine/motion/MotionFrameRuntime';
import { getMotionRendererDiagnostics, resetMotionRendererDiagnostics } from '../../src/engine/motion/MotionDiagnostics';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import type { Layer } from '../../src/types/layers';

describe('MotionRenderer cache lifetime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMotionRendererDiagnostics();
  });

  it('retains current-frame caches and evicts them after an unused frame', () => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, VERTEX: 2, COPY_DST: 4, STORAGE: 8 });

    const textures: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
    const device = {
      limits: { maxTextureDimension2D: 8192 },
      queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
      createBindGroupLayout: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createSampler: vi.fn(() => ({})),
      createTexture: vi.fn(() => {
        const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
        textures.push(texture);
        return texture;
      }),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    const pass = {
      setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(), draw: vi.fn(), end: vi.fn(),
    };
    const encoder = { beginRenderPass: vi.fn(() => pass) } as unknown as GPUCommandEncoder;
    const layer: Layer = {
      id: 'nested-occurrence-a',
      sourceClipId: 'nested-motion-a',
      name: 'Shape',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'motion', motion: createDefaultMotionLayerDefinition('shape') },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'nested-preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [layer],
    });
    const renderer = new MotionRenderer(device);

    renderer.renderLayer(layer, encoder, admission);
    const motionTexture = textures.at(-1)!;
    renderer.cleanupPendingCaches();
    expect(motionTexture.destroy).not.toHaveBeenCalled();
    expect(getMotionRendererDiagnostics().cacheCount).toBe(1);

    renderer.cleanupPendingCaches();
    expect(motionTexture.destroy).toHaveBeenCalledOnce();
    expect(getMotionRendererDiagnostics().cacheCount).toBe(0);

    renderer.destroy();
  });
});
