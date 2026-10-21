import type { CompositionImageSource } from './sourceTypes';

/**
 * An image that failed through a shared/stored URL (media-file blob URL, clip
 * image URL) gets one more attempt from a fresh object URL of its File, since
 * the stored URL can be revoked while the File itself is still readable.
 * Sources that already use their own fresh object URL are not retried.
 */
export function createImageRetrySource(source: CompositionImageSource): CompositionImageSource | null {
  if (source.objectUrl || !source.file || source.file.size === 0) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const objectUrl = URL.createObjectURL(source.file);
  return { url: objectUrl, file: source.file, objectUrl, name: source.name };
}

function hasHeifBrand(header: Uint8Array): boolean {
  if (header.length < 12) return false;
  const box = String.fromCharCode(...Array.from(header.subarray(4, 12)));
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(box);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Explains why an image could not be loaded, so the failure is reported as an
 * actionable warning (relink, convert) instead of an unexplained error.
 */
export async function describeImageLoadFailure(
  source: Pick<CompositionImageSource, 'file' | 'name'>,
): Promise<string> {
  const { file, name } = source;
  if (!file || file.size === 0) {
    return `Image ${name} is unavailable: no readable source file is attached; relink the media.`;
  }

  let header: Uint8Array;
  try {
    header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return `Image ${name} is no longer readable (file access was revoked or the file moved); relink the media.`;
  }

  if (hasHeifBrand(header)) {
    return `Image ${name} is a HEIC/HEIF image this browser cannot decode; convert it to JPEG or PNG.`;
  }

  return `Image ${name} (${file.type || 'unknown type'}, ${formatMegabytes(file.size)}) could not be decoded by this browser; `
    + 'it may be damaged or too large for this device.';
}
