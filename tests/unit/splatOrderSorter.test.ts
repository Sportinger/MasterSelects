import { afterEach, describe, expect, it, vi } from 'vitest';

import { SplatOrderSorter } from '../../src/engine/gaussian/core/SplatOrderSorter';

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly messages: unknown[] = [];
  private messageListener: ((event: MessageEvent) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListener = listener as (event: MessageEvent) => void;
    }
  }

  removeEventListener(): void {}
  terminate(): void {}

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emitSorted(requestId: number, order: Uint32Array): void {
    this.messageListener?.({
      data: {
        type: 'sorted',
        requestId,
        order: order.buffer,
        count: order.length,
        sortTimeMs: 4,
      },
    } as MessageEvent);
  }
}

function matrixWithTranslation(x: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, 0, 0, 1,
  ]);
}

describe('SplatOrderSorter', () => {
  afterEach(() => {
    FakeWorker.instances = [];
    vi.unstubAllGlobals();
  });

  it('discards a completed sort when the edit transform moved again', () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2 });

    const mapped = new ArrayBuffer(12);
    const orderBuffer = {
      destroy: vi.fn(),
      getMappedRange: () => mapped,
      unmap: vi.fn(),
    };
    const device = {
      createBuffer: vi.fn(() => orderBuffer),
    } as unknown as GPUDevice;
    const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    const splatData = new Float32Array(3 * 14);
    const sorter = new SplatOrderSorter(device, 'clip-splat', splatData, 3);
    const worker = FakeWorker.instances[0];
    const view = matrixWithTranslation(0);
    const firstWorld = matrixWithTranslation(0);
    const latestWorld = matrixWithTranslation(2);

    sorter.requestSort(view, firstWorld, 3);
    sorter.requestSort(view, latestWorld, 3);
    worker.emitSorted(1, new Uint32Array([2, 1, 0]));

    expect(sorter.applyPending(queue)).toBe(-1);
    expect(queue.writeBuffer).not.toHaveBeenCalled();
    expect(worker.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'sort', requestId: 2, requestedCount: 3 }),
    ]));

    worker.emitSorted(2, new Uint32Array([1, 2, 0]));
    sorter.requestSort(view, latestWorld, 3);

    expect(sorter.applyPending(queue)).toBe(3);
    expect(queue.writeBuffer).toHaveBeenCalledTimes(1);
  });
});
