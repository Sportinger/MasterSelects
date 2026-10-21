import { Logger } from '../../services/logger';
import { retainHmrSingleton } from './hmrSingleton';

interface PreviewQueue { inFlight: number; requestLatest?: () => void; stalledFences: number }
const queues = retainHmrSingleton({ hot: import.meta.hot?.data ? import.meta.hot : undefined,
  key: 'previewGpuQueues', create: () => new WeakMap<GPUDevice, PreviewQueue>() });
const log = Logger.create('PreviewGpuBackpressure');

/**
 * Longest a preview submission may hold the queue. A completion fence that never
 * settles (a stalled GPU queue or a browser that delays the promise) must not freeze
 * the preview until a reload: the queue reopens, the newest request renders and the
 * stall is logged.
 */
export const PREVIEW_GPU_FENCE_TIMEOUT_MS = 1000;

/**
 * Preview submissions allowed in flight. Playback and scrubbing keep one, so a slow GPU
 * drops stale frames instead of queueing them. A paused preview admits one more: a
 * discrete change (a seek onto a new clip, an edit) must not keep showing the previous
 * picture until an earlier fence settles, which WebKit can report late.
 */
export function previewGpuSubmissionLimit(continuous: boolean): number {
  return continuous ? 1 : 2;
}

/** Keep the preview's submissions in flight bounded. Skipped requests retain no layers, media or old times. */
export function renderWithPreviewBackpressure(device: GPUDevice | null, exact: boolean,
  render: () => void, requestLatest: () => void, maxInFlight = 1): void {
  // Export and RAM-preview generation own exact-frame sequencing and must never drop frames.
  if (!device || exact) { render(); return; }
  let state = queues.get(device);
  if (!state) { state = { inFlight: 0, stalledFences: 0 }; queues.set(device, state); }
  if (state.inFlight >= Math.max(1, maxInFlight)) { state.requestLatest = requestLatest; return; }
  const queue = state;
  queue.inFlight += 1;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const release = (completed: boolean) => {
    if (settled) return;
    settled = true;
    if (timeout !== null) clearTimeout(timeout);
    queue.inFlight = Math.max(0, queue.inFlight - 1);
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
      if (!settled) {
        timeout = setTimeout(() => {
          if (settled) return;
          queue.stalledFences += 1;
          log.warn('Preview GPU completion did not settle; releasing the preview queue', {
            timeoutMs: PREVIEW_GPU_FENCE_TIMEOUT_MS,
            stalledFences: queue.stalledFences,
            pendingRequest: Boolean(queue.requestLatest),
          });
          release(true);
        }, PREVIEW_GPU_FENCE_TIMEOUT_MS);
      }
    } catch (error) { release(false); log.warn('Preview GPU completion unavailable', error); }
  }
}
