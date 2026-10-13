import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/engine/core/types';
import type { LayerCollectorDeps } from '../../src/engine/render/LayerCollector';
import { collectProviderFrame } from '../../src/engine/render/layerCollector/webCodecsProviderFrameCollector';
import { getVideoFrameEffectSourceRotation } from '../../src/engine/render/externalEffectSourceOrientation';

describe('rotated codec frames in the preview compositor', () => {
  it.each([90, 270] as const)('keeps %s degree frame orientation and portrait dimensions through collection', rotation => {
    const frame = { timestamp: 0, displayWidth: 3840, displayHeight: 2160 } as VideoFrame;
    const provider = { getCurrentFrame: () => frame, getSourceRotationDegrees: () => rotation,
      getFrameRate: () => 30, getDebugInfo: () => ({}), currentTime: 0 } as any;
    const layer = { id: 'portrait', source: { type: 'video', webCodecsPlayer: provider, mediaTime: 0 } } as Layer;
    const result = collectProviderFrame({ layer, frameProvider: provider, clipProvider: provider,
      providerKey: 'hevc', sourceVideo: undefined, layerReuseKey: 'portrait', canReuseLastFrame: false,
      frameProviderStable: true, holdingFrame: false, allowPendingScrubFrame: false, isDragging: false,
      deps: { isPlaying: false, textureManager: { importVideoTexture: () => ({}) } } as unknown as LayerCollectorDeps,
      context: { status: { setDecoder: vi.fn(), setWebCodecsInfo: vi.fn(), markHasVideo: vi.fn() } as any,
        setCollectorState: vi.fn(), setLastSuccessfulVideoProviderKey: vi.fn(), tryPlaybackHtmlVideoFallback: () => null },
    });
    expect(result).toMatchObject({ sourceWidth: 2160, sourceHeight: 3840 });
    expect(result!.layer.source!.videoFrame).toBe(frame);
    expect(getVideoFrameEffectSourceRotation(result!.layer)).toBe(rotation);
    // The render snapshot borrows the frame; durable input is never mutated.
    expect(layer.source!.videoFrame).toBeUndefined();
  });
});
