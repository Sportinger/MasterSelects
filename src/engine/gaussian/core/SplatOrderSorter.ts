import { Logger } from '../../../services/logger';
import {
  buildSplatCenters,
  multiplyMat4ColumnMajor,
} from './splatOrderSortCore.ts';

const log = Logger.create('SplatOrderSorter');
const MATRIX_EPSILON = 0.0005;

interface SortedWorkerMessage {
  type: 'sorted';
  order: ArrayBuffer;
  count: number;
  sortTimeMs: number;
}

function hasMatrixChanged(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(a[i] - b[i]) > MATRIX_EPSILON) {
      return true;
    }
  }
  return false;
}

export class SplatOrderSorter {
  private readonly worker: Worker;
  private readonly viewWorldMatrix = new Float32Array(16);
  private readonly lastSubmittedMatrix = new Float32Array(16);
  private readonly clipId: string;
  private pendingOrder: Uint32Array | null = null;
  private pendingCount = 0;
  private lastSubmittedCount = 0;
  private isSorting = false;
  private initialized = false;
  private sortedOnce = false;

  readonly orderBuffer: GPUBuffer;

  constructor(
    device: GPUDevice,
    clipId: string,
    data: Float32Array,
    splatCount: number,
  ) {
    this.clipId = clipId;
    this.orderBuffer = this.createInitialOrderBuffer(device, clipId, splatCount);
    this.worker = new Worker(new URL('./splatOrderSortWorker.ts', import.meta.url), {
      type: 'module',
      name: `splat-order-sorter-${clipId}`,
    });
    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.worker.addEventListener('error', this.handleWorkerError);

    const centers = buildSplatCenters(data, splatCount);
    this.worker.postMessage(
      {
        type: 'init',
        centers: centers.buffer,
        splatCount,
      },
      [centers.buffer],
    );
    this.initialized = true;
  }

  get hasSortedOrder(): boolean {
    return this.sortedOnce;
  }

  requestSort(viewMatrix: Float32Array, worldMatrix: Float32Array, requestedCount: number): void {
    if (!this.initialized || this.isSorting || requestedCount <= 1) {
      return;
    }

    multiplyMat4ColumnMajor(viewMatrix, worldMatrix, this.viewWorldMatrix);
    if (
      this.lastSubmittedCount === requestedCount &&
      this.sortedOnce &&
      !hasMatrixChanged(this.viewWorldMatrix, this.lastSubmittedMatrix)
    ) {
      return;
    }

    this.lastSubmittedMatrix.set(this.viewWorldMatrix);
    this.lastSubmittedCount = requestedCount;
    this.isSorting = true;

    const matrixForWorker = this.viewWorldMatrix.slice();
    this.worker.postMessage(
      {
        type: 'sort',
        viewWorldMatrix: matrixForWorker.buffer,
        requestedCount,
      },
      [matrixForWorker.buffer],
    );
  }

  applyPending(queue: GPUQueue): number {
    if (!this.pendingOrder) {
      return -1;
    }

    const order = this.pendingOrder;
    const count = this.pendingCount;
    const sourceBuffer = order.buffer as ArrayBuffer;
    if (count > 0) {
      queue.writeBuffer(this.orderBuffer, 0, sourceBuffer, order.byteOffset, count * 4);
    }
    this.worker.postMessage({ type: 'reuseOrder', order: sourceBuffer }, [sourceBuffer]);
    this.pendingOrder = null;
    this.pendingCount = 0;
    this.sortedOnce = true;
    return count;
  }

  destroy(): void {
    this.worker.removeEventListener('message', this.handleWorkerMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate();
    this.orderBuffer.destroy();
  }

  private createInitialOrderBuffer(device: GPUDevice, clipId: string, splatCount: number): GPUBuffer {
    const initialOrder = new Uint32Array(splatCount);
    for (let i = 0; i < splatCount; i += 1) {
      initialOrder[i] = i;
    }

    const buffer = device.createBuffer({
      size: Math.max(4, splatCount * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
      label: `splat-worker-order-${clipId}`,
    });
    new Uint32Array(buffer.getMappedRange()).set(initialOrder);
    buffer.unmap();
    return buffer;
  }

  private readonly handleWorkerMessage = (event: MessageEvent<SortedWorkerMessage>): void => {
    const message = event.data;
    if (message.type !== 'sorted') {
      return;
    }

    this.pendingOrder = new Uint32Array(message.order);
    this.pendingCount = message.count;
    this.isSorting = false;
    log.debug('Worker sort completed', {
      clipId: this.clipId,
      count: message.count,
      sortTimeMs: message.sortTimeMs.toFixed(1),
    });
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.isSorting = false;
    log.warn('Worker sort failed', {
      clipId: this.clipId,
      message: event.message,
    });
  };
}
