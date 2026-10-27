// Delivery of a finished phone export. Both functions must be called synchronously from a click
// handler: Web Share needs transient user activation, which an awaited export would have used up.
import { downloadBlob } from '../../../engine/export/FrameExporter';
import { Logger } from '../../../services/logger';
import type { PhoneActionResult } from '../contracts';

const log = Logger.create('PhoneExportDelivery');

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', gif: 'image/gif',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  zip: 'application/zip', wav: 'audio/wav', mp3: 'audio/mpeg', aac: 'audio/aac', ogg: 'audio/ogg',
};

/** The blob's own type, else one from the file extension (video/mp4 when unknown). */
export function phoneExportMimeFor(blob: Blob, filename: string): string {
  if (blob.type) return blob.type;
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'video/mp4';
}

/** Always writes a download (the browser decides where it lands). */
export function savePhoneExport(blob: Blob, filename: string): PhoneActionResult {
  try {
    downloadBlob(blob, filename);
    return { ok: true, message: 'Saved to your downloads.' };
  } catch (error) {
    log.error('Download failed', error);
    return { ok: false, message: error instanceof Error ? error.message : 'Saving the file failed.' };
  }
}

/**
 * Opens the system share sheet when files can be shared, otherwise downloads. Dismissing the
 * share sheet (AbortError) is not an error: the result stays available for another attempt.
 */
export async function sharePhoneExport(
  blob: Blob,
  filename: string,
  title: string,
): Promise<PhoneActionResult> {
  let file: File;
  try {
    file = new File([blob], filename, { type: phoneExportMimeFor(blob, filename) });
  } catch (error) {
    log.warn('Could not wrap the export in a File; downloading instead', error);
    return savePhoneExport(blob, filename);
  }

  const canShare = typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] });
  if (!canShare) {
    const saved = savePhoneExport(blob, filename);
    return saved.ok
      ? { ok: true, message: 'Sharing is not available here; saved to your downloads instead.' }
      : saved;
  }

  try {
    await navigator.share({ files: [file], title });
    return { ok: true, message: 'Shared.' };
  } catch (error) {
    if (isAbort(error)) return { ok: true, message: 'Share cancelled. The video is still here.' };
    log.error('Share failed', error);
    return {
      ok: false,
      message: `Sharing failed${error instanceof Error && error.message ? `: ${error.message}` : ''}. Try Save instead.`,
    };
  }
}
