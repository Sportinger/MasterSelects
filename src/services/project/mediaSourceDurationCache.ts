/** Derived metadata only: never a source identity or permission grant. */
const STORAGE_KEY = 'ms.media-source-durations.v1';
const LIMIT = 1024;
type Entry = [string, number];

function readEntries(): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is Entry => Array.isArray(entry)
      && entry.length === 2 && typeof entry[0] === 'string'
      && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0).slice(-LIMIT) : [];
  } catch { return []; }
}

/** Call only after freshly matching the saved fingerprint AND byte length. */
export function mediaSourceDurationCacheKey(file: File, fingerprint: string, type: string): string | null {
  if (!(file.lastModified > 0) || (fingerprint !== '' && !/^[a-f0-9]{64}$/i.test(fingerprint))) return null;
  return JSON.stringify([fingerprint.toLowerCase(), file.size, file.lastModified, file.name, type]);
}

export function readCachedMediaSourceDuration(key: string | null): number | undefined {
  if (!key) return undefined;
  return readEntries().find(entry => entry[0] === key)?.[1];
}

export function cacheMediaSourceDuration(key: string | null, duration: number | undefined): void {
  if (!key || !(typeof duration === 'number' && Number.isFinite(duration) && duration > 0)) return;
  try {
    const entries = readEntries().filter(entry => entry[0] !== key);
    entries.push([key, duration]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-LIMIT)));
  } catch { /* A missing/quota-limited cache always falls back to the real metadata probe. */ }
}
