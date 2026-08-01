import { describe, expect, it, vi } from 'vitest';

import type { LayerRenderData } from '../../src/engine/core/types';
import type { Compositor } from '../../src/engine/render/Compositor';
import { compositeNestedLayers } from '../../src/engine/render/nestedComp/compositeNestedLayers';
import type { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';

describe('compositeNestedLayers motion-adjustment parity', () => {
  it('delegates the ordered stack and nested effect targets to the central compositor', () => {
    const pingView = { label: 'ping-view' } as unknown as GPUTextureView;
    const pongView = { label: 'pong-view' } as unknown as GPUTextureView;
    const pingTexture = { label: 'ping-texture' } as unknown as GPUTexture;
    const pongTexture = { label: 'pong-texture' } as unknown as GPUTexture;
    const effectView = { label: 'effect-view' } as unknown as GPUTextureView;
    const effectView2 = { label: 'effect-view-2' } as unknown as GPUTextureView;
    const effectTexture = { label: 'effect-texture' } as unknown as GPUTexture;
    const effectTexture2 = { label: 'effect-texture-2' } as unknown as GPUTexture;
    const layerData = [
      { layer: { id: 'bottom', source: { type: 'image' } } },
      { layer: { id: 'adjustment', source: { type: 'motion-adjustment' } } },
      { layer: { id: 'top', source: { type: 'image' } } },
    ] as unknown as LayerRenderData[];
    const composite = vi.fn(() => ({
      finalView: pongView,
      usedPing: true,
      layerCount: layerData.length,
    }));

    const result = compositeNestedLayers({
      layerData,
      device: {} as GPUDevice,
      compositionId: 'nested-comp',
      width: 1280,
      height: 720,
      commandEncoder: {} as GPUCommandEncoder,
      sampler: {} as GPUSampler,
      compositor: { composite } as unknown as Compositor,
      maskTextureManager: {} as MaskTextureManager,
      skipEffects: false,
      texturePair: { pingTexture, pongTexture },
      effectTexturePair: {
        pingTexture: effectTexture,
        pongTexture: effectTexture2,
      },
      nestedPingView: pingView,
      nestedPongView: pongView,
      effectTempView: effectView,
      effectTempView2: effectView2,
      motionTime: 2.5,
      particleQuality: 'export',
      resourceNamespace: 'nested:nested-comp:occurrence-a',
    });

    expect(composite).toHaveBeenCalledOnce();
    expect(composite.mock.calls[0]?.[0]).toBe(layerData);
    expect(composite.mock.calls[0]?.[2]).toMatchObject({
      pingView,
      pongView,
      outputWidth: 1280,
      outputHeight: 720,
      skipEffects: false,
      effectTempTexture: effectTexture,
      effectTempView: effectView,
      effectTempTexture2: effectTexture2,
      effectTempView2: effectView2,
      motionTime: 2.5,
      particleQuality: 'export',
      resourceNamespace: 'nested:nested-comp:occurrence-a',
    });
    expect(result).toBe(pongTexture);
  });
});
