import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinearTemporalBlock } from '../../src/effects/time/LinearTemporalBlock';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';
import type { SourceFrameReader } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameReader';
import type { SourceFrameLease } from '../../src/services/mediaRuntime/sourceFrames/SourceFrameService';
import type { TemporalFrameUploader } from '../../src/engine/texture/TemporalFrameUploader';

vi.mock('../../src/effects/time/LinearTemporalBlockGpu', () => ({ LinearTemporalBlockGpu: class { draw = vi.fn(); } }));
afterEach(() => vi.unstubAllGlobals());

function setup(errors: (GPUError | null)[]) {
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, COPY_SRC: 2 });
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2 });
  const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => errors.shift() ?? null),
    createTexture: vi.fn(() => { const texture = { createView: vi.fn(), destroy: vi.fn() }; textures.push(texture); return texture; }),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass: () => ({ end: vi.fn() }), finish: vi.fn() })),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
  } as unknown as GPUDevice;
  const block = new LinearTemporalBlock(device);
  const request = { horizon: 0, samples: 2, currentInput: { width: 16, height: 16 },
    source: { mediaId: 'media', localTime: 0, duration: 10, inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] },
  } as SourceTemporalRequest;
  const prepare = (key: string, count: number) => block.prepare(key, request,
    { frames: [{ time: 0, duration: 1 / 30 }] } as SourceFrameReader,
    {} as SourceFrameLease, {} as TemporalFrameUploader, 0, 1 / 30, count, new AbortController().signal, () => {});
  return { block, textures, prepare, device };
}

describe('temporal output block allocation', () => {
  it('halves a rejected allocation, retires its textures, and remembers the working limit', async () => {
    const { block, textures, prepare, device } = setup([null, { message: 'VRAM exhausted' } as GPUError]);
    await prepare('first', 6);
    expect(block.count).toBe(3);
    expect(block.find('first', 2 / 30)).toBeDefined();
    expect(block.find('first', 3 / 30)).toBeUndefined();
    expect(textures.slice(0, 6).every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(device.popErrorScope).toHaveBeenCalledTimes(4);
    await prepare('next', 100);
    expect(block.count).toBe(3);
    expect(textures).toHaveLength(12);
    await block.clear();
    expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('reports validation failures instead of masking them by shrinking the block', async () => {
    const { block, textures, prepare } = setup([{ message: 'Invalid texture' } as GPUError, null]);
    await expect(prepare('invalid', 6)).rejects.toThrow('Invalid texture');
    expect(block.count).toBe(0);
    expect(textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
  });
});
