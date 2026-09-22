import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';
import type { ClipMask } from '../../src/types/masks';
import { createMaskTextureRasterKey, generateMaskTexture } from '../../src/utils/maskRenderer';

function createMask(ids = ['a', 'b', 'c']): ClipMask {
  return {
    id: 'mask-id',
    name: 'Mask',
    vertices: [
      { id: ids[0], x: 0.1, y: 0.2, handleIn: { x: 0, y: 0 }, handleOut: { x: 0.05, y: 0 } },
      { id: ids[1], x: 0.8, y: 0.2, handleIn: { x: -0.05, y: 0 }, handleOut: { x: 0, y: 0 } },
      { id: ids[2], x: 0.5, y: 0.9, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
    ],
    closed: true,
    opacity: 1,
    feather: 2,
    edgeFeathers: { [`${ids[0]}->${ids[1]}`]: 3 },
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0, y: 0 },
    rotation: 0,
    enabled: true,
    visible: true,
  };
}

function createManager(): MaskTextureManager {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  const device = {
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({} as GPUTextureView)),
      destroy: vi.fn(),
    })),
    queue: { writeTexture: vi.fn() },
  } as unknown as GPUDevice;
  return new MaskTextureManager(device);
}

function createImageData(width = 16, height = 16): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nested mask raster cache', () => {
  it('keeps effect-only masks out of clip alpha while retaining an explicit effect raster identity', () => {
    const mask = createMask();
    const original = createMaskTextureRasterKey([mask], 16, 16);
    mask.compositeEnabled = false;
    expect(generateMaskTexture([mask], 16, 16)).toBeNull();
    expect(createMaskTextureRasterKey([mask], 16, 16)).toBe(createMaskTextureRasterKey([], 16, 16));
    expect(createMaskTextureRasterKey([mask], 16, 16, { purpose: 'effect' })).toBe(original);
    mask.enabled = false;
    expect(generateMaskTexture([mask], 16, 16, { purpose: 'effect' })).toBeNull();
  });
  it('shares a raster across cloned masks with different authoring ids', () => {
    const firstMask = createMask(['a', 'b', 'c']);
    const clonedMask = createMask(['x', 'y', 'z']);
    clonedMask.id = 'cloned-mask-id';
    const firstKey = createMaskTextureRasterKey([firstMask], 512, 1024);
    const clonedKey = createMaskTextureRasterKey([clonedMask], 512, 1024);
    expect(clonedKey).toBe(firstKey);

    const manager = createManager();
    const raster = createImageData();
    const createRaster = vi.fn(() => raster);
    expect(manager.getOrCreateMaskRaster(firstKey, createRaster)).toBe(raster);
    expect(manager.getOrCreateMaskRaster(clonedKey, createRaster)).toBe(raster);
    expect(createRaster).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it('invalidates for animated mask values, authored edits, and dimensions', () => {
    const base = createMask();
    const animated = structuredClone(base);
    animated.position.x = 0.125;
    const editedPath = structuredClone(base);
    editedPath.vertices[1].x = 0.75;
    const editedFeather = structuredClone(base);
    editedFeather.edgeFeathers![`${editedFeather.vertices[0].id}->${editedFeather.vertices[1].id}`] = 4;
    const editedOpacity = structuredClone(base);
    editedOpacity.opacity = 0.5;

    const keys = [
      createMaskTextureRasterKey([base], 512, 1024),
      createMaskTextureRasterKey([animated], 512, 1024),
      createMaskTextureRasterKey([editedPath], 512, 1024),
      createMaskTextureRasterKey([editedFeather], 512, 1024),
      createMaskTextureRasterKey([editedOpacity], 512, 1024),
      createMaskTextureRasterKey([base], 256, 512),
    ];
    expect(new Set(keys).size).toBe(keys.length);

    const manager = createManager();
    const createRaster = vi.fn(() => createImageData());
    for (const key of keys) manager.getOrCreateMaskRaster(key, createRaster);
    expect(createRaster).toHaveBeenCalledTimes(keys.length);
    manager.destroy();
  });

  it('drops cached CPU rasters with the manager lifecycle', () => {
    const manager = createManager();
    const key = createMaskTextureRasterKey([createMask()], 512, 1024);
    const createRaster = vi.fn(() => createImageData());
    manager.getOrCreateMaskRaster(key, createRaster);
    manager.clearAll();
    manager.getOrCreateMaskRaster(key, createRaster);
    expect(createRaster).toHaveBeenCalledTimes(2);
    manager.destroy();
  });
});
