import type { CaptureStorageWarning } from './sessionTypes';

export interface CaptureStorageEstimate {
  usage?: number;
  quota?: number;
}

export interface CaptureStorageManager {
  estimate?: () => Promise<CaptureStorageEstimate>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

const DEFAULT_RECORDING_SECONDS = 30 * 60;
const MIN_STORAGE_HEADROOM_BYTES = 256 * 1024 * 1024;

export function getCaptureStorageManagerFromGlobal(): CaptureStorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

export async function prepareStorageForCapture(input: {
  storageManager?: CaptureStorageManager;
  bitrateBitsPerSecond: number;
  audioBitrateBitsPerSecond?: number;
  expectedDurationSeconds?: number;
}): Promise<CaptureStorageWarning[]> {
  const manager = input.storageManager;
  if (!manager?.estimate) {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      message: 'Browser storage estimate is unavailable. Long recording recovery may be less durable.',
    }];
  }

  let estimate: CaptureStorageEstimate;
  try {
    estimate = await manager.estimate();
  } catch {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      message: 'Browser storage estimate failed. Long recording recovery may be less durable.',
    }];
  }

  const usageBytes = Number.isFinite(estimate.usage) ? Math.max(0, estimate.usage ?? 0) : 0;
  const quotaBytes = Number.isFinite(estimate.quota) && (estimate.quota ?? 0) > 0 ? estimate.quota : undefined;
  if (!quotaBytes) {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      usageBytes,
      message: 'Browser storage quota is unavailable. Long recording recovery may be less durable.',
    }];
  }

  const availableBytes = Math.max(0, quotaBytes - usageBytes);
  const durationSeconds = input.expectedDurationSeconds && input.expectedDurationSeconds > 0
    ? input.expectedDurationSeconds
    : DEFAULT_RECORDING_SECONDS;
  const totalBitrate = Math.max(1, input.bitrateBitsPerSecond + (input.audioBitrateBitsPerSecond ?? 0));
  const estimatedSessionBytes = Math.ceil(totalBitrate * durationSeconds / 8);
  let persistent = false;
  try {
    persistent = await manager.persisted?.() ?? false;
  } catch {
    persistent = false;
  }

  const warnings: CaptureStorageWarning[] = [];
  if (!persistent && manager.persist && (availableBytes < estimatedSessionBytes * 2 || estimatedSessionBytes >= MIN_STORAGE_HEADROOM_BYTES)) {
    try {
      persistent = await manager.persist();
    } catch {
      persistent = false;
    }
    warnings.push({
      code: persistent ? 'storage-persistence-granted' : 'storage-persistence-denied',
      severity: persistent ? 'info' : 'warning',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      message: persistent
        ? 'Persistent browser storage is enabled for recording recovery.'
        : 'Persistent browser storage was not granted. Recording still works, but recovery data may be evicted.',
    });
  }

  if (availableBytes < estimatedSessionBytes) {
    warnings.unshift({
      code: 'storage-quota-low',
      severity: 'warning',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      message: 'Browser storage may be too low for a long recording.',
    });
  }
  return warnings;
}
