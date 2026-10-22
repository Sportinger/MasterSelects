import { Logger } from '../../services/logger';
import type { Layer } from '../core/types';
import { retainHmrSingleton } from './hmrSingleton';

interface PreviewQueue {
  /** One entry per submission whose completion fence has not settled; `null` marks a continuous frame. */
  inFlight: Array<string | null>;
  requestLatest?: () => void;
  stalledFences: number;
  saturated: boolean;
  /** False until the device completed (or outwaited) its first preview fence. */
  warm: boolean;
}
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
 * The first preview fences after device creation include pipeline and shader compilation
 * (seconds on some GPUs, e.g. a cold Windows T4). They get a longer window, and a release in
 * that window is logged as info: a WARN then always means a stall of a warmed-up device.
 */
export const PREVIEW_GPU_WARMUP_FENCE_TIMEOUT_MS = 5000;

/**
 * Safety bound for distinct paused targets in flight. Paused requests are discrete
 * (a seek, a new clip, an edit) and arrive at input rate, so this is only reached when
 * fences stop settling; reaching it is logged, never silent.
 */
export const PREVIEW_GPU_PAUSED_TARGET_LIMIT = 6;

/**
 * How a preview request is admitted.
 * - `continuous` (playback, scrubbing): one submission in flight; newer frames coalesce
 *   so a slow GPU drops stale frames instead of queueing them.
 * - paused with a `target`: a request for a new picture is submitted at once, however
 *   many earlier paused submissions are still pending (WebKit settles fences late). Only
 *   a request for a target that is already in flight waits and coalesces.
 */
export interface PreviewSubmissionPolicy {
  continuous: boolean;
  /** Identity of the requested picture: timeline time plus layer identities. */
  target?: string;
}

const CONTINUOUS: PreviewSubmissionPolicy = { continuous: true };

/** Identity of a paused preview request: composition, timeline time and layer identities. */
export function previewSubmissionTarget(layers: ReadonlyArray<Layer | null | undefined>,
  frameContext?: { compositionId: string; timelineTimeSeconds: number }): string {
  const time = frameContext ? `${frameContext.compositionId}@${frameContext.timelineTimeSeconds}` : 'store';
  const ids = layers.map(layer => (layer ? `${layer.id}:${layer.sourceClipId ?? ''}` : '-'));
  return `${time}|${ids.join(',')}`;
}

/** Policy for a preview render: continuous while playing or scrubbing, otherwise keyed by its target. */
export function previewSubmissionPolicy(continuous: boolean, layers: ReadonlyArray<Layer | null | undefined>,
  frameContext?: { compositionId: string; timelineTimeSeconds: number }): PreviewSubmissionPolicy {
  return continuous ? CONTINUOUS : { continuous: false, target: previewSubmissionTarget(layers, frameContext) };
}

/** Diagnostics for the preview queue of one GPU device. */
export function getPreviewGpuBackpressureState(device: GPUDevice | null):
  { inFlight: number; pendingRequest: boolean; stalledFences: number } | null {
  const state = device ? queues.get(device) : undefined;
  return state ? { inFlight: state.inFlight.length, pendingRequest: Boolean(state.requestLatest),
    stalledFences: state.stalledFences } : null;
}

function admits(state: PreviewQueue, policy: PreviewSubmissionPolicy): boolean {
  if (state.inFlight.length === 0) return true;
  if (policy.continuous || policy.target === undefined) return false;
  if (state.inFlight.includes(policy.target)) return false;
  if (state.inFlight.length >= PREVIEW_GPU_PAUSED_TARGET_LIMIT) {
    if (!state.saturated) {
      state.saturated = true;
      log.warn('Preview GPU queue saturated; deferring a paused frame until a fence settles', {
        inFlight: state.inFlight.length, limit: PREVIEW_GPU_PAUSED_TARGET_LIMIT, stalledFences: state.stalledFences,
      });
    }
    return false;
  }
  return true;
}

/** Keep the preview's submissions in flight bounded. Skipped requests retain no layers, media or old times. */
export function renderWithPreviewBackpressure(device: GPUDevice | null, exact: boolean,
  render: () => void, requestLatest: () => void, policy: PreviewSubmissionPolicy = CONTINUOUS): void {
  // Export and RAM-preview generation own exact-frame sequencing and must never drop frames.
  if (!device || exact) { render(); return; }
  let state = queues.get(device);
  if (!state) { state = { inFlight: [], stalledFences: 0, saturated: false, warm: false }; queues.set(device, state); }
  if (!admits(state, policy)) { state.requestLatest = requestLatest; return; }
  const queue = state;
  const entry = policy.continuous ? null : policy.target ?? null;
  queue.inFlight.push(entry);
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const release = (completed: boolean) => {
    if (settled) return;
    settled = true;
    if (timeout !== null) clearTimeout(timeout);
    const index = queue.inFlight.indexOf(entry);
    if (index >= 0) queue.inFlight.splice(index, 1);
    queue.saturated = false;
    queue.warm = true;
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
        const warmingUp = !queue.warm;
        const timeoutMs = warmingUp ? PREVIEW_GPU_WARMUP_FENCE_TIMEOUT_MS : PREVIEW_GPU_FENCE_TIMEOUT_MS;
        timeout = setTimeout(() => {
          if (settled) return;
          queue.stalledFences += 1;
          const details = { timeoutMs, stalledFences: queue.stalledFences, pendingRequest: Boolean(queue.requestLatest) };
          if (warmingUp) log.info('Preview GPU warm-up (first frames after device creation) did not settle yet; releasing the preview queue', details);
          else log.warn('Preview GPU completion did not settle; releasing the preview queue', details);
          release(true);
        }, timeoutMs);
      }
    } catch (error) { release(false); log.warn('Preview GPU completion unavailable', error); }
  }
}
