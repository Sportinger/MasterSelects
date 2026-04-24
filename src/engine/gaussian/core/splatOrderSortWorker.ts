import { sortSplatOrderByDepth } from './splatOrderSortCore.ts';

interface InitMessage {
  type: 'init';
  centers: ArrayBuffer;
  splatCount: number;
}

interface SortMessage {
  type: 'sort';
  viewWorldMatrix: ArrayBuffer;
  requestedCount: number;
}

interface ReuseOrderMessage {
  type: 'reuseOrder';
  order: ArrayBuffer;
}

type WorkerMessage = InitMessage | SortMessage | ReuseOrderMessage;

const workerSelf = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
let centers = new Float32Array();
let splatCount = 0;
let reusableOrder: Uint32Array | undefined;

workerSelf.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    centers = new Float32Array(message.centers);
    splatCount = message.splatCount;
    reusableOrder = new Uint32Array(splatCount);
    for (let i = 0; i < splatCount; i += 1) {
      reusableOrder[i] = i;
    }
    return;
  }

  if (message.type === 'reuseOrder') {
    reusableOrder = new Uint32Array(message.order);
    return;
  }

  if (message.type === 'sort') {
    const startTime = performance.now();
    const viewWorldMatrix = new Float32Array(message.viewWorldMatrix);
    const result = sortSplatOrderByDepth(
      centers,
      viewWorldMatrix,
      Math.min(message.requestedCount, splatCount),
      reusableOrder,
    );

    const order = result.order;
    reusableOrder = undefined;
    workerSelf.postMessage(
      {
        type: 'sorted',
        order: order.buffer,
        count: result.count,
        sortTimeMs: performance.now() - startTime,
      },
      [order.buffer],
    );
  }
});
