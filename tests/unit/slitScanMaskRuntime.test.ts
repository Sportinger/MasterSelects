import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlitScanMaskRuntime } from '../../src/effects/time/SlitScanMaskRuntime';
import type { ClipMask } from '../../src/types/masks';

vi.mock('../../src/utils/maskRenderer', () => ({
  createMaskTextureRasterKey: (masks: ClipMask[]) => JSON.stringify(masks),
  generateMaskTexture: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
}));

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  const writeTexture = vi.fn();
  const device = {
    queue: { writeTexture },
    createTexture: vi.fn(() => {
      const view = {} as GPUTextureView;
      return { createView: () => view, destroy: vi.fn() };
    }),
  } as unknown as GPUDevice;
  const runtime = new SlitScanMaskRuntime(device);
  const encoder = {} as GPUCommandEncoder;
  const resolve = (masks?: ClipMask[], id: unknown = 'selected-mask') =>
    runtime.resolve('effect', id, masks, 1, 1, encoder);
  return { runtime, resolve, writeTexture };
}

afterEach(() => vi.unstubAllGlobals());

describe('Slit Scan mask deletion', () => {
  it('uses zero protection for a deleted mask or a dangling project reference', () => {
    const { runtime, resolve, writeTexture } = setup();
    expect(resolve([]).identity).toBe('slit-scan:no-protection');
    expect(resolve(undefined).identity).toBe('slit-scan:no-protection');
    expect(resolve([{ id: 'unrelated-mask' } as ClipMask]).identity).toBe('slit-scan:no-protection');
    expect(writeTexture).toHaveBeenCalledOnce();
    expect(writeTexture.mock.calls[0][1]).toEqual(new Uint8Array([0, 0, 0, 255]));
    runtime.destroy();
  });

  it('drops cached protection on deletion and reconnects it after undo', () => {
    const { runtime, resolve } = setup();
    const mask = { id: 'selected-mask', enabled: true } as ClipMask;
    const protectedFrame = resolve([mask]);
    expect(protectedFrame.identity).not.toBe('slit-scan:no-protection');
    const deletedFrame = resolve([]);
    expect(deletedFrame.identity).toBe('slit-scan:no-protection');
    expect(deletedFrame.view).not.toBe(protectedFrame.view);
    expect(resolve([mask])).toBe(protectedFrame);
    runtime.destroy();
  });
});
