// Saving a library file's source back to the phone (Library item > Save file / Share file). The bytes
// are the imported file itself (MediaFile.file), or the blob behind its object URL; nothing is
// re-encoded. A file whose source is gone says so instead of saving an empty file.
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { PhoneActionResult } from '../contracts';
import { savePhoneExport, sharePhoneExport } from '../export/phoneExportDelivery';

const log = Logger.create('PhoneLibraryFile');

export const PHONE_SOURCE_MISSING_REASON = 'The source file is not on this device any more. Relink it first (Replace the source file).';

function findFile(id: string): MediaFile | undefined {
  return useMediaStore.getState().files.find((file) => file.id === id);
}

/** The file's bytes, or null when the source is missing. */
export async function readPhoneSourceBlob(file: MediaFile): Promise<Blob | null> {
  if (file.file && file.file.size > 0) return file.file;
  if (!file.url) return null;
  try {
    const response = await fetch(file.url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch (error) {
    log.warn('Reading the source behind the object URL failed', { id: file.id, error });
    return null;
  }
}

export async function savePhoneSourceFile(id: string): Promise<PhoneActionResult> {
  const file = findFile(id);
  if (!file) return { ok: false, message: 'The media file no longer exists.' };
  const blob = await readPhoneSourceBlob(file);
  if (!blob) return { ok: false, message: PHONE_SOURCE_MISSING_REASON };
  const saved = savePhoneExport(blob, file.name);
  return saved.ok ? { ok: true, message: `"${file.name}" saved to your downloads.` } : saved;
}

/**
 * Hands the file to the share sheet. Call straight from the tap: Web Share needs the tap's activation,
 * so only a file already in memory is shared; otherwise it falls back to Save.
 */
export function sharePhoneSourceFile(id: string): Promise<PhoneActionResult> {
  const file = findFile(id);
  if (!file) return Promise.resolve({ ok: false, message: 'The media file no longer exists.' });
  if (!file.file || file.file.size === 0) return savePhoneSourceFile(id);
  return sharePhoneExport(file.file, file.name, file.name);
}
