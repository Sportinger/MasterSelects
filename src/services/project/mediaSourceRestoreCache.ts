import { projectDB } from '../projectDB';
import { mediaSourceDurationCacheKey, readCachedMediaSourceDuration } from './mediaSourceDurationCache';
import type { ExpectedMediaSource } from './mediaSourceValidation';

function snapshotKey(expected: ExpectedMediaSource, file: File): string | null {
  if (expected.fileSize !== file.size || !(expected.duration && expected.duration > 0)) return null;
  if (expected.type !== 'video' && expected.type !== 'audio') return null;
  const key = mediaSourceDurationCacheKey(file, expected.fileHash ?? '', expected.type);
  // A matching fingerprint already validates sources whose codec metadata cannot
  // be parsed here. Remember that successful result too, including expected duration.
  if (key && /^[a-f0-9]{64}$/i.test(expected.fileHash ?? '')) return JSON.stringify([key, expected.duration]);
  const duration = readCachedMediaSourceDuration(key);
  return key && duration && Math.abs(duration - expected.duration) <= Math.max(0.5, expected.duration * 0.01) ? key : null;
}

/** Fast reopening is tied to the same physical file handle AND its validated metadata snapshot. */
export async function canReuseMediaSourceValidation(expected: ExpectedMediaSource, file: File,
  handle?: FileSystemFileHandle): Promise<boolean> {
  if (!handle || typeof handle.isSameEntry !== 'function') return false;
  const key = snapshotKey(expected, file); if (!key) return false;
  try {
    const verified = await projectDB.getStoredHandle('media-validation:' + key);
    return !!verified && verified.kind === 'file' && await handle.isSameEntry(verified);
  } catch { return false; }
}

/** Only called after successful fingerprint and duration validation, never on explicit relink hints. */
export async function rememberMediaSourceValidation(expected: ExpectedMediaSource, file: File,
  handle?: FileSystemFileHandle): Promise<void> {
  if (!handle || typeof handle.isSameEntry !== 'function') return;
  const key = snapshotKey(expected, file); if (!key) return;
  try { await projectDB.storeHandle('media-validation:' + key, handle); }
  catch { /* Cache failure does not change validation or access permissions. */ }
}
