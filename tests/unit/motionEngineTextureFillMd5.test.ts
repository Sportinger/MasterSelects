import { describe, expect, it, vi } from 'vitest';
import { createDefaultMotionLayerDefinition, type TextureFillAppearance } from '../../src/types/motionDesign';
import {
  MOTION_APPEARANCE_META_OFFSET,
  createMotionUniformArray,
} from '../../src/engine/motion/MotionBuffers';
import { getMotionRenderSize } from '../../src/engine/motion/MotionTypes';
import {
  MotionTextureAcquisition,
  buildTextureReuseKey,
  resolveTextureFillUv,
} from '../../src/engine/motion/media/motionTextureAcquisition';

function textureFill(overrides: Partial<TextureFillAppearance> = {}): TextureFillAppearance {
  return {
    id: 'texture-fill',
    kind: 'texture-fill',
    name: 'Texture Fill',
    visible: true,
    opacity: 1,
    mediaFileId: 'image-1',
    fit: 'contain',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    },
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Motion MD5 still texture fills', () => {
  it('caches by frozen media reuse key and explicitly releases GPU textures', async () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    const gpuTexture = { createView: vi.fn(() => ({ kind: 'view' })), destroy: vi.fn() };
    const copyExternalImageToTexture = vi.fn();
    const decodeImage = vi.fn(async () => ({ width: 40, height: 20, close: vi.fn() }));
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const acquisition = new MotionTextureAcquisition({
      createTexture: vi.fn(() => gpuTexture),
      queue: { copyExternalImageToTexture },
    } as unknown as GPUDevice, {
      findMediaFile: () => ({ id: 'image-1', type: 'image', file, width: 40, height: 20 } as never),
      resolveFile: vi.fn(async () => file),
      decodeImage,
    });
    const fill = textureFill();

    expect(acquisition.acquire(fill, vi.fn()).status).toBe('pending');
    expect(acquisition.acquire(fill, vi.fn()).status).toBe('pending');
    await flush();

    const ready = acquisition.acquire(fill, vi.fn());
    expect(ready.status).toBe('ready');
    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(copyExternalImageToTexture).toHaveBeenCalledTimes(1);
    const key = buildTextureReuseKey(
      'motion-media-source/v1:image:image-1',
      fill,
      { width: 40, height: 20 },
    );
    expect(ready.reuseKey).toBe(key);
    acquisition.release(key);
    expect(gpuTexture.destroy).toHaveBeenCalledTimes(1);
  });

  it('packs texture kind, fit, transform, and slot zero into appearance uniforms', () => {
    const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 200, h: 100 } });
    const fill = textureFill({
      fit: 'cover',
      transform: {
        position: { x: 0.25, y: -0.5 },
        scale: { x: 2, y: 3 },
        rotation: 45,
      },
    });
    motion.appearance!.items = [fill];
    const uniforms = createMotionUniformArray(motion, getMotionRenderSize(motion), {
      activeAppearanceId: fill.id,
      sourceSize: { width: 300, height: 100 },
    });

    expect(Array.from(uniforms.slice(MOTION_APPEARANCE_META_OFFSET, MOTION_APPEARANCE_META_OFFSET + 4)))
      .toEqual([4, 1, 1, 0]);
    expect(Array.from(uniforms.slice(48, 52))).toEqual([2, 0, 3, 45]);
    expect(Array.from(uniforms.slice(80, 84))).toEqual([0.25, -0.5, 2, 3]);
  });

  it('mirrors contain, cover, stretch, and tile UV behavior without a GPU', () => {
    const base = {
      point: { x: 0.5, y: 0.1 },
      shapeSize: { width: 100, height: 100 },
      textureSize: { width: 200, height: 100 },
    };
    expect(resolveTextureFillUv({ ...base, appearance: textureFill({ fit: 'contain' }) }))
      .toMatchObject({ covered: false });
    expect(resolveTextureFillUv({ ...base, appearance: textureFill({ fit: 'cover' }) }))
      .toMatchObject({ covered: true });
    // Float math: assert UVs with tolerance instead of exact object equality.
    const stretch = resolveTextureFillUv({ ...base, appearance: textureFill({ fit: 'stretch' }) });
    expect(stretch.covered).toBe(true);
    expect(stretch.u).toBeCloseTo(0.5, 10);
    expect(stretch.v).toBeCloseTo(0.1, 10);
    expect(resolveTextureFillUv({
      ...base,
      point: { x: 1.25, y: -0.25 },
      appearance: textureFill({ fit: 'tile' }),
    })).toMatchObject({ u: 0.25, v: 0.75, covered: true });
  });

  it('keeps pending and missing media transparent while surfacing a diagnostic', async () => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
    const diagnostics: string[] = [];
    const acquisition = new MotionTextureAcquisition({
      createTexture: vi.fn(),
      queue: { copyExternalImageToTexture: vi.fn() },
    } as unknown as GPUDevice, {
      findMediaFile: () => undefined,
      onDiagnostic: (_code, message) => diagnostics.push(message),
    });
    const missing = acquisition.acquire(textureFill(), vi.fn());
    expect(missing.status).toBe('missing');
    expect(diagnostics[0]).toContain('unavailable');

    const motion = createDefaultMotionLayerDefinition('shape');
    const fill = textureFill();
    motion.appearance!.items = [fill];
    const uniforms = createMotionUniformArray(motion, getMotionRenderSize(motion), {
      activeAppearanceId: null,
    });
    expect(uniforms[MOTION_APPEARANCE_META_OFFSET + 1]).toBe(0);
    await flush();
  });
});
