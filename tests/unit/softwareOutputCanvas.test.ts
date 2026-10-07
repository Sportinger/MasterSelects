import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoftwareOutputCanvas, softwareCanvasPixels } from '../../src/engine/core/SoftwareOutputCanvas';

afterEach(() => vi.unstubAllGlobals());

describe('software presentation of GPU output', () => {
  it('copies odd-width padded BGRA rows with alpha and channel order intact', () => {
    const source = new Uint8Array(512).fill(99);
    source.set([3, 2, 1, 255, 30, 20, 10, 128], 0);
    source.set([6, 5, 4, 0, 60, 50, 40, 255], 256);
    expect([...softwareCanvasPixels(source, 2, 2, 256, true)])
      .toEqual([1, 2, 3, 255, 10, 20, 30, 128, 4, 5, 6, 0, 40, 50, 60, 255]);
    expect([...softwareCanvasPixels(source, 2, 1, 256, false)])
      .toEqual([3, 2, 1, 255, 30, 20, 10, 128]);
  });

  function fixture() {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, COPY_SRC: 1 });
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    const paint = { fillRect: vi.fn(), putImageData: vi.fn(), fillStyle: '' };
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(paint as unknown as CanvasRenderingContext2D);
    const maps: Array<() => void> = [];
    const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    const device = {
      lost: new Promise(() => {}),
      queue: { submit: vi.fn() },
      createTexture: vi.fn(({ size }: { size: number[] }) => ({ width: size[0], height: size[1], destroy: vi.fn() })),
      createCommandEncoder: vi.fn(() => ({ copyTextureToBuffer: vi.fn(), finish: () => ({}) })),
      createBuffer: vi.fn(({ size }: { size: number }) => {
        const data = new Uint8Array(size); data.set([0, 0, 255, 255, 0, 255, 0, 255]);
        const buffer = { mapState: 'unmapped', destroy: vi.fn(), unmap: vi.fn(), getMappedRange: () => data.buffer,
          mapAsync: () => new Promise<void>(resolve => maps.push(() => { buffer.mapState = 'mapped'; resolve(); })) };
        buffers.push(buffer); return buffer;
      }),
    };
    const context = new SoftwareOutputCanvas(canvas);
    context.configure({ device: device as unknown as GPUDevice, format: 'bgra8unorm' });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    return { context, canvas, device, paint, maps, buffers, tick };
  }

  it('defers readback until submission, bounds in-flight copies, and follows the latest frame', async () => {
    const f = fixture();
    f.context.getCurrentTexture();
    expect(f.device.queue.submit).not.toHaveBeenCalled();
    f.device.queue.submit([]); await f.tick();
    expect(f.device.createBuffer).toHaveBeenCalledTimes(1);
    f.context.getCurrentTexture(); f.context.getCurrentTexture();
    await f.tick(); expect(f.device.createBuffer).toHaveBeenCalledTimes(1);
    f.maps[0](); await f.tick();
    expect(f.paint.putImageData).toHaveBeenCalledTimes(1);
    expect(f.device.createBuffer).toHaveBeenCalledTimes(2);
    f.maps[1](); await f.tick();
    expect(f.paint.putImageData).toHaveBeenCalledTimes(2);
    f.context.unconfigure();
  });

  it('does not paint an obsolete size or a retired GPU device', async () => {
    const f = fixture();
    f.context.getCurrentTexture(); await f.tick();
    f.canvas.width = 3; f.context.getCurrentTexture();
    f.maps[0](); await f.tick();
    expect(f.paint.putImageData).not.toHaveBeenCalled();
    f.context.unconfigure(); f.maps[1](); await f.tick();
    expect(f.paint.putImageData).not.toHaveBeenCalled();
    expect(f.context.getConfiguration()).toBeNull();
    expect(() => f.context.getCurrentTexture()).toThrow('not configured');
    expect(f.buffers.every(buffer => buffer.destroy.mock.calls.length > 0)).toBe(true);
  });
});
