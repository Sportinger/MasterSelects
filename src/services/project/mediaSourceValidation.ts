import { calculateFileHash } from '../../stores/mediaStore/helpers/fileHashHelpers';
import { Logger } from '../logger';
import { cacheMediaSourceDuration, mediaSourceDurationCacheKey, readCachedMediaSourceDuration } from './mediaSourceDurationCache';
import { canReuseMediaSourceValidation, rememberMediaSourceValidation } from './mediaSourceRestoreCache';

const log = Logger.create('MediaSourceValidation');
const fingerprints = new WeakMap<File, Promise<string>>();
const durations = new WeakMap<File, Promise<number | undefined>>();

export function readMediaSourceFingerprint(file: File): Promise<string> {
  let pending = fingerprints.get(file);
  if (!pending) {
    pending = calculateFileHash(file);
    fingerprints.set(file, pending);
  }
  return pending;
}

function readDuration(file: File, type: 'video' | 'audio'): Promise<number | undefined> {
  let pending = durations.get(file);
  if (!pending) {
    pending = import('../../stores/mediaStore/helpers/mediaInfoHelpers')
      .then(async ({ getMediaInfo }) => (await getMediaInfo(file, type)).duration);
    durations.set(file, pending);
  }
  return pending;
}

export interface ExpectedMediaSource {
  name: string;
  type: string;
  duration?: number;
  fileSize?: number;
  fileHash?: string;
}

function positive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Paths and persisted handles locate candidates; they do not prove identity. */
export async function getMediaSourceMismatch(
  expected: ExpectedMediaSource,
  file: File,
  mode: 'restore' | 'relink' = 'restore',
): Promise<string | null> {
  if (file.size === 0) return `“${file.name}” is empty. Choose the original media file.`;

  // Explicit relinking may repair a stale fingerprint or use a remuxed source.
  // Automatic restoration must never rewrite the saved identity to fit a candidate.
  if (mode === 'restore' && positive(expected.fileSize) && expected.fileSize !== file.size) {
    return `“${file.name}” has a different file size from “${expected.name}”. Relink the original media.`;
  }

  const hasFingerprint = /^[a-f0-9]{64}$/i.test(expected.fileHash ?? '');
  const actualHash = hasFingerprint ? await readMediaSourceFingerprint(file) : '';
  const fingerprintMatches = hasFingerprint && actualHash === expected.fileHash?.toLowerCase();
  if (mode === 'restore' && hasFingerprint && !fingerprintMatches) {
    return `“${file.name}” does not match the saved fingerprint for “${expected.name}”. Relink the original media.`;
  }

  if ((expected.type === 'video' || expected.type === 'audio') && positive(expected.duration)) {
    // Reuse actual parsed duration only for an unchanged, freshly fingerprinted original.
    // Explicit relinks and legacy sources without a size/fingerprint still probe the container.
    const cacheKey = mode === 'restore' && (fingerprintMatches || !hasFingerprint) && expected.fileSize === file.size
      ? mediaSourceDurationCacheKey(file, actualHash, expected.type) : null;
    // Without a saved fingerprint, only a matching validated physical handle may reuse duration.
    let duration = fingerprintMatches ? readCachedMediaSourceDuration(cacheKey) : undefined;
    if (duration === undefined) {
      duration = await readDuration(file, expected.type);
      cacheMediaSourceDuration(cacheKey, duration);
    }
    if (positive(duration)) {
      // Container/edit-list and older metadata readers may differ slightly.
      const tolerance = Math.max(0.5, expected.duration * 0.01);
      if (Math.abs(duration - expected.duration) > tolerance) {
        return `“${expected.name}” expects ${expected.duration.toFixed(2)} seconds, but “${file.name}” contains ${duration.toFixed(2)} seconds. Choose the original media file.`;
      }
    } else if (!fingerprintMatches) {
      return `Could not verify the duration of “${file.name}” for “${expected.name}”. Choose the original media file.`;
    }
  }
  return null;
}

/** Rejected candidates stay offline, with their persisted identity untouched. */
export async function isRestoredMediaSourceCompatible(expected: ExpectedMediaSource, file: File,
  handle?: FileSystemFileHandle): Promise<boolean> {
  try {
    if (await canReuseMediaSourceValidation(expected, file, handle)) return true;
    const mismatch = await getMediaSourceMismatch(expected, file);
    if (!mismatch) { await rememberMediaSourceValidation(expected, file, handle); return true; }
    log.warn('Rejected mismatched media source', { name: expected.name, candidate: file.name, reason: mismatch });
  } catch (error) {
    log.warn('Could not verify restored media source', { name: expected.name, candidate: file.name, error });
  }
  return false;
}
