import {
  WORKER_ENCODER_MAX_COUNT,
  WORKER_ENCODER_RESERVED_THREADS,
} from './constants';

export function canUseDedicatedFrameWorkers(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

export function getDedicatedFrameWorkerCount(): number {
  const hardwareConcurrency = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(
    2,
    Math.min(WORKER_ENCODER_MAX_COUNT, Math.max(2, hardwareConcurrency - WORKER_ENCODER_RESERVED_THREADS))
  );
}
