// Delivery of a finished phone export. Both functions must be called synchronously from a click
// handler: Web Share needs transient user activation, which an awaited export would have used up.
import { downloadBlob } from '../../../engine/export/FrameExporter';
import { Logger } from '../../../services/logger';
import type { PhoneActionResult } from '../contracts';

const log = Logger.create('PhoneExportDelivery');

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function mimeFor(blob: Blob, filename: string): string {
  if (blob.type) return blob.type;
  return filename.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
}

/** Always writes a download (the browser decides where it lands). */
export function savePhoneExport(blob: Blob, filename: string): PhoneActionResult {
  try {
    downloadBlob(blob, filename);
    return { ok: true, message: 'Saved to your downloads.' };
  } catch (error) {
    log.error('Download failed', error);
    return { ok: false, message: error instanceof Error ? error.message : 'Saving the video failed.' };
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
    file = new File([blob], filename, { type: mimeFor(blob, filename) });
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
