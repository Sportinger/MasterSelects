import { Logger } from '../../services/logger';
import { retainHmrSingleton } from './hmrSingleton';

interface PreviewQueue { busy: boolean; requestLatest?: () => void }
const queues = retainHmrSingleton({ hot: import.meta.hot?.data ? import.meta.hot : undefined,
  key: 'previewGpuQueues', create: () => new WeakMap<GPUDevice, PreviewQueue>() });
const log = Logger.create('PreviewGpuBackpressure');

/** Keep one preview submission in flight. Skipped requests retain no layers, media or old times. */
export function renderWithPreviewBackpressure(device: GPUDevice | null, exact: boolean,
  render: () => void, requestLatest: () => void): void {
  // Export and RAM-preview generation own exact-frame sequencing and must never drop frames.
  if (!device || exact) { render(); return; }
  let state = queues.get(device);
  if (!state) { state = { busy: false }; queues.set(device, state); }
  if (state.busy) { state.requestLatest = requestLatest; return; }
  const queue = state;
  queue.busy = true;
  const release = (completed: boolean) => {
    queue.busy = false;
    const wake = queue.requestLatest;
    queue.requestLatest = undefined;
    // Device loss recovery owns the next render after a rejected fence.
    if (completed) wake?.();
  };
  try { render(); }
  finally {
    try {
      void device.queue.onSubmittedWorkDone().then(() => release(true), error => {
        release(false); log.warn('Preview GPU completion failed', error);
      });
    } catch (error) { release(false); log.warn('Preview GPU completion unavailable', error); }
  }
}
