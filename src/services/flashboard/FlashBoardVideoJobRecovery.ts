import type { FlashBoardActiveGenerationRecord } from '../../stores/flashboardStore/types';

export const FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY =
  'masterselects.flashboard.video-job-recovery.v1';

const RECOVERY_VERSION = 1;
const UNSCOPED_PROJECT_KEY = 'unscoped';
const MAX_RECOVERY_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface FlashBoardVideoJobRecoveryBucket {
  records: FlashBoardActiveGenerationRecord[];
  updatedAt: number;
}

interface FlashBoardVideoJobRecoveryRegistry {
  buckets: Record<string, FlashBoardVideoJobRecoveryBucket>;
  version: typeof RECOVERY_VERSION;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function getProjectKey(projectCreatedAt?: string | null): string {
  const normalized = projectCreatedAt?.trim();
  return normalized ? `project:${normalized}` : UNSCOPED_PROJECT_KEY;
}

function isPendingVideoRecord(
  record: FlashBoardActiveGenerationRecord,
): boolean {
  if (!record.request || !record.job) return false;
  if (record.request.outputType === 'audio' || record.request.outputType === 'image') {
    return false;
  }

  return record.job.status === 'queued' || record.job.status === 'processing';
}

function isStoredRecord(value: unknown): value is FlashBoardActiveGenerationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FlashBoardActiveGenerationRecord>;
  return typeof record.id === 'string'
    && record.kind === 'generation'
    && typeof record.createdAt === 'number'
    && typeof record.updatedAt === 'number'
    && isPendingVideoRecord(record as FlashBoardActiveGenerationRecord);
}

function readRegistry(storage: Storage): FlashBoardVideoJobRecoveryRegistry {
  try {
    const raw = storage.getItem(FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return { buckets: {}, version: RECOVERY_VERSION };
    }

    const parsed = JSON.parse(raw) as Partial<FlashBoardVideoJobRecoveryRegistry>;
    if (parsed.version !== RECOVERY_VERSION || !parsed.buckets || typeof parsed.buckets !== 'object') {
      return { buckets: {}, version: RECOVERY_VERSION };
    }

    return {
      buckets: parsed.buckets,
      version: RECOVERY_VERSION,
    };
  } catch {
    return { buckets: {}, version: RECOVERY_VERSION };
  }
}

function pruneRegistry(
  registry: FlashBoardVideoJobRecoveryRegistry,
  now = Date.now(),
): FlashBoardVideoJobRecoveryRegistry {
  const buckets = Object.fromEntries(
    Object.entries(registry.buckets).filter(([, bucket]) => (
      bucket
      && typeof bucket.updatedAt === 'number'
      && now - bucket.updatedAt <= MAX_RECOVERY_AGE_MS
      && Array.isArray(bucket.records)
    )),
  );
  return { buckets, version: RECOVERY_VERSION };
}

function writeRegistry(storage: Storage, registry: FlashBoardVideoJobRecoveryRegistry): void {
  try {
    if (Object.keys(registry.buckets).length === 0) {
      storage.removeItem(FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY);
      return;
    }
    storage.setItem(FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Project persistence remains the fallback if browser storage is unavailable.
  }
}

export function persistFlashBoardVideoJobRecovery(
  records: FlashBoardActiveGenerationRecord[],
  projectCreatedAt?: string | null,
): void {
  const storage = getStorage();
  if (!storage) return;

  const registry = pruneRegistry(readRegistry(storage));
  const projectKey = getProjectKey(projectCreatedAt);
  const pendingRecords = records.filter(isPendingVideoRecord);
  const currentRecordIds = new Set(records.map((record) => record.id));

  for (const [otherProjectKey, bucket] of Object.entries(registry.buckets)) {
    if (otherProjectKey === projectKey) continue;
    const remainingRecords = bucket.records.filter((record) => !currentRecordIds.has(record.id));
    if (remainingRecords.length === 0) {
      delete registry.buckets[otherProjectKey];
    } else if (remainingRecords.length !== bucket.records.length) {
      registry.buckets[otherProjectKey] = {
        ...bucket,
        records: remainingRecords,
      };
    }
  }

  if (pendingRecords.length === 0) {
    delete registry.buckets[projectKey];
  } else {
    registry.buckets[projectKey] = {
      records: pendingRecords,
      updatedAt: Date.now(),
    };
  }

  writeRegistry(storage, registry);
}

export function readFlashBoardVideoJobRecovery(
  projectCreatedAt?: string | null,
): FlashBoardActiveGenerationRecord[] {
  const storage = getStorage();
  if (!storage) return [];

  const registry = pruneRegistry(readRegistry(storage));
  writeRegistry(storage, registry);
  const records = registry.buckets[getProjectKey(projectCreatedAt)]?.records;
  return Array.isArray(records) ? records.filter(isStoredRecord) : [];
}

function shouldPreferRecoveredRecord(
  current: FlashBoardActiveGenerationRecord,
  recovered: FlashBoardActiveGenerationRecord,
): boolean {
  const currentWasReloadFailure = current.job?.status === 'failed'
    && current.job.error === 'Job interrupted by reload';
  const currentIsTerminal = current.job?.status === 'completed'
    || current.job?.status === 'canceled'
    || (current.job?.status === 'failed' && !currentWasReloadFailure);
  if (currentIsTerminal) return false;

  const recoveredHasMissingTaskId = Boolean(recovered.job?.remoteTaskId)
    && !current.job?.remoteTaskId;

  return currentWasReloadFailure
    || recoveredHasMissingTaskId
    || recovered.updatedAt > current.updatedAt;
}

export function mergeFlashBoardVideoJobRecovery(
  records: FlashBoardActiveGenerationRecord[],
  recoveredRecords: FlashBoardActiveGenerationRecord[],
): FlashBoardActiveGenerationRecord[] {
  if (recoveredRecords.length === 0) return records;

  const merged = [...records];
  const indexById = new Map(merged.map((record, index) => [record.id, index]));

  for (const recovered of recoveredRecords) {
    const currentIndex = indexById.get(recovered.id);
    if (currentIndex === undefined) {
      indexById.set(recovered.id, merged.length);
      merged.push(recovered);
      continue;
    }

    const current = merged[currentIndex];
    if (shouldPreferRecoveredRecord(current, recovered)) {
      merged[currentIndex] = recovered;
    }
  }

  return merged;
}
