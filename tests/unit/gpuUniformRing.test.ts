import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuFrameBuffers, GpuUniformRing, createGpuUniformRing } from '../../src/engine/core/gpuUniformRing';

interface FakeBuffer { label: string; size: number; usage: number; destroy: ReturnType<typeof vi.fn> }

function fakeDevice() {
  const buffers: FakeBuffer[] = [];
  const writes: Array<{ buffer: FakeBuffer; bytes: number[] }> = [];
  const device = {
    createBuffer: vi.fn((descriptor: { label: string; size: number; usage: number }) => {
      const buffer = { ...descriptor, destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    queue: {
      writeBuffer: vi.fn((buffer: FakeBuffer, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
        const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        writes.push({ buffer, bytes: Array.from(view) });
      }),
    },
  };
  return { device: device as unknown as GPUDevice, buffers, writes };
}

const payload = (value: number) => new Uint32Array([value, value, value, value]);

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8, VERTEX: 32, STORAGE: 128 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GpuUniformRing', () => {
  it('hands out a distinct buffer per write within one frame', () => {
    const gpu = fakeDevice();
    const ring = createGpuUniformRing(gpu.device, { label: 'test-uniforms', size: 16 });

    const first = ring.write(payload(1));
    const second = ring.write(payload(2));
    const third = ring.write(payload(3));

    expect(new Set([first, second, third]).size).toBe(3);
    expect(gpu.writes.map((write) => write.buffer)).toEqual([first, second, third]);
    expect(gpu.writes.map((write) => write.bytes[0])).toEqual([1, 2, 3]);
    expect(gpu.buffers.map((buffer) => buffer.label)).toEqual(['test-uniforms-0', 'test-uniforms-1', 'test-uniforms-2']);
    expect(gpu.buffers.every((buffer) => buffer.size === 16 && buffer.usage === (64 | 8))).toBe(true);
    expect(ring.frameSlotCount).toBe(3);
  });

  it('rewinds the cursor at the next frame and reuses slots in order', () => {
    const gpu = fakeDevice();
    const ring = new GpuUniformRing(gpu.device, { label: 'u', size: 16 });
    const frameA = [ring.write(payload(1)), ring.write(payload(2))];

    ring.beginFrame();
    const frameB = [ring.write(payload(3)), ring.write(payload(4))];

    expect(frameB).toEqual(frameA);
    expect(gpu.device.createBuffer).toHaveBeenCalledTimes(2);
    expect(ring.frameSlotCount).toBe(2);
  });

  it('grows when a frame needs more slots than earlier frames and never reuses a slot within the frame', () => {
    const gpu = fakeDevice();
    const ring = new GpuUniformRing(gpu.device, { label: 'u', size: 16 });
    ring.write(payload(1));
    ring.beginFrame();

    const handedOut = Array.from({ length: 5 }, (_, index) => ring.write(payload(index)));

    expect(new Set(handedOut).size).toBe(5);
    expect(ring.slotCount).toBe(5);
    expect(gpu.buffers.some((buffer) => buffer.destroy.mock.calls.length > 0)).toBe(false);
  });

  it('rejects payloads larger than a slot instead of truncating them', () => {
    const ring = new GpuUniformRing(fakeDevice().device, { label: 'u', size: 8 });
    expect(() => ring.write(new Float32Array(4))).toThrow(RangeError);
  });

  it('destroys retired buffers on the next frame start, never immediately', () => {
    const gpu = fakeDevice();
    const ring = new GpuUniformRing(gpu.device, { label: 'u', size: 16 });
    const retired = { destroy: vi.fn() } as unknown as GPUBuffer;

    ring.retire(retired);
    ring.write(payload(1));
    expect(retired.destroy).not.toHaveBeenCalled();
    expect(ring.retiredCount).toBe(1);

    ring.beginFrame();
    expect(retired.destroy).toHaveBeenCalledTimes(1);
    expect(ring.retiredCount).toBe(0);
  });

  it('task mode keeps one frame for a synchronous section and starts the next after the microtask boundary', async () => {
    const gpu = fakeDevice();
    const ring = new GpuUniformRing(gpu.device, { label: 'u', size: 16, frame: 'task' });
    const retired = { destroy: vi.fn() } as unknown as GPUBuffer;

    const first = ring.write(payload(1));
    ring.retire(retired);
    const second = ring.write(payload(2));
    expect(second).not.toBe(first);
    expect(retired.destroy).not.toHaveBeenCalled();

    await Promise.resolve();
    const nextFrame = ring.write(payload(3));
    expect(nextFrame).toBe(first);
    expect(retired.destroy).toHaveBeenCalledTimes(1);
  });

  it('dispose destroys every slot and pending retirement', () => {
    const gpu = fakeDevice();
    const ring = new GpuUniformRing(gpu.device, { label: 'u', size: 16 });
    ring.write(payload(1));
    ring.write(payload(2));
    const retired = { destroy: vi.fn() } as unknown as GPUBuffer;
    ring.retire(retired);

    ring.dispose();

    expect(gpu.buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    expect(retired.destroy).toHaveBeenCalledTimes(1);
    expect(ring.slotCount).toBe(0);
  });
});

describe('GpuFrameBuffers', () => {
  it('keeps one buffer per key and reuses it while it is large enough', () => {
    const gpu = fakeDevice();
    const buffers = new GpuFrameBuffers(gpu.device, { label: 'verts', usage: 32 | 8 });

    const a = buffers.ensure('target-a', 100);
    const b = buffers.ensure('target-b', 100);

    expect(a).not.toBe(b);
    expect(buffers.ensure('target-a', 64)).toBe(a);
    expect(gpu.buffers.map((buffer) => buffer.label)).toEqual(['verts-target-a', 'verts-target-b']);
    expect(buffers.get('target-b')).toBe(b);
  });

  it('replaces a buffer that is too small without destroying the old one mid-frame', () => {
    const gpu = fakeDevice();
    const buffers = new GpuFrameBuffers(gpu.device, { label: 'idx', usage: 128, capacity: (bytes) => bytes * 2 });

    const small = buffers.ensure('indices', 64) as unknown as FakeBuffer;
    expect(small.size).toBe(128);
    expect(buffers.ensure('indices', 100)).toBe(small);
    const large = buffers.ensure('indices', 200) as unknown as FakeBuffer;

    expect(large).not.toBe(small);
    expect(large.size).toBe(400);
    expect(small.destroy).not.toHaveBeenCalled();

    buffers.beginFrame();
    expect(small.destroy).toHaveBeenCalledTimes(1);
    expect(large.destroy).not.toHaveBeenCalled();
  });

  it('release retires the key buffer until the next frame', () => {
    const gpu = fakeDevice();
    const buffers = new GpuFrameBuffers(gpu.device, { label: 'verts', usage: 32 });
    const buffer = buffers.ensure('gone', 40) as unknown as FakeBuffer;

    buffers.release('gone');
    expect(buffers.get('gone')).toBeUndefined();
    expect(buffer.destroy).not.toHaveBeenCalled();

    buffers.beginFrame();
    expect(buffer.destroy).toHaveBeenCalledTimes(1);
  });
});
