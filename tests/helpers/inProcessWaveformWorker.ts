const WORKER_MODULE = '../../src/workers/waveformAnalysis.worker.ts';

type MessageHandler = ((event: MessageEvent) => void) | null;
interface WorkerScope { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: MessageHandler }

let instanceCounter = 0;
let loadChain: Promise<unknown> = Promise.resolve();

/**
 * Load a fresh copy of the waveform worker module bound to its own `self`
 * scope. The worker keeps job state at module level, so every fake Worker
 * gets its own module instance (distinct query string) just like a real
 * dedicated worker would.
 */
function loadWorkerScope(onWorkerMessage: (data: unknown) => void): Promise<WorkerScope> {
  const scope: WorkerScope = {
    postMessage: message => queueMicrotask(() => onWorkerMessage(message)),
    onmessage: null,
  };
  const instance = ++instanceCounter;
  const load = loadChain.then(async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
    Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: scope });
    try {
      await import(/* @vite-ignore */ `${WORKER_MODULE}?in-process-waveform-worker=${instance}`);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'self', previous);
      else delete (globalThis as { self?: unknown }).self;
    }
    return scope;
  });
  loadChain = load.catch(() => undefined);
  return load;
}

/** In-process stand-in for `waveformAnalysis.worker.ts` that runs the real worker code on microtasks. */
export class InProcessWaveformWorker {
  onmessage: MessageHandler = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private terminated = false;
  private readonly scope: Promise<WorkerScope>;

  constructor() {
    this.scope = loadWorkerScope(data => {
      if (!this.terminated) this.onmessage?.({ data } as MessageEvent);
    });
    this.scope.catch(error => {
      if (!this.terminated) this.onerror?.({ message: String(error) } as ErrorEvent);
    });
  }

  postMessage(message: unknown): void {
    void this.scope.then(scope => {
      if (!this.terminated) scope.onmessage?.({ data: message } as MessageEvent);
    }, () => undefined);
  }

  terminate(): void { this.terminated = true; }
}

/** Install the in-process waveform worker as the global `Worker` constructor. */
export function installInProcessWaveformWorker(): void {
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: InProcessWaveformWorker });
}
