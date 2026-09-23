import { describe, expect, it, vi } from 'vitest';

import { LayerSpaceEffectRenderer } from '../../src/engine/native3d/sceneRenderer/LayerSpaceEffectRenderer';
import type { ScenePlaneLayer } from '../../src/engine/scene/types';

describe('LayerSpaceEffectRenderer', () => {
  it('evaluates the analog stack into a plane texture before scene projection', () => {
    const previousUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: {
        TEXTURE_BINDING: 1,
        STORAGE_BINDING: 2,
        RENDER_ATTACHMENT: 4,
        COPY_SRC: 8,
      },
    });
    const destroyed: string[] = [];
    const device = {
      createTexture: vi.fn(({ label }: { label: string }) => ({
        label,
        createView: () => ({ label: `${label}-view` }),
        destroy: () => destroyed.push(label),
      })),
    } as unknown as GPUDevice;
    const effectsPipeline = {
      applyEffects: vi.fn((...call: unknown[]) => ({
        finalView: call[6],
        swapped: true,
      })),
    };
    const analogEffect = {
      id: 'analog-fx',
      name: 'Analog Signal Lab',
      type: 'analog-signal-lab',
      enabled: true,
      params: {},
    } as const;
    const layer = {
      kind: 'plane',
      layerId: 'plane-1',
      layerSpaceEffects: [analogEffect],
      mediaTime: 7.5,
      temporalSource: { mediaId: 'video', localTime: 1.5, duration: 10,
        inPoint: 3, outPoint: 13, speed: -1, speedKeyframes: [] },
      sourceMasks: [{ id: 'protection-mask' }],
    } as unknown as ScenePlaneLayer;
    const sourceView = { label: 'source-view' } as unknown as GPUTextureView;
    const renderer = new LayerSpaceEffectRenderer();

    try {
      const result = renderer.prepare({
        device,
        commandEncoder: {} as GPUCommandEncoder,
        effectsPipeline: effectsPipeline as never,
        sampler: {} as GPUSampler,
        timelineTimeSeconds: 2.25,
        effectRenderClock: { frameRate: 24, scopeId: 'export' },
        layers: [layer],
        targetKey: 'main',
        resolveSource: () => ({ view: sourceView, width: 640, height: 360 }),
      });

      expect(effectsPipeline.applyEffects).toHaveBeenCalledTimes(1);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[1]).toEqual([analogEffect]);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[3]).toBe(sourceView);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[7]).toBe(640);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[8]).toBe(360);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[12]).toBe(2.25);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[14]).toEqual({
        frameRate: 24, scopeId: JSON.stringify(['export', 'plane-1']),
      });
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[15]).toBe(layer.sourceMasks);
      expect(effectsPipeline.applyEffects.mock.calls[0]?.[16]).toBe(layer.temporalSource);
      expect(result.get('plane-1')).toEqual(expect.objectContaining({
        label: expect.stringContaining('pong-view'),
      }));

      renderer.prepare({
        device,
        commandEncoder: {} as GPUCommandEncoder,
        effectsPipeline: effectsPipeline as never,
        sampler: {} as GPUSampler,
        timelineTimeSeconds: 2.25,
        layers: [],
        targetKey: 'main',
        resolveSource: () => null,
      });
      expect(destroyed).toHaveLength(2);
    } finally {
      renderer.destroy();
      if (previousUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousUsage,
        });
      }
    }
  });
});
